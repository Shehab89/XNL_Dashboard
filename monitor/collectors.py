"""Free collectors. Each returns a list of items in the common format (see common.make_item).

A failing source never stops the run: it logs a warning and returns what it has.
"""

import json
import os
import random
import re
import shutil
import subprocess
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
    """One search query per party, per politician (full name) and per issue: (label, list of terms)."""
    queries = []
    for name, spec in entities["parties"].items():
        terms = [name] + [a for a in spec.get("exact", []) + spec.get("words", []) if " " not in a][:2]
        queries.append((name, list(dict.fromkeys(terms))))
    for name, spec in (entities.get("politicians") or {}).items():
        queries.append((name, [name]))
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
    for url in gcfg.get("feeds", []):  # section feeds (e.g. Binnenland) without a search
        xml = http.get(url)
        if xml:
            items += parse_feed(xml, "google_news", "Google News", since)
    for terms in all_queries:
        q = f"{_or(terms)} when:{days}d"
        url = f"https://news.google.com/rss/search?q={quote_plus(q)}&hl=nl&gl=NL&ceid=NL:nl"
        xml = http.get(url)
        if xml:
            items += parse_feed(xml, "google_news", "Google News", since)[: cfg.get("max_per_query", 50)]
    return items


# --------------------------------------------------------------------------- GDELT

GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"


def parse_gdelt(data):
    items = []
    for a in (data or {}).get("articles", []):
        items.append(make_item("gdelt", a.get("domain") or "GDELT", a.get("title", ""), url=a.get("url"),
                               uid=a.get("url"), title=a.get("title"), published_at=a.get("seendate"),
                               lang="nl"))
    return items


def _gdelt_expr(terms):
    """GDELT query for terms in Dutch-language news, or None when no term is long enough for GDELT."""
    clean = [f'"{t}"' if " " in t else t for t in terms if len(t) >= 3]
    if not clean:
        return None
    return f"({' OR '.join(clean)}) sourcelang:dutch" if len(clean) > 1 else f"{clean[0]} sourcelang:dutch"


