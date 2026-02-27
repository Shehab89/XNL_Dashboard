"""
Dutch Social Monitor — NLP Processor
Pulls unprocessed tweets → sentiment → topic model → writes back to Supabase
"""

import os
import sys
import time
import logging
import re
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Validate env ───────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
HF_API_KEY   = os.environ.get("HUGGINGFACE_API_KEY", "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    log.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

if not HF_API_KEY:
    log.error("❌ Missing HUGGINGFACE_API_KEY")
    sys.exit(1)

log.info(f"✅ Env OK — URL prefix: {SUPABASE_URL[:25]}")

# ── Supabase REST helpers (no SDK — avoids version issues) ────────────────────
HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal",
}

def sb_get(table: str, params: dict) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r   = requests.get(url, headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()

def sb_patch(table: str, params: dict, body: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r   = requests.patch(url, headers={**HEADERS, "Prefer": "return=minimal"}, params=params, json=body, timeout=30)
    r.raise_for_status()

def sb_upsert(table: str, rows: list, on_conflict: str) -> None:
    if not rows: return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    h   = {**HEADERS, "Prefer": f"resolution=merge-duplicates,return=minimal"}
    r   = requests.post(url, headers=h, json=rows, timeout=60)
    r.raise_for_status()

# ── Dutch stop-words ──────────────────────────────────────────────────────────
STOPWORDS = {
    "de","het","een","en","van","is","dat","in","te","zijn","op","aan","met",
    "voor","als","ook","er","maar","om","bij","nog","die","dit","dan","door",
    "ze","wat","worden","wel","niet","was","naar","meer","uit","kan","hij",
    "we","ik","je","hun","hem","haar","u","heeft","hebben","wordt","al","nu",
    "zo","t","n","m","s","rt","via","amp",
}

def clean(text: str) -> str:
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"@\w+", " ", text)
    text = re.sub(r"#(\w+)", r"\1", text)
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip().lower()
    return " ".join(w for w in text.split() if w not in STOPWORDS and len(w) > 2)

# ── HuggingFace sentiment ─────────────────────────────────────────────────────
HF_MODEL = "nlptown/bert-base-multilingual-uncased-sentiment"
HF_URL   = f"https://api-inference.huggingface.co/models/{HF_MODEL}"
HF_HDR   = {"Authorization": f"Bearer {HF_API_KEY}"}

LABEL_MAP = {
    "1 star": "negative", "2 stars": "negative",
    "3 stars": "neutral",
    "4 stars": "positive", "5 stars": "positive",
    "positive": "positive", "negative": "negative", "neutral": "neutral",
    "pos": "positive", "neg": "negative", "neu": "neutral",
    "positief": "positive", "negatief": "negative",
}

def hf_sentiment_single(text: str) -> dict | None:
    """Call HF API for a single text — more reliable than batching."""
    try:
        r = requests.post(
            HF_URL,
            headers=HF_HDR,
            json={"inputs": text, "options": {"wait_for_model": True}},
            timeout=30
        )
        if r.status_code == 503:
            log.warning("Model loading, waiting 20s…")
            time.sleep(20)
            return hf_sentiment_single(text)
        if r.status_code != 200:
            log.warning(f"HF status {r.status_code}: {r.text[:100]}")
            return None
        data = r.json()
        # Response can be [[{label,score},...]] or [{label,score},...]
        if isinstance(data, list) and data:
            items = data[0] if isinstance(data[0], list) else data
            best  = max(items, key=lambda x: x["score"])
            raw   = best["label"].lower().strip()
            label = LABEL_MAP.get(raw, "neutral")
            return {"label": label, "score": round(best["score"], 4)}
        return None
    except Exception as e:
        log.error(f"HF error: {e}")
        return None

def hf_sentiment(texts: list[str]) -> list[dict | None]:
    results = []
    for i, text in enumerate(texts):
        result = hf_sentiment_single(text[:512])  # truncate to model max
        results.append(result)
        if (i + 1) % 10 == 0:
            log.info(f"  Sentiment: {i+1}/{len(texts)}")
            time.sleep(0.5)  # gentle rate limiting
    return results

# ── Simple keyword topic labeller (fallback when BERTopic unavailable) ────────
TOPIC_KEYWORDS = {
    "huisvesting":  ["huur","woning","huurprijs","koophuis","woningnood","hypotheek","appartement"],
    "salaris":      ["salaris","loon","minimumloon","loonsverhoging","inkomen","betaling"],
    "zorg":         ["zorg","ziekenhuis","wachttijd","huisarts","zorgkosten","medicijn","verpleging"],
    "klimaat":      ["klimaat","stikstof","duurzaam","co2","energie","warmtepomp","fossiel"],
    "onderwijs":    ["school","leraar","leerkort","onderwijs","student","studie","universiteit"],
}

def keyword_label(text: str) -> str:
    t = text.lower()
    scores = {label: sum(1 for kw in kws if kw in t) for label, kws in TOPIC_KEYWORDS.items()}
    best = max(scores, key=lambda x: scores[x])
    return best if scores[best] > 0 else "overig"

# ── Main pipeline ─────────────────────────────────────────────────────────────
def main():
    log.info("🚀 Dutch NLP pipeline starting…")

    # Reset tweets that were saved as 'unknown' so they get re-analysed
    try:
        url, key = SUPABASE_URL, SUPABASE_KEY
        headers  = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        requests.patch(
            f"{url}/rest/v1/raw_tweets",
            headers=headers,
            params={"processed": "eq.true"},
            json={"processed": False},
            timeout=30
        )
        log.info("  Reset previously processed tweets for re-analysis")
    except Exception as e:
        log.warning(f"  Could not reset tweets: {e}")

    # 1. Fetch unprocessed tweets
    tweets = sb_get("raw_tweets", {"processed": "eq.false", "order": "scraped_at.desc", "limit": "500"})
    log.info(f"📥 {len(tweets)} unprocessed tweets")

    if not tweets:
        log.info("Nothing to process — exiting.")
        return

    today = datetime.now(timezone.utc).date().isoformat()

    # 2. Sentiment in batches of 32
    BATCH = 32
    analysis_rows = []
    texts = [clean(t["text"]) for t in tweets]

    for i in range(0, len(tweets), BATCH):
        batch_tweets = tweets[i:i+BATCH]
        batch_texts  = texts[i:i+BATCH]
        sentiments   = hf_sentiment(batch_texts)

        for j, tweet in enumerate(batch_tweets):
            s = sentiments[j]
            label = s["label"] if s else "unknown"
            score = s["score"] if s else None

            analysis_rows.append({
                "tweet_id":        tweet["tweet_id"],
                "sentiment_label": label,
                "sentiment_score": score,
                "cluster_id":      -1,
                "cluster_label":   keyword_label(batch_texts[j]),
                "cleaned_text":    batch_texts[j],
                "analysis_date":   today,
            })

        log.info(f"  Batch {i//BATCH + 1}/{(len(tweets)-1)//BATCH + 1} done")
        if i + BATCH < len(tweets):
            time.sleep(1)

    # 3. Try BERTopic (optional — gracefully skipped if not installed)
    try:
        from bertopic import BERTopic
        from sentence_transformers import SentenceTransformer
        log.info("🏷️  Running BERTopic…")
        model  = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
        bt     = BERTopic(embedding_model=model, language="dutch", verbose=False)
        topics, _ = bt.fit_transform(texts)
        info   = bt.get_topic_info()
        for i, row in enumerate(analysis_rows):
            cid   = int(topics[i])
            row["cluster_id"] = cid
            if cid != -1:
                r = info[info["Topic"] == cid]
                row["cluster_label"] = r["Name"].values[0] if not r.empty else row["cluster_label"]
        log.info("  BERTopic done")
    except ImportError:
        log.info("  BERTopic not available — using keyword labels")
    except Exception as e:
        log.warning(f"  BERTopic failed ({e}) — using keyword labels")

    # 4. Write analysis
    log.info(f"💾 Writing {len(analysis_rows)} analysis rows…")
    sb_upsert("tweet_analysis", analysis_rows, "tweet_id")

    # 5. Write daily summary
    from collections import defaultdict
    summary_map: dict = defaultdict(lambda: {"tweet_count":0,"total_likes":0,"total_retweets":0,"positive_count":0,"negative_count":0,"scores":[]})
    for i, row in enumerate(analysis_rows):
        t   = tweets[i]
        key = (today, t["topic"], row["cluster_label"])
        s   = summary_map[key]
        s["tweet_count"]    += 1
        s["total_likes"]    += t.get("likes", 0)
        s["total_retweets"] += t.get("retweets", 0)
        if row["sentiment_label"] == "positive": s["positive_count"] += 1
        if row["sentiment_label"] == "negative": s["negative_count"] += 1
        if row["sentiment_score"]: s["scores"].append(row["sentiment_score"])

    summary_rows = []
    for (date, topic, label), s in summary_map.items():
        summary_rows.append({
            "date":               date,
            "topic":              topic,
            "cluster_id":         0,
            "cluster_label":      label,
            "tweet_count":        s["tweet_count"],
            "total_likes":        s["total_likes"],
            "total_retweets":     s["total_retweets"],
            "positive_count":     s["positive_count"],
            "negative_count":     s["negative_count"],
            "avg_sentiment_score": round(sum(s["scores"])/len(s["scores"]), 4) if s["scores"] else 0,
        })

    log.info(f"📊 Writing {len(summary_rows)} summary rows…")
    sb_upsert("daily_topic_summary", summary_rows, "date,topic,cluster_label")

    # 6. Mark processed
    ids = [t["tweet_id"] for t in tweets]
    # patch in chunks of 100
    for i in range(0, len(ids), 100):
        chunk = ids[i:i+100]
        id_filter = "in.(" + ",".join(chunk) + ")"
        sb_patch("raw_tweets", {"tweet_id": id_filter}, {"processed": True})

    # Stats
    pos = sum(1 for r in analysis_rows if r["sentiment_label"] == "positive")
    neg = sum(1 for r in analysis_rows if r["sentiment_label"] == "negative")
    neu = len(analysis_rows) - pos - neg
    log.info(f"✅ Done! Positive:{pos} Negative:{neg} Neutral:{neu}")

if __name__ == "__main__":
    main()
