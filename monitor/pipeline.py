"""Command line entry point.

    python -m monitor.pipeline run                  # collect from all sources, analyse, store
    python -m monitor.pipeline run --only news,bluesky --hours 24
    python -m monitor.pipeline backfill --days 365   # one-off: collect the past year from sources searchable by date
    python -m monitor.pipeline demo                 # fill the local store with fictional demo data
    python -m monitor.pipeline queries              # print the search queries as JSON (used by the X scraper)
"""

import argparse
import json
import logging
import re
import sys
import time
from datetime import datetime, timedelta, timezone

from . import llm
from .collectors import (GOOGLE_NEWS, collect_all, history_gdelt, history_google_news, history_mastodon,
                         search_queries)
from .common import NEWS_PLATFORMS, Http, env, load_yaml, log, make_item
from .nlp import Tagger, analyse
from .storage import LocalStore, SupabaseStore, get_store

# When the same article arrives from several news sources, keep the richest one.
_NEWS_PREFERENCE = {"news": 0, "google_news": 1, "gdelt": 2}


def _norm_title(text):
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()[:120]


def dedupe(items):
    """Drop exact duplicates (same id) and the same headline reported via several news sources."""
    by_id = {i["id"]: i for i in items}
    news = sorted((i for i in by_id.values() if i["platform"] in NEWS_PLATFORMS),
                  key=lambda i: _NEWS_PREFERENCE.get(i["platform"], 9))
    seen, kept = set(), [i for i in by_id.values() if i["platform"] not in NEWS_PLATFORMS]
    for item in news:
        key = _norm_title(item.get("title") or item["text"])
        if key and key not in seen:
            seen.add(key)
            kept.append(item)
    return kept


def load_extra(path):
    """Items produced by an external scraper (e.g. scraper/x_items.json from the X scraper)."""
    try:
        with open(path, encoding="utf-8") as fh:
            rows = json.load(fh)
    except FileNotFoundError:
        log.info("No extra items file at %s (skipped)", path)
        return []
    items = [make_item(r.get("platform", "x"), r.get("source", "X"), r.get("text", ""), url=r.get("url"),
                       uid=r.get("uid") or r.get("url"), author=r.get("author"), published_at=r.get("published_at"),
                       lang=r.get("lang", "nl"), likes=r.get("likes"), shares=r.get("shares"),
                       replies=r.get("replies")) for r in rows if r.get("text")]
    log.info("Loaded %d extra items from %s", len(items), path)
    return items


def run(only=None, hours=None, backend=None, retention_days=400, extra_json=None, require_db=False):
    store = get_store()
    if require_db and not isinstance(store, SupabaseStore):
        log.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required here (results would be lost).")
        return 2
    sources_cfg, entities = load_yaml("sources.yaml"), load_yaml("entities.yaml")
    raw, report = collect_all(sources_cfg, entities, only=only, hours=hours)
    if extra_json:
        extra = load_extra(extra_json)
        report["extra"] = len(extra)
        raw += extra
    unique = dedupe(raw)
    # items the LLM already labelled in an earlier run are not sent (and paid for) again
    known = store.llm_done_ids([i["id"] for i in unique])
    fresh = [i for i in unique if i["id"] not in known]
    if known:
        log.info("%d items were already analysed by the LLM in an earlier run (skipped)", len(known))
    items, used = analyse(fresh, Tagger(entities), backend=backend)
    log.info("Collected %d items, %d unique, %d new, %d political (sentiment: %s)", len(raw), len(unique), len(fresh),
             len(items), used)

    saved = store.upsert(items)
    log.info("Saved %d items to %s", saved, store.name)
    if backend in (None, "", "llm"):
        relabel_backlog(store, entities, int(env("LLM_BACKLOG", "600")))
    if retention_days:
        store.prune(retention_days)

    empty = [name for name, n in report.items() if n == 0]
    if empty:
        log.info("Sources that returned nothing this run: %s", ", ".join(empty))
    if not raw:
        log.error("No source returned any data. Check the network connection and config/sources.yaml.")
        return 1
    return 0


def relabel_backlog(store, entities, limit):
    """Spend the LLM quota left after the new items on older items that only have fallback labels
    (e.g. from the backfill). Items the LLM finds not political are removed."""
    if not limit or not llm.available():
        return 0
    rows = store.backlog(limit)
    if not rows:
        return 0
    tagger = Tagger(entities)
    answers = llm.classify(rows, [n for n, _ in tagger.parties], [n for n, _ in tagger.issues])
    keep, drop = [], []
    for row, answer in zip(rows, answers):
        if answer is None:
            continue
        if answer["relevant"]:
            keep.append({**row, "parties": answer["parties"], "issues": answer["issues"],
                         "sentiment": answer["sentiment"], "sentiment_score": answer["score"], "analysed_by": "llm"})
        else:
            drop.append(row["id"])
    if keep:
        store.upsert(keep)
    if drop:
        store.delete(drop)
    log.info("Backlog: the LLM relabelled %d older items and removed %d that are not political", len(keep), len(drop))
    return len(keep)