def collect_gdelt(cfg, http, since, queries, **_):
    gcfg = cfg.get("gdelt") or {}
    if not gcfg.get("enabled", True):
        return []
    hours = max(1, int((datetime.now(timezone.utc) - since).total_seconds() // 3600))
    all_queries = [q for q in (_gdelt_expr(terms) for _, terms in queries) if q] + gcfg.get("extra_queries", [])
    items, misses = [], 0
    for query in all_queries:
        data = http.get(GDELT, as_json=True, timeout=60, params={
            "query": query, "mode": "artlist", "format": "json",
            "maxrecords": gcfg.get("maxrecords", 250), "timespan": f"{hours}h", "sort": "datedesc"})
        items += parse_gdelt(data)
        # GDELT is slow and answers bursts with a plain-text "please limit requests" page: back off, but keep going
        # unless it fails many times in a row
        misses = 0 if data is not None else misses + 1
        if misses >= 6:
            log.warning("  ! GDELT failed %d times in a row: stopping for this run", misses)
            break
        http.reset(GDELT)
        time.sleep(5 if data is not None else 15)
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


def mastodon_timeline(http, instance, path, since, max_pages, params=None):
    """One Mastodon timeline (e.g. /api/v1/timelines/tag/politiek) paged back to `since`, 40 posts per page."""
    items, max_id = [], None
    for _ in range(max_pages):
        data = http.get(f"https://{instance}{path}", as_json=True,
                        params={**(params or {}), "limit": 40, **({"max_id": max_id} if max_id else {})})
        if not isinstance(data, list) or not data:
            break
        page = parse_mastodon(data, instance)
        items += [i for i in page if _recent(i["published_at"], since)]
        max_id = data[-1].get("id")
        if not _recent(page[-1]["published_at"], since):
            break
    return items


def collect_mastodon(cfg, http, since, **_):
    """Hashtag timelines on every instance plus the whole local timeline of Dutch servers, paged back to `since`."""
    mcfg = cfg.get("mastodon") or {}
    items = []
    for instance in mcfg.get("local_timelines", []):
        found = mastodon_timeline(http, instance, "/api/v1/timelines/public", since, mcfg.get("local_pages", 25),
                                  {"local": "true"})
        log.info("  mastodon %s local timeline: %d posts", instance, len(found))
        items += found
    for instance in mcfg.get("instances", []):
        for tag in mcfg.get("hashtags", []):
            if http.is_down(f"https://{instance}"):
                break
            items += mastodon_timeline(http, instance, f"/api/v1/timelines/tag/{tag}", since, mcfg.get("max_pages", 5))
    return items


# --------------------------------------------------------------------------- Reddit

def parse_reddit_listing(data, since):
    """Posts and comments from a Reddit JSON listing (oauth.reddit.com)."""
    items = []
    for child in ((data or {}).get("data") or {}).get("children", []):
        d, kind = child.get("data") or {}, child.get("kind")
        published = datetime.fromtimestamp(d.get("created_utc") or 0, timezone.utc)
        if published < since:
            continue
        title = d.get("title") or (d.get("link_title") and f"Re: {d['link_title']}")
        text = d.get("selftext") if kind == "t3" else d.get("body")
        items.append(make_item(
            "reddit", f"r/{d.get('subreddit')}", f"{d.get('title') or ''}. {text or ''}".strip(". "),
            url=f"https://www.reddit.com{d.get('permalink', '')}", uid=d.get("name") or d.get("id"), title=title,
            author=d.get("author"), published_at=published.isoformat(), lang="nl", likes=d.get("score"),
            replies=d.get("num_comments")))
    return items


def _reddit_token(http):
    """App-only OAuth token (free Reddit "script" app). Reddit blocks anonymous requests from cloud servers such as
    GitHub Actions, so without REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET only the RSS fallback is tried."""
    cid, secret = env("REDDIT_CLIENT_ID"), env("REDDIT_CLIENT_SECRET")
    if not (cid and secret):
        return None
    try:
        resp = http.session.post("https://www.reddit.com/api/v1/access_token", auth=(cid, secret),
                                 data={"grant_type": "client_credentials"}, timeout=30)
        return resp.json().get("access_token") if resp.status_code == 200 else None
    except Exception:
        return None


def collect_reddit(cfg, http, since, queries, **_):
    subs = (cfg.get("reddit") or {}).get("subreddits", [])
    if not subs:
        return []
    joined = "+".join(subs)
    token = _reddit_token(http)
    if token:
        api, headers, items = "https://oauth.reddit.com", {"Authorization": f"bearer {token}"}, []
        for path in (f"/r/{joined}/new", f"/r/{joined}/comments"):  # newest posts and newest comments, all subs at once
            after = None
            for _ in range(5):
                data = http.get(api + path, headers=headers, as_json=True, params={"limit": 100, **({"after": after} if after else {})})
                page = parse_reddit_listing(data, since)
                items += page
                after = ((data or {}).get("data") or {}).get("after")
                if not after or len(page) < 50:
                    break
        for _label, terms in queries:
            items += parse_reddit_listing(http.get(api + f"/r/{joined}/search", headers=headers, as_json=True, params={
                "q": _or(terms), "restrict_sr": 1, "sort": "new", "t": "week", "limit": 100}), since)
        return items
    log.info("  reddit: no REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET; trying RSS (often blocked from cloud servers)")
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


def _youtube_page(http, url, params=None):
    try:  # direct request: a wrong handle (404) must not make Http skip the YouTube feeds
        resp = http.session.get(url, params=params, timeout=25)
        return resp.text if resp.status_code == 200 else ""
    except Exception:
        return ""


def resolve_youtube_channel(http, ref, name=None):
    """A channel ID (UC...) as is; an @handle is looked up on the channel page. When the handle does not exist,
    the first channel YouTube's search finds for `name` is used. None when neither works."""
    if re.fullmatch(r"UC[\w-]{22}", ref):
        return ref
    match = _CHANNEL_ID.search(_youtube_page(http, f"https://www.youtube.com/{ref if ref.startswith('@') else '@' + ref}"))
    if not match and name:  # sp=EgIQAg== limits the search to channels
        match = _CHANNEL_ID.search(_youtube_page(http, "https://www.youtube.com/results",
                                                 {"search_query": name, "sp": "EgIQAg=="}))
        if match:
            log.info("YouTube %s not found: using channel %s from a search for \"%s\"", ref, match.group(1), name)
    if not match:
        log.warning("YouTube channel %s not found (check the handle in config/sources.yaml)", ref)
    return match.group(1) if match else None


YOUTUBE_COMMENTS = "https://www.googleapis.com/youtube/v3/commentThreads"


def parse_youtube_comments(data, channel, video_id):
    """Top-level comments from a YouTube Data API commentThreads.list answer."""
    items = []
    for thread in (data or {}).get("items", []):
        comment = thread.get("snippet", {}).get("topLevelComment", {})
        s = comment.get("snippet", {})
        items.append(make_item(
            "youtube_comment", f"YouTube-reacties: {channel}", s.get("textDisplay") or s.get("textOriginal", ""),
            url=f"https://www.youtube.com/watch?v={video_id}&lc={comment.get('id')}", uid=comment.get("id"),
            author=s.get("authorDisplayName"), published_at=s.get("publishedAt"), lang="nl",
            likes=s.get("likeCount"), replies=thread.get("snippet", {}).get("totalReplyCount")))
    return items


def collect_youtube_comments(http, key, videos, pages=1):
    """Newest top-level comments of (video_id, channel) pairs; 1 API quota unit per request (10,000 free a day)."""
    items = []
    for video_id, channel in videos:
        token = None
        for _ in range(pages):
            params = {"part": "snippet", "videoId": video_id, "order": "time", "maxResults": 100,
                      "textFormat": "plainText", "key": key, **({"pageToken": token} if token else {})}
            try:  # direct request: comments switched off on one video (403) must not block the others
                resp = http.session.get(YOUTUBE_COMMENTS, params=params, timeout=25)
            except Exception as exc:
                log.warning("  ! YouTube API unreachable (%s)", type(exc).__name__)
                return items
            if resp.status_code != 200:
                video_problem = resp.status_code == 404 or "commentsDisabled" in resp.text
                if not video_problem:  # bad key, API not enabled or daily quota used up
                    log.warning("  ! YouTube API refused (HTTP %s): check YOUTUBE_API_KEY and its daily quota",
                                resp.status_code)
                    return items
                break
            data = resp.json()
            items += parse_youtube_comments(data, channel, video_id)
            token = data.get("nextPageToken")
            if not token:
                break
    return items


def collect_youtube(cfg, http, since, **_):
    ycfg = cfg.get("youtube") or {}
    items, videos = [], []
    for name, ref in (ycfg.get("channels") or {}).items():
        channel_id = resolve_youtube_channel(http, ref, name)
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
            videos.append((published or "", e.get("yt_videoid") or e.get("id", "").rsplit(":", 1)[-1], name))
            items.append(make_item("youtube", f"YouTube: {name}", f"{e.get('title', '')}. {e.get('summary', '')}",
                                   url=e.get("link"), uid=e.get("id"), title=e.get("title"), author=name,
                                   published_at=published, lang="nl", likes=_count(stats.get("views"))))
        log.info("  youtube %s: %d recent videos", name, found)
    key = env("YOUTUBE_API_KEY")
    if key and videos:  # optional: viewers' comments on the newest videos (YouTube Data API v3)
        newest = [(vid, name) for _, vid, name in sorted(videos, reverse=True)[: ycfg.get("comment_videos", 60)]]
        comments = collect_youtube_comments(http, key, newest, ycfg.get("comment_pages", 1))
        log.info("  youtube comments: %d on %d videos", len(comments), len(newest))
        items += comments
    return items


# --------------------------------------------------------------------------- history (one-off backfill)
# Only a few free sources can be searched by date. These functions collect one date window at a time and are
# used by `python -m monitor.pipeline backfill`; the regular run never calls them.

GOOGLE_NEWS = "https://news.google.com/rss/search"


def _in_window(item, start, end):
    return item["published_at"] and start.isoformat() <= item["published_at"] < end.isoformat()


def history_google_news(cfg, http, start, end, queries):
    """Google News articles published between start and end (Google returns at most ~100 per search)."""
    all_queries = [terms for _, terms in queries] + [[q] for q in (cfg.get("google_news") or {}).get("extra_queries", [])]
    items = []
    for terms in all_queries:
        q = f"{_or(terms)} after:{start:%Y-%m-%d} before:{end:%Y-%m-%d}"
        xml = http.get(GOOGLE_NEWS, params={"q": q, "hl": "nl", "gl": "NL", "ceid": "NL:nl"})
        if xml:
            items += [i for i in parse_feed(xml, "google_news", "Google News", start) if _in_window(i, start, end)]
        if http.is_down(GOOGLE_NEWS):
            break
    return items


def history_gdelt(cfg, http, start, end, queries):
    """GDELT articles between start and end. GDELT's free API only searches the last three months."""
    if start < datetime.now(timezone.utc) - timedelta(days=89):
        return []
    items = []
    for query in filter(None, (_gdelt_expr(terms) for _, terms in queries)):
        data = http.get("https://api.gdeltproject.org/api/v2/doc/doc", as_json=True, params={
            "query": query, "mode": "artlist", "format": "json", "maxrecords": 100,
            "startdatetime": f"{start:%Y%m%d%H%M%S}", "enddatetime": f"{end:%Y%m%d%H%M%S}", "sort": "datedesc"})
        items += parse_gdelt(data)
        if http.is_down("https://api.gdeltproject.org"):
            break
        time.sleep(6)  # GDELT asks for at most one request every 5 seconds
    return items


def history_mastodon(cfg, http, since, max_pages=15):
    """Mastodon hashtag timelines paged back to `since` (40 posts per page)."""
    mcfg = cfg.get("mastodon") or {}
    items = []
    for instance in mcfg.get("instances", []):
        for tag in mcfg.get("hashtags", []):
            found = mastodon_timeline(http, instance, f"/api/v1/timelines/tag/{tag}", since, max_pages)
            items += found
            if http.is_down(f"https://{instance}"):
                break
            log.info("  mastodon %s #%s: %d posts", instance, tag, len(found))
    return items


# --------------------------------------------------------------------------- X (no login)
# X's embed service (the one behind "embedded timeline" widgets on news sites) serves an account's recent posts
# without an account or API key. It covers accounts, not search, and X may limit or change it: a profile that returns
# nothing is logged and skipped. Search-level X data needs the logged-in scraper in scraper/ (see README).

X_EMBED = "https://syndication.twitter.com/srv/timeline-profile/screen-name/"


def parse_x_embed(page, handle):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page or "", re.S)
    if not m:
        return []
    entries = (((json.loads(m.group(1)).get("props") or {}).get("pageProps") or {}).get("timeline") or {}).get("entries") or []
    items = []
    for e in entries:
        tw = (e.get("content") or {}).get("tweet") or {}
        if not tw.get("id_str"):
            continue
        user = (tw.get("user") or {}).get("screen_name") or handle
        published = to_iso(datetime.strptime(tw["created_at"], "%a %b %d %H:%M:%S %z %Y")) if tw.get("created_at") else None
        items.append(make_item(
            "x", f"X: @{user}", tw.get("full_text") or tw.get("text") or "", url=f"https://x.com/{user}/status/{tw['id_str']}",
            uid=f"x:{tw['id_str']}", author=user, published_at=published, lang=tw.get("lang") or "nl",
            likes=tw.get("favorite_count"), shares=(tw.get("retweet_count") or 0) + (tw.get("quote_count") or 0),
            replies=tw.get("reply_count")))
    return items


def collect_x_profiles(cfg, http, since, **_):
    items = []
    for handle in (cfg.get("x_profiles") or {}).get("accounts", []):
        page = http.get(X_EMBED + handle, params={"showReplies": "false"}, headers={"Accept": "text/html"})
        found = [i for i in parse_x_embed(page, handle) if _recent(i["published_at"], since)]
        log.info("  x @%s: %d recent posts", handle, len(found))
        items += found
        if http.is_down(X_EMBED):
            break
        time.sleep(2)  # be gentle: X throttles bursts
    return items


def parse_x_cli(payload):
    """Posts from twitter-cli's JSON output ({"ok": true, "data": [...]} or a bare list)."""
    rows = payload.get("data") if isinstance(payload, dict) else payload
    items = []
    for t in rows or []:
        handle = (t.get("author") or {}).get("screenName") or ""
        if not t.get("id") or not handle or t.get("isRetweet"):
            continue
        m = t.get("metrics") or {}
        items.append(make_item(
            "x", "X", t.get("text", ""), url=f"https://x.com/{handle}/status/{t['id']}", uid=str(t["id"]),
            author=handle, published_at=t.get("createdAtISO") or t.get("createdAt"), lang=t.get("lang") or "nl",
            likes=m.get("likes"), shares=m.get("retweets"), replies=m.get("replies")))
    return items


def collect_x_search(cfg, http, since, queries, **_):
    """X "Latest" search through twitter-cli (X's own web API with your login cookies, no browser).

    Needs X_AUTH_TOKEN and X_CT0 and the `twitter` command (pip install twitter-cli). Against X's terms, so
    use a secondary account. Stops after three empty searches in a row (expired cookies, rate limit)."""
    conf = cfg.get("x_search") or {}
    token, ct0 = env("X_AUTH_TOKEN"), env("X_CT0")
    if not conf.get("enabled", True) or not (token and ct0):
        return []
    if not shutil.which("twitter"):
        log.warning("  ! twitter-cli is not installed: pip install twitter-cli")
        return []
    run_env = {**os.environ, "TWITTER_AUTH_TOKEN": token, "TWITTER_CT0": ct0}
    deadline = time.time() + 60 * conf.get("max_minutes", 20)
    items, misses = [], 0
    for label, terms in random.sample(queries, len(queries)):
        if time.time() > deadline or misses >= 3:
            log.info("  x search: stopping (%s)", "3 empty searches in a row" if misses >= 3 else "time budget used")
            break
        cmd = ["twitter", "search", _or(terms), "-t", "latest", "--lang", "nl",
               "--since", since.strftime("%Y-%m-%d"), "-n", str(conf.get("per_query", 60)), "--json"]
        found = []
        try:
            out = subprocess.run(cmd, env=run_env, capture_output=True, text=True, timeout=120)
            if out.returncode:
                log.info("  x %s: failed: %s", label, ((out.stderr or out.stdout).strip().splitlines() or ["?"])[-1][:200])
            else:
                found = [i for i in parse_x_cli(json.loads(out.stdout or "null")) if _recent(i["published_at"], since)]
        except (subprocess.TimeoutExpired, ValueError) as exc:
            log.info("  x %s: %s", label, type(exc).__name__)
        misses = 0 if found else misses + 1
        log.info("  x %s: %d posts", label, len(found))
        items += found
        time.sleep(random.uniform(3, 7))  # human pace; X throttles bursts
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
    "x_profiles": collect_x_profiles,
    "x_search": collect_x_search,
}


def collect_all(sources_cfg, entities, only=None, hours=None, http=None):
    """Run every collector (or only the named ones) and return all items plus a per-source count."""
    http = http or Http()
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
