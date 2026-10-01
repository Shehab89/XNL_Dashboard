"""Free collectors. Each returns a list of items in the common format (see common.make_item).

A failing source never stops the run: it logs a warning and returns what it has.
"""

import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus

import feedparser
from bs4 import BeautifulSoup

from .common import Http, env, log, make_item, to_iso


def _since(hours):
    return datetime.now(timezone.utc) - timedelta(hours=hours)


def _recent(iso, since):
    return iso is None or iso >= since.isoformat()


def search_queries(entities):
    """One search query per party and per issue: (label, list of terms)."""
    queries = []
    for name, spec in entities["parties"].items():
        terms = [name] + [a for a in spec.get("exact", []) + spec.get("words", []) if " " not in a][:2]
        queries.append((name, list(dict.fromkeys(terms))))
    for name, stems in entities["issues"].items():
        terms = [s.rstrip("$") for s in stems if len(s.rstrip("$")) >= 5][:3]
        queries.append((name, terms))
    return queries


def _or(terms, quote=True):
    return " OR ".join(f'"{t}"' if quote and " " in t else t for t in terms)


# --------------------------------------------------------------------------- news RSS

def parse_feed(xml, platform, default_source, since):
    feed = feedparser.parse(xml)
    items = []
    for e in feed.entries:
        published = to_iso(e.get("published_parsed") or e.get("updated_parsed") or e.get("published"))
        if not _recent(published, since):
            continue
        source = default_source
        title = e.get("title", "")
        if platform == "google_news":
            source = (e.get("source") or {}).get("title") or default_source
            title = re.sub(rf"\s+-\s+{re.escape(source)}$", "", title)
        summary = e.get("summary", "")
        if platform == "google_news":
            summary = ""  # Google's summary only repeats the headline and related links
        author = e.get("author")
        if platform == "reddit":
            tags = e.get("tags") or []
            source = f"r/{tags[0]['term']}" if tags and tags[0].get("term") else default_source
            content = e.get("content") or [{}]
            summary = content[0].get("value", summary)
        items.append(make_item(platform, source, f"{title}. {summary}" if summary else title, url=e.get("link"),
                               uid=e.get("id") or e.get("link"), title=title, author=author,
                               published_at=published, lang="nl"))
    return items


def collect_news_feeds(cfg, http, since, **_):
    items = []
    for outlet, urls in (cfg.get("news_feeds") or {}).items():
        for url in urls:
            xml = http.get(url)
            if xml:
                items += parse_feed(xml, "news", outlet, since)
    return items


def collect_google_news(cfg, http, since, queries, **_):
    gcfg = cfg.get("google_news") or {}
    if not gcfg.get("enabled", True):
        return []
    days = max(1, round((datetime.now(timezone.utc) - since).total_seconds() / 86400))
    all_queries = [terms for _, terms in queries] + [[q] for q in gcfg.get("extra_queries", [])]
    items = []
    for terms in all_queries:
        q = f"{_or(terms)} when:{days}d"
        url = f"https://news.google.com/rss/search?q={quote_plus(q)}&hl=nl&gl=NL&ceid=NL:nl"
        xml = http.get(url)
        if xml:
            items += parse_feed(xml, "google_news", "Google News", since)[: cfg.get("max_per_query", 50)]
    return items


# --------------------------------------------------------------------------- GDELT

def parse_gdelt(data):
    items = []
    for a in (data or {}).get("articles", []):
        items.append(make_item("gdelt", a.get("domain") or "GDELT", a.get("title", ""), url=a.get("url"),
                               uid=a.get("url"), title=a.get("title"), published_at=a.get("seendate"),
                               lang="nl"))
    return items


