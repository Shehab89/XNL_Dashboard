"""
Dutch Social Monitor — NLP Processing Engine
=============================================
Pulls unprocessed tweets from Supabase, runs:
  1. Dutch sentiment analysis (RobBERT via Hugging Face Inference API)
  2. Topic modelling (BERTopic with Dutch sentence-transformers)
  3. Writes results back to Supabase `tweet_analysis` table

Install:
    pip install supabase python-dotenv requests transformers
    pip install bertopic sentence-transformers umap-learn hdbscan
"""

import os
import time
import logging
from datetime import datetime, timezone
from typing import Optional

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HF_API_KEY      = os.environ["HUGGINGFACE_API_KEY"]

# Dutch-specific sentiment model (fine-tuned on Dutch reviews/social media)
# Alternatives: "wietsedv/bert-base-dutch-cased-finetuned-sentiment"
SENTIMENT_MODEL = "DTAI-KULeuven/robbert-2023-dutch-sentiment"

HF_INFERENCE_URL = f"https://api-inference.huggingface.co/models/{SENTIMENT_MODEL}"

BATCH_SIZE = 50   # tweets per Hugging Face batch call (free tier cap)

# ─── Dutch stop-words ─────────────────────────────────────────────────────────

DUTCH_STOPWORDS = set([
    "de", "het", "een", "en", "van", "is", "dat", "in", "te", "zijn",
    "op", "aan", "met", "voor", "als", "ook", "er", "maar", "om",
    "bij", "nog", "die", "dit", "dan", "door", "ze", "wat", "worden",
    "wel", "niet", "was", "naar", "meer", "uit", "kan", "worden",
    "hij", "ze", "we", "ik", "je", "hun", "hem", "haar", "u",
    "heeft", "hebben", "wordt", "zijn", "al", "al", "nu", "zo",
    "t", "n", "m", "s", "rt",  # Twitter-specific
])

# ─── Supabase helpers ─────────────────────────────────────────────────────────

def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_unprocessed_tweets(client: Client, limit: int = 500) -> list[dict]:
    """Fetch tweets that haven't been analysed yet (no entry in tweet_analysis)."""
    response = (
        client.table("raw_tweets")
        .select("*")
        .filter("processed", "eq", False)
        .order("scraped_at", desc=True)
        .limit(limit)
        .execute()
    )
    return response.data or []


def mark_tweets_processed(client: Client, tweet_ids: list[str]) -> None:
    client.table("raw_tweets").update({"processed": True}).in_("tweet_id", tweet_ids).execute()


def upsert_analysis(client: Client, records: list[dict]) -> None:
    client.table("tweet_analysis").upsert(records, on_conflict="tweet_id").execute()


def upsert_topic_summary(client: Client, records: list[dict]) -> None:
    client.table("daily_topic_summary").upsert(records, on_conflict="date,topic,cluster_label").execute()

# ─── Text pre-processing ──────────────────────────────────────────────────────