def backfill(days=365, window_days=7, until=None, sources=("google_news", "gdelt", "mastodon"), pause=4.0):
    """One-off collection of the past `days`, newest week first, saved week by week so an interrupted run
    keeps what it has. Requests are slow and jittered so the sources do not block us; a source that starts
    refusing gets one 10-minute cool-down, then the backfill stops and says where to resume.

    Labels come from the local model (the LLM quota is kept for new items); regular runs then relabel these
    items with the LLM a few hundred at a time (see relabel_backlog)."""
    store = get_store()
    sources_cfg, entities = load_yaml("sources.yaml"), load_yaml("entities.yaml")
    queries, tagger = search_queries(entities), Tagger(entities)
    http = Http(pause=pause, jitter=pause)
    end = (until or datetime.now(timezone.utc)).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    start_all = end - timedelta(days=days)
    total = 0

    def save(raw, label):
        nonlocal total
        unique = dedupe(raw)
        known = store.llm_done_ids([i["id"] for i in unique])
        items, used = analyse([i for i in unique if i["id"] not in known], tagger, backend="local")
        store.upsert(items)
        total += len(items)
        log.info("%s: %d collected, %d political saved (%s); %d in total", label, len(raw), len(items), used, total)

    if "mastodon" in sources:
        save(history_mastodon(sources_cfg, http, start_all), "Mastodon history")

    w_end = end
    while w_end > start_all:
        w_start = max(start_all, w_end - timedelta(days=window_days))
        raw = []
        if "google_news" in sources:
            found = history_google_news(sources_cfg, http, w_start, w_end, queries)
            if http.is_down(GOOGLE_NEWS):
                log.warning("Google News is refusing requests; cooling down for 10 minutes")
                time.sleep(600)
                http.reset(GOOGLE_NEWS)
                found = history_google_news(sources_cfg, http, w_start, w_end, queries)
                if http.is_down(GOOGLE_NEWS):
                    log.error("Google News still refuses; stopping. Resume later with --until %s", f"{w_end:%Y-%m-%d}")
                    save(raw + found, f"{w_start:%Y-%m-%d} – {w_end:%Y-%m-%d}")
                    return 1
            raw += found
        if "gdelt" in sources:
            raw += history_gdelt(sources_cfg, http, w_start, w_end, queries)
        save(raw, f"{w_start:%Y-%m-%d} – {w_end:%Y-%m-%d}")
        w_end = w_start
    log.info("Backfill done: %d political items saved for %s – %s", total, f"{start_all:%Y-%m-%d}", f"{end:%Y-%m-%d}")
    return 0


def demo(days=30):
    from .demo import make_demo_items

    items = make_demo_items(days=days)
    LocalStore().upsert(items)
    log.info("Wrote %d fictional demo items to data/items.parquet", len(items))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Dutch Political Media Monitor pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_run = sub.add_parser("run", help="collect, analyse and store")
    p_run.add_argument("--only", help="comma-separated sources, e.g. news,google_news,bluesky")
    p_run.add_argument("--hours", type=int, help="look back this many hours (default from sources.yaml)")
    p_run.add_argument("--backend", choices=["llm", "local", "api", "lexicon"], help="sentiment backend")
    p_run.add_argument("--retention-days", type=int, default=400, help="delete items older than this")
    p_run.add_argument("--extra-json", help="also analyse items from this JSON file (e.g. the X scraper output)")
    p_run.add_argument("--require-db", action="store_true", help="fail unless Supabase is configured")
    p_back = sub.add_parser("backfill", help="one-off: collect the past N days from sources searchable by date")
    p_back.add_argument("--days", type=int, default=365)
    p_back.add_argument("--until", help="newest date to collect (YYYY-MM-DD), to resume an interrupted backfill")
    p_back.add_argument("--sources", default="google_news,gdelt,mastodon")
    sub.add_parser("demo", help="write fictional demo data to the local store")
    sub.add_parser("queries", help="print the search queries as JSON")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    if args.cmd == "run":
        only = set(args.only.split(",")) if args.only else None
        return run(only, args.hours, args.backend, args.retention_days, args.extra_json, args.require_db)
    if args.cmd == "backfill":
        until = datetime.strptime(args.until, "%Y-%m-%d").replace(tzinfo=timezone.utc) if args.until else None
        return backfill(args.days, until=until, sources=tuple(args.sources.split(",")))
    if args.cmd == "queries":
        print(json.dumps([{"label": label, "terms": terms}
                          for label, terms in search_queries(load_yaml("entities.yaml"))], ensure_ascii=False))
        return 0
    return demo()


if __name__ == "__main__":
    sys.exit(main())
