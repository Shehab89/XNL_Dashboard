import os
import sys
import time
import re
import requests
from datetime import datetime, timezone

# --- Validate Environment Variables ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
HF_API_KEY   = os.environ.get("HUGGINGFACE_API_KEY", "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)
if not HF_API_KEY:
    print("❌ Error: Missing HUGGINGFACE_API_KEY")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

# --- Topic Keywords Mapping ---
TOPIC_KEYWORDS = {
    "Migratie": ["asiel", "migratie", "immigratie", "ter apel", "grenzen", "asielzoeker"],
    "Belasting": ["btw", "belasting", "fiscus", "toeslagen", "belastingdienst"],
    "Mensenrechten": ["discriminatie", "vrijheid", "rechten", "racisme", "mensenrechten", "gelijkheid"],
    "Woning": ["huur", "woningnood", "huis", "bouwen", "hypotheek", "woning", "koopwoning"],
    "Salaris": ["loon", "salaris", "cao", "minimumloon", "inkomen"],
    "PVV": ["wilders", "geert", "pvv"],
    "VVD": ["vvd", "yesilgoz", "dilan"],
    "CDA": ["cda", "bontenbal", "henri"],
    "GPvda": ["timmermans", "groenlinks", "pvda", "frans", "gl", "gl-pvda"],
    "D66": ["jetten", "d66", "rob"],
    "J21": ["ja21", "eerdmans", "joost"],
    "FvD": ["baudet", "thierry", "fvd", "forum"]
}

def clean_text(text: str) -> str:
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"@\w+", " ", text)
    text = re.sub(r"#\w+", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()

def keyword_label(text: str) -> str:
    for label, keywords in TOPIC_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return label
    return "Overig"

def get_hf_sentiment(text: str, retries=3):
    url = "https://api-inference.huggingface.co/models/nlptown/bert-base-multilingual-uncased-sentiment"
    headers = {"Authorization": f"Bearer {HF_API_KEY}"}
    
    for attempt in range(retries):
        try:
            r = requests.post(url, headers=headers, json={"inputs": text[:512]}, timeout=20)
            
            # Success!
            if r.status_code == 200:
                data = r.json()
                if isinstance(data, list) and len(data) > 0:
                    items = data[0] if isinstance(data[0], list) else data
                    best = max(items, key=lambda x: x["score"])
                    label = best["label"].lower()
                    
                    if "1 star" in label or "2 star" in label: return "negative", best["score"]
                    elif "4 star" in label or "5 star" in label: return "positive", best["score"]
                    else: return "neutral", best["score"]
            
            # Model is sleeping, wait longer
            elif r.status_code == 503:
                print(f"⏳ Model warming up (Attempt {attempt+1}/{retries}). Waiting 20s...")
                time.sleep(20)
                
            # Rate limited! Slow down
            elif r.status_code == 429:
                print(f"🛑 Rate limited by Hugging Face (Attempt {attempt+1}/{retries})! Waiting 30s...")
                time.sleep(30)
                
            # Authentication or other errors
            else:
                print(f"⚠️ HF API Error {r.status_code}: {r.text}")
                break # Stop retrying if the API key is wrong
                
        except requests.exceptions.ReadTimeout:
            print("⏳ Request timed out. Retrying...")
            time.sleep(5)
        except Exception as e:
            print(f"⚠️ Network Error: {e}")
            time.sleep(5)
            
    # Ultimate fail-safe if all retries fail
    return "neutral", 0.0

def main():
    print("🚀 Starting NLP Processor...")
    
    # 1. Fetch unprocessed tweets from Supabase (fetching 100 at a time to be safe)
    r = requests.get(f"{SUPABASE_URL}/rest/v1/raw_tweets?processed=eq.false&limit=100", headers=HEADERS)
    if r.status_code != 200:
        print(f"❌ Failed to fetch tweets: {r.text}")
        return
        
    tweets = r.json()
    if not tweets:
        print("✅ No new tweets to process. Exiting.")
        return

    print(f"📥 Processing {len(tweets)} tweets...")
    today = datetime.now(timezone.utc).date().isoformat()
    
    analysis_rows = []
    tweet_ids_to_mark = []

    for index, tweet in enumerate(tweets):
        tweet_id = tweet.get("tweet_id")
        raw_text = tweet.get("text", "")
        
        # This print statement helps you track progress in the terminal
        print(f"[{index + 1}/{len(tweets)}] Analyzing tweet...")
        
        cleaned = clean_text(raw_text)
        sentiment_label, sentiment_score = get_hf_sentiment(cleaned)
        
        analysis_rows.append({
            "tweet_id": tweet_id,
            "sentiment_label": sentiment_label,
            "sentiment_score": sentiment_score,
            "cluster_id": -1, # Fallback cluster ID for keyword matches
            "cleaned_text": cleaned[:500],
            "analysis_date": today
        })
        tweet_ids_to_mark.append(tweet_id)
        
        # 1.5 second pause between API calls to prevent triggering the 429 Rate Limit
        time.sleep(1.5)

    # 2. Upload analysis back to Supabase
    if analysis_rows:
        upsert_headers = {**HEADERS, "Prefer": "resolution=merge-duplicates"}
        res = requests.post(
            f"{SUPABASE_URL}/rest/v1/tweet_analysis", 
            headers=upsert_headers, 
            json=analysis_rows
        )
        if res.status_code not in (200, 201, 204):
            print(f"❌ Failed to upsert analysis: {res.text}")
        else:
            print(f"✅ Upserted {len(analysis_rows)} analysis rows.")

    # 3. Mark the original tweets as processed
    if tweet_ids_to_mark:
        id_list = ",".join(
