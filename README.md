# 🇳🇱 Dutch Social Monitor

A fully automated system that monitors Dutch social discourse on X (Twitter), performs Dutch NLP analysis, and visualises results in a Streamlit dashboard — running on free-tier infrastructure.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                GitHub Actions (cron: 06:00 UTC)          │
│                                                          │
│  Job 1: Scraper (Node.js + Playwright)                   │
│    └─► Scrapes 50-100 tweets per topic (nl language)     │
│    └─► Writes raw tweets → Supabase (raw_tweets)         │
│                                                          │
│  Job 2: NLP Processor (Python)                           │
│    └─► Pulls unprocessed tweets from Supabase            │
│    └─► Dutch sentiment: RobBERT via HF Inference API     │
│    └─► Topic modelling: BERTopic (multilingual)          │
│    └─► Writes results → Supabase (tweet_analysis)        │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Supabase (PostgreSQL) │
              │  raw_tweets            │
              │  tweet_analysis        │
              │  daily_topic_summary   │
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Streamlit Dashboard   │
              │  (Streamlit Cloud)     │
              └───────────────────────┘
```

---

## Quick Start

### 1. Supabase Setup
1. Create a free project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and paste + run `database/schema.sql`
3. Note your `Project URL` and `service_role` key (Settings → API)

### 2. Hugging Face
1. Create a free account at [huggingface.co](https://huggingface.co)
2. Settings → Access Tokens → New token (read)

### 3. X Cookie Auth
1. Log into x.com in Chrome
2. Open DevTools (F12) → Application → Cookies → `https://x.com`
3. Copy values for `auth_token` and `ct0`
4. ⚠️ Keep these secret — they give full account access

### 4. GitHub Secrets
In your repo → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key |
| `HUGGINGFACE_API_KEY` | HF token |
| `X_AUTH_TOKEN` | Cookie: auth_token |
| `X_CT0` | Cookie: ct0 |

### 5. Local Development

**Scraper:**
```bash
cd scraper
npm install
npx playwright install chromium
cp ../.env.example .env    # fill in your secrets
npm run dev
```

**NLP Processor:**
```bash
cd nlp
pip install -r requirements.txt
python processor.py
```

**Dashboard:**
```bash
cd dashboard
pip install streamlit supabase pandas plotly python-dotenv
streamlit run dashboard.py
```

### 6. Deploy Dashboard (Free)
1. Push repo to GitHub
2. Go to [share.streamlit.io](https://share.streamlit.io)
3. Connect your repo, set `dashboard/dashboard.py` as main file
4. Add secrets in the Streamlit app settings:
   - `SUPABASE_URL`
   - `SUPABASE_KEY` (use the **anon** key for dashboard — read-only)

---

## Topics Monitored

| Topic | Dutch search query |
|-------|--------------------|
| Salaris | salarissen loon minimumloon Nederland |
| Woningnood | woningnood huurprijs koopwoning Nederland |
| Zorg | zorg zorgkosten ziekenhuis wachttijden |
| Klimaat | klimaat klimaatverandering duurzaamheid stikstof |
| Onderwijs | onderwijs leerkort schoolkosten studenten |

---

## Cost
| Service | Free Tier |
|---------|-----------|
| Supabase | 500MB DB, 2GB bandwidth |
| Hugging Face Inference API | ~30k requests/month |
| Streamlit Cloud | Unlimited public apps |
| GitHub Actions | 2,000 min/month |

---

## .env.example

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
HUGGINGFACE_API_KEY=hf_xxxx
X_AUTH_TOKEN=your-auth-token-cookie
X_CT0=your-ct0-cookie
```
