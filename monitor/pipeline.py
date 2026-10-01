"""Command line entry point.

    python -m monitor.pipeline run                  # collect from all sources, analyse, store
    python -m monitor.pipeline run --only news,bluesky --hours 24
    python -m monitor.pipeline demo                 # fill the local store with fictional demo data
    python -m monitor.pipeline queries              # print the search queries as JSON (used by the X scraper)
"""

import argparse
import json
import logging
import re
import sys

from .collectors import collect_all, search_queries
from .common import NEWS_PLATFORMS, load_yaml, log, make_item
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


def run(only=None, hours=None, backend=None, retention_days=180, extra_json=None, require_db=False):
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
    items, used = analyse(unique, Tagger(entities), backend=backend)
    log.info("Collected %d items, %d unique, %d political (sentiment: %s)", len(raw), len(unique), len(items), used)

    saved = store.upsert(items)
    log.info("Saved %d items to %s", saved, store.name)
    if retention_days:
        store.prune(retention_days)

    empty = [name for name, n in report.items() if n == 0]
    if empty:
        log.info("Sources that returned nothing this run: %s", ", ".join(empty))
    if not raw:
        log.error("No source returned any data. Check the network connection and config/sources.yaml.")
        return 1
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
    p_run.add_argument("--backend", choices=["local", "api", "lexicon"], help="sentiment backend")
    p_run.add_argument("--retention-days", type=int, default=180, help="delete items older than this")
    p_run.add_argument("--extra-json", help="also analyse items from this JSON file (e.g. the X scraper output)")
    p_run.add_argument("--require-db", action="store_true", help="fail unless Supabase is configured")
    sub.add_parser("demo", help="write fictional demo data to the local store")
    sub.add_parser("queries", help="print the search queries as JSON")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    if args.cmd == "run":
        only = set(args.only.split(",")) if args.only else None
        return run(only, args.hours, args.backend, args.retention_days, args.extra_json, args.require_db)
    if args.cmd == "queries":
        print(json.dumps([{"label": label, "terms": terms}
                          for label, terms in search_queries(load_yaml("entities.yaml"))], ensure_ascii=False))
        return 0
    return demo()


if __name__ == "__main__":
    sys.exit(main())
