-- ============================================================
-- Dutch Political Media Monitor — Supabase (PostgreSQL) schema
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again (it only creates what is missing).
--
-- One table `items` holds every news article and social post, with its analysis.
-- (The old tables raw_tweets / tweet_analysis / daily_topic_summary are no longer used and
--  can be dropped once you no longer need their data.)
-- ============================================================

CREATE TABLE IF NOT EXISTS items (
    id               TEXT PRIMARY KEY,        -- "<platform>:<hash>", stable per post/article
    platform         TEXT NOT NULL,           -- news | google_news | gdelt | bluesky | mastodon | reddit | telegram | youtube | x
    source           TEXT,                    -- outlet, subreddit, Mastodon server, channel ...
    author           TEXT,
    title            TEXT,
    text             TEXT NOT NULL,
    url              TEXT,
    published_at     TIMESTAMPTZ NOT NULL,
    collected_at     TIMESTAMPTZ DEFAULT NOW(),
    lang             TEXT,
    likes            INTEGER DEFAULT 0,
    shares           INTEGER DEFAULT 0,
    replies          INTEGER DEFAULT 0,
    parties          TEXT[] DEFAULT '{}',     -- parties mentioned, e.g. {PVV,VVD}
    issues           TEXT[] DEFAULT '{}',     -- issues mentioned, e.g. {Wonen}
    sentiment        TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    sentiment_score  REAL                     -- -1 (negative) … +1 (positive)
);

CREATE INDEX IF NOT EXISTS idx_items_published ON items (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_platform  ON items (platform);
CREATE INDEX IF NOT EXISTS idx_items_parties   ON items USING GIN (parties);
CREATE INDEX IF NOT EXISTS idx_items_issues    ON items USING GIN (issues);

-- Row Level Security: the pipeline writes with the service_role key,
-- the dashboard reads with the public anon key (read-only).
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'items' AND policyname = 'service_role_all') THEN
        CREATE POLICY "service_role_all" ON items FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'items' AND policyname = 'public_read') THEN
        CREATE POLICY "public_read" ON items FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;
