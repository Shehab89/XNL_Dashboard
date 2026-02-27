import os
import re
import time
import requests
from datetime import datetime, timezone

# --- Validate Environment ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
HF_API_KEY   = os.environ.get("HUGGINGFACE_API_KEY", "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Missing Supabase credentials.")
    exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

# --- Keyword Mapping for Your Specific Topics ---
TOPIC_KEYWORDS = {
    "Migratie": ["asiel", "migratie", "immigratie", "ter apel", "grenzen"],
    "Belasting": ["btw", "belasting", "fiscus", "toeslagen"],
    "Mensenrechten": ["discriminatie", "vrijheid", "rechten", "racisme", "mensenrechten"],
    "Woning": ["huur", "woningnood", "huis", "bouwen", "hypotheek", "woning"],
    "Salaris": ["loon", "salaris", "cao", "minimumloon", "inkomen"],
    "PVV": ["wilders", "geert", "pvv"],
    "VVD": ["vvd", "yesilgoz", "dilan"],
    "CDA": ["cda", "bontenbal", "henri"],
    "GPvda": ["timmermans", "groenlinks", "pvda", "frans"],
    "D66": ["jetten", "d66", "rob"],
    "J21": ["ja21", "eerdmans", "joost"],
    "FvD": ["baudet", "thierry", "fvd", "forum"]
}

def clean_text(text: str) -> str:
    # Remove URLs, mentions, and hashtags for cleaner NLP processing
    text = re.sub(r"https?://\S+|@\w+|#", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()

def keyword_label(text: str) -> str:
    for label, keywords in TOPIC_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return label
    return "Overig"

def get_hf_sentiment(texts):
    # Using the Dutch-friendly Multilingual BERT model
    url = "https://api-inference.huggingface.co/models/nlptown/bert-base-multilingual-uncased-sentiment"
    headers = {"Authorization": f"Bearer {HF_API_KEY}"}
    results = []
    
    for text in texts:
        try:
            r = requests.post(url, headers=headers, json={"inputs": text[:512]}, timeout=15)
            if r.status_code == 200:
                data = r.json()
                if isinstance(data, list) and len(data) > 0:
                    items = data[0] if isinstance(data[0], list) else data
                    best = max(items, key=lambda x: x["score"])
                    label = best["label"].lower()
                    
                    if "1 star" in label or "2 star" in label: final_label = "negative"
                    elif "4 star" in label or "5 star" in label: final_label = "positive"
                    else: final_label = "neutral"
                    
                    results.append({"label": final_label, "score": best["score"]})
                    continue
        except Exception as e:
            print(f"HF API Error: {e}")
        
        # Fallback if API fails
        results.append({"label": "neutral", "score": 0.0})
        time.sleep(0.5) # Gentle rate limiting
        
    return results

def main():
    print("🚀 Starting NLP Pipeline...")
    
    # 1. Fetch unprocessed tweets
    r = requests.get(f"{SUPABASE_URL}/rest/v1/raw_tweets?processed=eq.false&limit=500", headers=HEADERS)
    tweets = r.json() if r.status_code == 200 else []
    
    if not tweets:
        print("✅ No new tweets to process. Exiting.")
        return

    print(f"📥 Processing {len(tweets)} new tweets...")
    today = datetime.now(timezone.utc).date().isoformat()
    analysis_rows = []
    
    # Clean text and run sentiment
    texts = [clean_text(t["text"]) for t in tweets]
    sentiments = get_hf_sentiment(texts)

    for i, tweet in enumerate(tweets):
        analysis_rows.append({
            "tweet_id": tweet["tweet_id"],
            "sentiment_label": sentiments[i]["label"],
            "sentiment_score": sentiments[i]["score"],
            "cluster_label": keyword_label(texts[i]),
            "analysis_date": today
        })

    # 2. Upload analysis to Supabase
    requests.post(
        f"{SUPABASE_URL}/rest/v1/tweet_analysis", 
        headers={**HEADERS, "Prefer": "resolution=merge-duplicates"}, 
        json=analysis_rows
    )
    
    # 3. Mark raw tweets as processed
    for tweet in tweets:
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/raw_tweets?tweet_id=eq.{tweet['tweet_id']}", 
            headers=HEADERS, 
            json={"processed": True}
        )

    print(f"✅ Successfully processed and updated {len(tweets)} tweets.")

if __name__ == "__main__":
    main()
