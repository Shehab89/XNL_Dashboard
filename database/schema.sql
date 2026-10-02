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
    sentiment_score  REAL,                    -- -1 (negative) … +1 (positive)
    analysed_by      TEXT                     -- llm | local | api | lexicon
);

-- Existing databases: add the column without recreating the table.
ALTER TABLE items ADD COLUMN IF NOT EXISTS analysed_by TEXT;

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

-- Duplicates: the same headline or post saved more than once (several outlets or runs, overlapping backfill
-- windows). The key is the title (or the first 160 characters of the text) in lower case, without punctuation;
-- keys shorter than 25 characters are left alone. Of each group the row with AI labels is kept, then the richest
-- news source, then the earliest. The pipeline calls this after every run.
CREATE OR REPLACE FUNCTION item_key(title TEXT, body TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT left(trim(regexp_replace(lower(coalesce(nullif(title, ''), left(body, 160))), '[^a-z0-9à-ÿ]+', ' ', 'g')), 120)
$$;

CREATE OR REPLACE FUNCTION remove_duplicate_items() RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE removed INTEGER;
BEGIN
    WITH ranked AS (
        SELECT id, row_number() OVER (
                   PARTITION BY item_key(title, text)
                   ORDER BY (analysed_by = 'llm') DESC NULLS LAST,
                            CASE platform WHEN 'news' THEN 0 WHEN 'google_news' THEN 1 WHEN 'gdelt' THEN 2 ELSE 3 END,
                            published_at, id) AS n
        FROM items
        WHERE length(item_key(title, text)) >= 25
    )
    DELETE FROM items USING ranked WHERE items.id = ranked.id AND ranked.n > 1;
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END $$;

REVOKE ALL ON FUNCTION remove_duplicate_items() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION remove_duplicate_items() TO service_role;

-- ------------------------------------------------------------
-- Politicians and the website snapshot
-- ------------------------------------------------------------
-- `politicians` is filled by the database itself (tag_politicians), from the rules in config/entities.yaml that
-- the pipeline sends on every run. New rows arrive with NULL and are tagged; when the rules change, every row is
-- re-tagged. The website reads one pre-computed JSON document (web_snapshot), rebuilt after every run, so it always
-- shows the latest data without querying 60,000+ rows from the browser.
ALTER TABLE items ADD COLUMN IF NOT EXISTS politicians TEXT[];
CREATE INDEX IF NOT EXISTS idx_items_politicians ON items USING GIN (politicians);
CREATE INDEX IF NOT EXISTS idx_items_untagged ON items (id) WHERE politicians IS NULL;

CREATE TABLE IF NOT EXISTS monitor_state (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE monitor_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS web_snapshot (
    id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    generated_at TIMESTAMPTZ NOT NULL,
    data         JSONB NOT NULL
);
ALTER TABLE web_snapshot ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'web_snapshot' AND policyname = 'public_read') THEN
        CREATE POLICY "public_read" ON web_snapshot FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION tag_politicians(spec JSONB) RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    fingerprint TEXT := md5(spec::text);
    changed INTEGER;
BEGIN
    -- rules changed since the last run: re-tag everything
    IF fingerprint IS DISTINCT FROM (SELECT value FROM monitor_state WHERE key = 'politician_spec') THEN
        UPDATE items SET politicians = NULL WHERE politicians IS NOT NULL;
        INSERT INTO monitor_state (key, value) VALUES ('politician_spec', fingerprint)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    END IF;
    UPDATE items i SET politicians = ARRAY(
        SELECT e->>'name' FROM jsonb_array_elements(spec) e
        WHERE coalesce(i.title, '') || ' ' || i.text ~ (e->>'pattern')
        ORDER BY e->>'name')
    WHERE i.politicians IS NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    RETURN changed;
END $$;

CREATE OR REPLACE FUNCTION refresh_web_snapshot(reference JSONB) RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE doc JSONB;
BEGIN
    WITH w AS (
        SELECT generate_series(date_trunc('week', now()) - INTERVAL '51 weeks', date_trunc('week', now()), INTERVAL '1 week')::date AS wk
    ),
    base AS (
        SELECT id, date_trunc('week', published_at)::date AS wk, published_at, platform, source, title, text, url,
               coalesce(likes, 0) + coalesce(shares, 0) AS reach, parties, issues, coalesce(politicians, '{}') AS politicians,
               sentiment, platform IN ('mastodon', 'bluesky', 'reddit', 'telegram', 'youtube', 'x') AS social
        FROM items WHERE published_at >= (SELECT min(wk) FROM w)
    ),
    ent AS (
        SELECT 'party' AS k, e AS name, wk, sentiment, social FROM base, unnest(parties) e
        UNION ALL SELECT 'issue', e, wk, sentiment, social FROM base, unnest(issues) e
        UNION ALL SELECT 'politician', e, wk, sentiment, social FROM base, unnest(politicians) e
    ),
    agg AS (
        SELECT k, name, wk, count(*) AS n, count(*) FILTER (WHERE sentiment = 'positive') AS pos,
               count(*) FILTER (WHERE sentiment = 'negative') AS neg, count(*) FILTER (WHERE social) AS soc
        FROM ent GROUP BY 1, 2, 3
    ),
    series AS (
        SELECT g.k, g.name, jsonb_build_object(
                   'n', jsonb_agg(coalesce(a.n, 0) ORDER BY w.wk), 'pos', jsonb_agg(coalesce(a.pos, 0) ORDER BY w.wk),
                   'neg', jsonb_agg(coalesce(a.neg, 0) ORDER BY w.wk), 'soc', jsonb_agg(coalesce(a.soc, 0) ORDER BY w.wk)) AS s
        FROM (SELECT DISTINCT k, name FROM agg) g CROSS JOIN w
        LEFT JOIN agg a ON a.k = g.k AND a.name = g.name AND a.wk = w.wk
        GROUP BY g.k, g.name
    ),
    total AS (
        SELECT jsonb_agg(coalesce(t.n, 0) ORDER BY w.wk) AS n, jsonb_agg(coalesce(t.soc, 0) ORDER BY w.wk) AS soc
        FROM w LEFT JOIN (SELECT wk, count(*) AS n, count(*) FILTER (WHERE social) AS soc FROM base GROUP BY wk) t USING (wk)
    ),
    pairs AS (
        SELECT 'party' AS k, p AS name, i AS issue, sentiment FROM base, unnest(parties) p, unnest(issues) i
        UNION ALL SELECT 'politician', p, i, sentiment FROM base, unnest(politicians) p, unnest(issues) i
        UNION ALL SELECT 'politician-party', p, q, sentiment FROM base, unnest(politicians) p, unnest(parties) q
    ),
    links AS (
        SELECT jsonb_agg(jsonb_build_object('k', k, 'a', name, 'b', issue, 'n', n, 'pos', pos, 'neg', neg) ORDER BY n DESC) AS j
        FROM (SELECT k, name, issue, count(*) AS n, count(*) FILTER (WHERE sentiment = 'positive') AS pos,
                     count(*) FILTER (WHERE sentiment = 'negative') AS neg
              FROM pairs GROUP BY 1, 2, 3 HAVING count(*) >= 5) x
    ),
    recent AS (
        SELECT DISTINCT ON (k, name, item_key(title, text)) k, name, title, source, platform, published_at, url, sentiment, reach
        FROM (SELECT 'party' AS k, e AS name, b.* FROM base b, unnest(parties) e
              UNION ALL SELECT 'issue', e, b.* FROM base b, unnest(issues) e
              UNION ALL SELECT 'politician', e, b.* FROM base b, unnest(politicians) e) x
        WHERE published_at >= now() - INTERVAL '30 days' AND title IS NOT NULL
        ORDER BY k, name, item_key(title, text), published_at DESC
    ),
    headlines AS (
        SELECT jsonb_agg(jsonb_build_object('k', k, 'name', name, 'title', title, 'source', source, 'platform', platform,
                   'd', published_at::date, 'url', url, 'sentiment', sentiment) ORDER BY k, name, published_at DESC) AS j
        FROM (SELECT *, row_number() OVER (PARTITION BY k, name ORDER BY published_at::date DESC, reach DESC) AS r FROM recent) x
        WHERE r <= 5
    ),
    busiest AS (
        SELECT wk FROM base GROUP BY wk ORDER BY count(*) DESC LIMIT 14
    ),
    peaks AS (
        SELECT jsonb_agg(jsonb_build_object('wk', wk, 'd', published_at::date, 'title', title, 'source', source,
                   'platform', platform, 'url', url, 'parties', parties, 'issues', issues, 'r', r) ORDER BY wk, r) AS j
        FROM (SELECT b.*, row_number() OVER (PARTITION BY b.wk ORDER BY cardinality(b.parties) + cardinality(b.issues) DESC,
                     b.reach DESC, b.published_at) AS r
              FROM base b JOIN busiest USING (wk) WHERE b.title IS NOT NULL AND NOT b.social) x
        WHERE r <= 3
    )
    SELECT jsonb_build_object(
        'version', 2,
        'generated', now(),
        'weeks', (SELECT jsonb_agg(wk ORDER BY wk) FROM w),
        'total', (SELECT jsonb_build_object('n', n, 'soc', soc) FROM total),
        'party', (SELECT coalesce(jsonb_object_agg(name, s), '{}') FROM series WHERE k = 'party'),
        'issue', (SELECT coalesce(jsonb_object_agg(name, s), '{}') FROM series WHERE k = 'issue'),
        'politician', (SELECT coalesce(jsonb_object_agg(name, s), '{}') FROM series WHERE k = 'politician'),
        'links', (SELECT coalesce(j, '[]') FROM links),
        'headlines', (SELECT coalesce(j, '[]') FROM headlines),
        'peaks', (SELECT coalesce(j, '[]') FROM peaks),
        'platforms', (SELECT jsonb_agg(jsonb_build_object('platform', platform, 'n', n) ORDER BY n DESC)
                      FROM (SELECT platform, count(*) AS n FROM items GROUP BY 1) p),
        'totals', (SELECT jsonb_build_object('items', count(*), 'first_day', min(published_at)::date, 'last_item', max(published_at),
                       'ai', count(*) FILTER (WHERE analysed_by = 'llm'), 'sources', count(DISTINCT source),
                       'with_party', count(*) FILTER (WHERE cardinality(parties) > 0),
                       'with_issue', count(*) FILTER (WHERE cardinality(issues) > 0),
                       'with_politician', count(*) FILTER (WHERE cardinality(politicians) > 0)) FROM items),
        'reference', reference
    ) INTO doc;
    INSERT INTO web_snapshot (id, generated_at, data) VALUES (1, now(), doc)
    ON CONFLICT (id) DO UPDATE SET generated_at = EXCLUDED.generated_at, data = EXCLUDED.data;
    RETURN length(doc::text);
END $$;

REVOKE ALL ON FUNCTION tag_politicians(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION refresh_web_snapshot(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tag_politicians(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION refresh_web_snapshot(JSONB) TO service_role;
-- the browser key may only read the snapshot (RLS already blocks writes; this makes it explicit)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON web_snapshot FROM anon, authenticated;
REVOKE ALL ON monitor_state FROM anon, authenticated;
