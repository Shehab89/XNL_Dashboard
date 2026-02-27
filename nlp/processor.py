import os
import re
import logging
from datetime import datetime, timezone
import requests
from dotenv import load_dotenv

# ... (Environment setup and SB helpers from source)

# Updated Keyword mapping for your specific groups
TOPIC_KEYWORDS = {
    "Migratie": ["asiel", "migratie", "ter apel", "grenzen"],
    "Belasting": ["btw", "belasting", "fiscus", "toeslagen"],
    "Mensenrechten": ["discriminatie", "vrijheid", "mensenrechten", "racisme"],
    "Woning": ["huur", "woningnood", "huis", "bouwen"],
    "Salaris": ["loon", "salaris", "cao", "minimumloon"],
    "PVV": ["wilders", "geert", "pvv"],
    "VVD": ["vvd", "yesilgoz", "dilan"],
    "CDA": ["cda", "bontenbal"],
    "GPvda": ["timmermans", "groenlinks", "pvda"],
    "D66": ["jetten", "d66"],
    "J21": ["ja21", "eerdmans"],
    "FvD": ["baudet", "thierry", "fvd", "forum"]
}

# Model for Dutch-friendly sentiment
HF_MODEL = "nlptown/bert-base-multilingual-uncased-sentiment"

def clean(text: str) -> str:
    # Improved cleaning logic for Dutch social media
    text = re.sub(r"https?://\S+|@\w+|#", "", text)
    return text.strip().lower()

def keyword_label(text: str) -> str:
    t = text.lower()
    for label, keywords in TOPIC_KEYWORDS.items():
        if any(kw in t for kw in keywords):
            return label
    return "Overig"

# ... (Main pipeline logic for BERTopic and Supabase upload)
