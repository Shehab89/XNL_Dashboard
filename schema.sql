-- ============================================================
-- Dutch Social Monitor — Supabase (PostgreSQL) Schema
-- Run in: Supabase Dashboard > SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────────────────
-- 1. Raw Tweets  (landing table from scraper)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raw_tweets (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tweet_id       TEXT UNIQUE NOT NULL,
    topic          TEXT NOT NULL,          -- e.g. 'Salaris', 'Woningnood'
    text           TEXT NOT NULL,
    author         TEXT,
    author_handle  TEXT,
    published_at   TIMESTAMPTZ,
    likes          INTEGER DEFAULT 0,
    retweets       INTEGER DEFAULT 0,
    replies        INTEGER DEFAULT 0,
    tweet_url      TEXT,
    scraped_at     TIMESTAMPTZ DEFAULT NOW(),
    processed      BOOLEAN DEFAULT FALSE   -- flipped by NLP pipeline
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_raw_tweets_topic      ON raw_tweets(topic);
CREATE INDEX IF NOT EXISTS idx_raw_tweets_processed  ON raw_tweets(processed);
CREATE INDEX IF NOT EXISTS idx_raw_tweets_scraped_at ON raw_tweets(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_tweets_published  ON raw_tweets(published_at DESC);


-- ──────────────────────────────────────────────
-- 2. Tweet Analysis  (NLP results per tweet)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tweet_analysis (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tweet_id         TEXT UNIQUE NOT NULL REFERENCES raw_tweets(tweet_id) ON DELETE CASCADE,
    sentiment_label  TEXT CHECK (sentiment_label IN ('positive','negative','neutral','unknown')),
    sentiment_score  FLOAT,          -- confidence [0,1]
    cluster_id       INTEGER,        -- BERTopic cluster (-1 = noise)
    cleaned_text     TEXT,
    analysis_date    DATE DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS idx_analysis_date      ON tweet_analysis(analysis_date DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_sentiment ON tweet_analysis(sentiment_label);
CREATE INDEX IF NOT EXISTS idx_analysis_cluster   ON tweet_analysis(cluster_id);


-- ──────────────────────────────────────────────
-- 3. Daily Topic Summary  (aggregated per day)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_topic_summary (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date                 DATE NOT NULL,
    topic                TEXT NOT NULL,     -- social topic (Salaris etc.)
    cluster_id           INTEGER,
    cluster_label        TEXT,              -- human-readable BERTopic label
    tweet_count          INTEGER DEFAULT 0,
    total_likes          INTEGER DEFAULT 0,
    total_retweets       INTEGER DEFAULT 0,
    positive_count       INTEGER DEFAULT 0,
    negative_count       INTEGER DEFAULT 0,
    avg_sentiment_score  FLOAT,
    UNIQUE (date, topic, cluster_label)
);

CREATE INDEX IF NOT EXISTS idx_summary_date  ON daily_topic_summary(date DESC);
CREATE INDEX IF NOT EXISTS idx_summary_topic ON daily_topic_summary(topic);


-- ──────────────────────────────────────────────
-- 4. Convenience view for Dashboard
-- ──────────────────────────────────────────────
CREATE OR REPLACE VIEW dashboard_tweets AS
SELECT
    r.tweet_id,
    r.topic,
    r.text,
    r.author,
    r.author_handle,
    r.published_at,
    r.likes,
    r.retweets,
    r.replies,
    r.tweet_url,
    a.sentiment_label,
    a.sentiment_score,
    a.cluster_id,
    a.analysis_date
FROM raw_tweets r
LEFT JOIN tweet_analysis a ON r.tweet_id = a.tweet_id;


-- ──────────────────────────────────────────────
-- 5. Row Level Security (optional but recommended)
-- ──────────────────────────────────────────────
ALTER TABLE raw_tweets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tweet_analysis      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_topic_summary ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by scraper + NLP)
CREATE POLICY "service_role_all" ON raw_tweets
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON tweet_analysis
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON daily_topic_summary
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon/authenticated READ access for the dashboard
CREATE POLICY "public_read" ON raw_tweets
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "public_read" ON tweet_analysis
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "public_read" ON daily_topic_summary
    FOR SELECT TO anon, authenticated USING (true);