def clean_dutch_text(text: str) -> str:
    """Light pre-processing for Dutch NLP."""
    import re

    # Remove URLs
    text = re.sub(r"https?://\S+", "", text)
    # Remove @mentions
    text = re.sub(r"@\w+", "", text)
    # Remove #hashtag symbol but keep the word
    text = re.sub(r"#(\w+)", r"\1", text)
    # Remove non-alphanumeric chars except spaces and apostrophes
    text = re.sub(r"[^\w\s']", " ", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    # Lowercase
    text = text.lower()
    return text


def remove_stopwords(text: str) -> str:
    return " ".join(w for w in text.split() if w not in DUTCH_STOPWORDS and len(w) > 2)

# ─── Sentiment Analysis via Hugging Face Inference API ───────────────────────

def hf_sentiment_batch(texts: list[str]) -> list[Optional[dict]]:
    """
    Calls HuggingFace Inference API.
    Returns list of {"label": "positive"|"negative"|"neutral", "score": float}
    """
    headers = {"Authorization": f"Bearer {HF_API_KEY}"}
    payload = {"inputs": texts, "options": {"wait_for_model": True}}

    try:
        response = requests.post(HF_INFERENCE_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        raw = response.json()

        results = []
        for item in raw:
            if isinstance(item, list):
                # Multi-label — pick highest confidence
                best = max(item, key=lambda x: x["score"])
                results.append({"label": best["label"].lower(), "score": round(best["score"], 4)})
            elif isinstance(item, dict) and "label" in item:
                results.append({"label": item["label"].lower(), "score": round(item["score"], 4)})
            else:
                results.append(None)
        return results

    except requests.exceptions.HTTPError as e:
        # Model may be loading — wait and retry once
        if response.status_code == 503:
            log.warning("Model loading (503), retrying in 20s…")
            time.sleep(20)
            return hf_sentiment_batch(texts)
        log.error(f"HF API error: {e}")
        return [None] * len(texts)
    except Exception as e:
        log.error(f"Sentiment batch error: {e}")
        return [None] * len(texts)


def run_sentiment(tweets: list[dict]) -> list[dict]:
    """Enrich tweets list with sentiment fields."""
    texts   = [clean_dutch_text(t["text"]) for t in tweets]
    results = []

    for i in range(0, len(texts), BATCH_SIZE):
        batch_texts = texts[i : i + BATCH_SIZE]
        sentiments  = hf_sentiment_batch(batch_texts)

        for j, sentiment in enumerate(sentiments):
            tweet = tweets[i + j]
            results.append({
                **tweet,
                "sentiment_label": sentiment["label"]  if sentiment else "unknown",
                "sentiment_score": sentiment["score"]  if sentiment else None,
                "cleaned_text":    batch_texts[j],
            })

        # Be kind to free-tier rate limits
        if i + BATCH_SIZE < len(texts):
            time.sleep(1.5)

    return results

# ─── Topic Modelling (BERTopic) ───────────────────────────────────────────────

def run_topic_modelling(tweets: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Cluster tweets per social topic into sub-themes using BERTopic.
    Returns (enriched_tweets, topic_summaries).
    """
    try:
        from bertopic import BERTopic
        from sentence_transformers import SentenceTransformer
        from umap import UMAP
        from hdbscan import HDBSCAN

        # Dutch sentence transformer
        embed_model = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")

        umap_model  = UMAP(n_neighbors=10, n_components=5, metric="cosine", random_state=42)
        hdbscan_model = HDBSCAN(min_cluster_size=5, metric="euclidean", prediction_data=True)

        topic_model = BERTopic(
            embedding_model=embed_model,
            umap_model=umap_model,
            hdbscan_model=hdbscan_model,
            language="dutch",
            calculate_probabilities=False,
            verbose=False,
        )

        cleaned = [remove_stopwords(clean_dutch_text(t["text"])) for t in tweets]
        topics, _ = topic_model.fit_transform(cleaned)

        topic_info = topic_model.get_topic_info()
        today = datetime.now(timezone.utc).date().isoformat()

        enriched = []
        for i, tweet in enumerate(tweets):
            enriched.append({**tweet, "cluster_id": int(topics[i])})

        # Build daily summaries per (topic × cluster)
        summaries = []
        cluster_map: dict[tuple, list] = {}
        for t in enriched:
            key = (t["topic"], t["cluster_id"])
            cluster_map.setdefault(key, []).append(t)

        for (social_topic, cluster_id), group in cluster_map.items():
            if cluster_id == -1:
                label = "Overig"
            else:
                row = topic_info[topic_info["Topic"] == cluster_id]
                label = row["Name"].values[0] if not row.empty else f"Cluster {cluster_id}"

            total_likes    = sum(g.get("likes", 0)    for g in group)
            total_retweets = sum(g.get("retweets", 0) for g in group)
            pos = sum(1 for g in group if g.get("sentiment_label") == "positive")
            neg = sum(1 for g in group if g.get("sentiment_label") == "negative")

            summaries.append({
                "date":              today,
                "topic":             social_topic,
                "cluster_id":        cluster_id,
                "cluster_label":     label,
                "tweet_count":       len(group),
                "total_likes":       total_likes,
                "total_retweets":    total_retweets,
                "positive_count":    pos,
                "negative_count":    neg,
                "avg_sentiment_score": round(
                    sum(g.get("sentiment_score") or 0 for g in group) / len(group), 4
                ),
            })

        return enriched, summaries

    except ImportError:
        log.warning("BERTopic not installed — skipping topic modelling. Run: pip install bertopic sentence-transformers umap-learn hdbscan")
        for t in tweets:
            t["cluster_id"] = -1
        return tweets, []

# ─── Main Pipeline ────────────────────────────────────────────────────────────

def main():
    log.info("🚀 Starting Dutch NLP pipeline…")
    client = get_supabase()

    tweets = fetch_unprocessed_tweets(client)
    log.info(f"📥 Fetched {len(tweets)} unprocessed tweets")

    if not tweets:
        log.info("Nothing to process. Exiting.")
        return

    # Step 1: Sentiment
    log.info("🧠 Running sentiment analysis…")
    tweets_with_sentiment = run_sentiment(tweets)

    # Step 2: Topic modelling
    log.info("🏷️  Running topic modelling…")
    enriched_tweets, topic_summaries = run_topic_modelling(tweets_with_sentiment)

    # Step 3: Write analysis records
    today = datetime.now(timezone.utc).date().isoformat()
    analysis_records = [
        {
            "tweet_id":        t["tweet_id"],
            "sentiment_label": t.get("sentiment_label", "unknown"),
            "sentiment_score": t.get("sentiment_score"),
            "cluster_id":      t.get("cluster_id", -1),
            "cleaned_text":    t.get("cleaned_text", ""),
            "analysis_date":   today,
        }
        for t in enriched_tweets
    ]

    log.info(f"💾 Writing {len(analysis_records)} analysis records to Supabase…")
    upsert_analysis(client, analysis_records)

    if topic_summaries:
        log.info(f"📊 Writing {len(topic_summaries)} topic summaries…")
        upsert_topic_summary(client, topic_summaries)

    # Mark tweets as processed
    tweet_ids = [t["tweet_id"] for t in tweets]
    mark_tweets_processed(client, tweet_ids)

    log.info("✅ Pipeline complete!")

    # Print quick stats
    pos = sum(1 for t in enriched_tweets if t.get("sentiment_label") == "positive")
    neg = sum(1 for t in enriched_tweets if t.get("sentiment_label") == "negative")
    neu = len(enriched_tweets) - pos - neg
    log.info(f"   Sentiment → Positive: {pos} | Negative: {neg} | Neutral/Unknown: {neu}")


if __name__ == "__main__":
    main()