def collect_gdelt(cfg, http, since, queries, **_):
    if not (cfg.get("gdelt") or {}).get("enabled", True):
        return []
    hours = max(1, int((datetime.now(timezone.utc) - since).total_seconds() // 3600))
    items = []
    for _label, terms in queries:
        clean = [f'"{t}"' if " " in t else t for t in terms if len(t) >= 3]
        if not clean:
            continue
        expr = f"({' OR '.join(clean)})" if len(clean) > 1 else clean[0]
        data = http.get("https://api.gdeltproject.org/api/v2/doc/doc", as_json=True, params={
            "query": f"{expr} sourcelang:dutch", "mode": "artlist", "format": "json",
            "maxrecords": cfg.get("max_per_query", 50), "timespan": f"{hours}h", "sort": "datedesc"})
        items += parse_gdelt(data)
        if http.is_down("https://api.gdeltproject.org"):
            break
        time.sleep(5)  # GDELT asks for at most one request every 5 seconds
    return items


# --------------------------------------------------------------------------- Bluesky

def parse_bluesky(data):
    items = []
    for p in (data or {}).get("posts", []):
        author = p.get("author", {})
        rkey = p.get("uri", "").rsplit("/", 1)[-1]
        record = p.get("record", {})
        items.append(make_item(
            "bluesky", "Bluesky", record.get("text", ""), uid=p.get("uri"),
            url=f"https://bsky.app/profile/{author.get('handle')}/post/{rkey}",
            author=author.get("handle"), published_at=record.get("createdAt") or p.get("indexedAt"),
            lang=(record.get("langs") or ["nl"])[0], likes=p.get("likeCount"),
            shares=(p.get("repostCount") or 0) + (p.get("quoteCount") or 0), replies=p.get("replyCount")))
    return items


def collect_bluesky(cfg, http, since, queries, **_):
    if not (cfg.get("bluesky") or {}).get("enabled", True):
        return []
    base, headers = "https://public.api.bsky.app", None
    handle, password = env("BSKY_HANDLE"), env("BSKY_APP_PASSWORD")
    if handle and password:
        session = http.post_json("https://bsky.social/xrpc/com.atproto.server.createSession",
                                 {"identifier": handle, "password": password})
        if session and session.get("accessJwt"):
            base, headers = "https://bsky.social", {"Authorization": f"Bearer {session['accessJwt']}"}
        else:
            log.warning("  ! Bluesky login failed; check BSKY_HANDLE / BSKY_APP_PASSWORD")
    items = []
    for _label, terms in queries:
        data = http.get(f"{base}/xrpc/app.bsky.feed.searchPosts", headers=headers, as_json=True, params={
            "q": _or(terms), "lang": "nl", "sort": "latest",
            "limit": min(100, cfg.get("max_per_query", 50)), "since": since.strftime("%Y-%m-%dT%H:%M:%SZ")})
        if data is None and headers is None:
            log.warning("  ! Bluesky search unavailable. It usually needs a free account: set BSKY_HANDLE and "
                        "BSKY_APP_PASSWORD")
            break
        items += parse_bluesky(data)
    return items


# --------------------------------------------------------------------------- Mastodon

def parse_mastodon(statuses, instance):
    items = []
    for s in statuses or []:
        account = s.get("account", {})
        items.append(make_item(
            "mastodon", instance, s.get("content", ""), url=s.get("url") or s.get("uri"), uid=s.get("uri"),
            author=account.get("acct"), published_at=s.get("created_at"), lang=s.get("language"),
            likes=s.get("favourites_count"), shares=s.get("reblogs_count"), replies=s.get("replies_count")))
    return items


def collect_mastodon(cfg, http, since, **_):
    mcfg = cfg.get("mastodon") or {}
    items = []
    for instance in mcfg.get("instances", []):
        for tag in mcfg.get("hashtags", []):
            data = http.get(f"https://{instance}/api/v1/timelines/tag/{tag}", params={"limit": 40}, as_json=True)
            if isinstance(data, list):
                items += [i for i in parse_mastodon(data, instance) if _recent(i["published_at"], since)]
    return items


# --------------------------------------------------------------------------- Reddit

def collect_reddit(cfg, http, since, queries, **_):
    subs = (cfg.get("reddit") or {}).get("subreddits", [])
    if not subs:
        return []
    joined = "+".join(subs)
    items = []
    for sub in subs:
        xml = http.get(f"https://www.reddit.com/r/{sub}/new/.rss", params={"limit": 100})
        if xml:
            items += parse_feed(xml, "reddit", f"r/{sub}", since)
    for _label, terms in queries:
        xml = http.get(f"https://www.reddit.com/r/{joined}/search.rss",
                       params={"q": _or(terms), "restrict_sr": "on", "sort": "new", "t": "week"})
        if xml:
            items += parse_feed(xml, "reddit", "Reddit", since)
    return items


# --------------------------------------------------------------------------- Telegram

def _count(text):
    if not text:
        return 0
    m = re.match(r"([\d.,]+)\s*([KM]?)", text.strip())
    if not m:
        return 0
    value = float(m.group(1).replace(",", "."))
    return int(value * {"K": 1_000, "M": 1_000_000}.get(m.group(2), 1))


def parse_telegram(page, channel):
    soup = BeautifulSoup(page, "html.parser")
    items = []
    for msg in soup.select(".tgme_widget_message[data-post]"):
        body = msg.select_one(".tgme_widget_message_text")
        if not body:
            continue
        post = msg["data-post"]
        when = msg.select_one(".tgme_widget_message_date time")
        views = msg.select_one(".tgme_widget_message_views")
        items.append(make_item(
            "telegram", f"t.me/{channel}", body.get_text(" ", strip=True), url=f"https://t.me/{post}", uid=post,
            author=channel, published_at=when.get("datetime") if when else None, lang="nl",
            likes=_count(views.get_text() if views else None)))
    return items


def collect_telegram(cfg, http, since, **_):
    items = []
    for channel in (cfg.get("telegram") or {}).get("channels", []):
        page = http.get(f"https://t.me/s/{channel}")
        if page:
            found = [i for i in parse_telegram(page, channel) if _recent(i["published_at"], since)]
            log.info("  telegram %s: %d recent posts", channel, len(found))
            items += found
    return items


# --------------------------------------------------------------------------- YouTube

_CHANNEL_ID = re.compile(r'(?:"channelId":"|"externalId":"|channel_id=|/channel/)(UC[\w-]{22})')


def resolve_youtube_channel(http, ref):
    """A channel ID (UC...) as is; an @handle is looked up on the channel page. None when it cannot be found."""
    if re.fullmatch(r"UC[\w-]{22}", ref):
        return ref
    page = http.get(f"https://www.youtube.com/{ref if ref.startswith('@') else '@' + ref}")
    match = _CHANNEL_ID.search(page or "")
    if not match:
        log.warning("YouTube channel %s not found (check the handle in config/sources.yaml)", ref)
    return match.group(1) if match else None


def collect_youtube(cfg, http, since, **_):
    items = []
    for name, ref in ((cfg.get("youtube") or {}).get("channels") or {}).items():
        channel_id = resolve_youtube_channel(http, ref)
        xml = http.get("https://www.youtube.com/feeds/videos.xml", params={"channel_id": channel_id}) if channel_id else None
        if not xml:
            continue
        found = 0
        for e in feedparser.parse(xml).entries:
            published = to_iso(e.get("published_parsed"))
            if not _recent(published, since):
                continue
            found += 1
            stats = e.get("media_statistics") or {}
            items.append(make_item("youtube", f"YouTube: {name}", f"{e.get('title', '')}. {e.get('summary', '')}",
                                   url=e.get("link"), uid=e.get("id"), title=e.get("title"), author=name,
                                   published_at=published, lang="nl", likes=_count(stats.get("views"))))
        log.info("  youtube %s: %d recent videos", name, found)
    return items


COLLECTORS = {
    "news": collect_news_feeds,
    "google_news": collect_google_news,
    "gdelt": collect_gdelt,
    "bluesky": collect_bluesky,
    "mastodon": collect_mastodon,
    "reddit": collect_reddit,
    "telegram": collect_telegram,
    "youtube": collect_youtube,
}


def collect_all(sources_cfg, entities, only=None, hours=None):
    """Run every collector (or only the named ones) and return all items plus a per-source count."""
    http = Http()
    since = _since(hours or sources_cfg.get("lookback_hours", 48))
    queries = search_queries(entities)
    items, report = [], {}
    for name, fn in COLLECTORS.items():
        if only and name not in only:
            continue
        log.info("Collecting %s ...", name)
        try:
            found = fn(sources_cfg, http=http, since=since, queries=queries)
        except Exception as exc:  # one broken source must not stop the others
            log.warning("  ! %s failed: %s: %s", name, type(exc).__name__, exc)
            found = []
        log.info("  %s: %d items", name, len(found))
        report[name] = len(found)
        items += found
    return items, report
