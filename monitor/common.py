"""Shared helpers: config loading, the common item format, HTTP with polite retries, text cleaning."""

import hashlib
import html
import logging
import os
import random
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
log = logging.getLogger("monitor")

# Channels group platforms for the "news vs social" comparisons.
NEWS_PLATFORMS = {"news", "google_news", "gdelt"}
PLATFORM_LABELS = {
    "news": "News sites (RSS)", "google_news": "Google News", "gdelt": "GDELT news",
    "bluesky": "Bluesky", "mastodon": "Mastodon", "reddit": "Reddit", "telegram": "Telegram",
    "youtube": "YouTube", "youtube_comment": "YouTube comments", "x": "X / Twitter",
}

USER_AGENT = ("Mozilla/5.0 (compatible; DutchPoliticalMediaMonitor/2.0; research; "
              "+https://github.com/Shehab89/XNL_Dashboard)")

ITEM_FIELDS = ["id", "platform", "source", "author", "title", "text", "url", "published_at", "collected_at",
               "lang", "likes", "shares", "replies", "parties", "issues", "sentiment", "sentiment_score",
               "analysed_by"]


def _load_dotenv():
    """Read KEY=VALUE lines from .env in the project root (without overriding real environment variables)."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split(" #", 1)[0].strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            if value.strip() and not os.environ.get(key.strip()):
                os.environ[key.strip()] = value.strip().strip('"').strip("'")


_load_dotenv()


def load_yaml(name):
    with open(ROOT / "config" / name, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def env(name, default=None):
    """Environment variable, falling back to Streamlit secrets when running inside Streamlit."""
    value = os.environ.get(name)
    if value:
        return value.strip()
    try:
        import streamlit as st

        value = st.secrets.get(name)
    except Exception:
        value = None
    return str(value).strip() if value else default


def channel_of(platform):
    return "News media" if platform in NEWS_PLATFORMS else "Social media"


def clean_text(raw):
    """Strip HTML tags/entities and collapse whitespace."""
    if not raw:
        return ""
    text = re.sub(r"<br\s*/?>|</p>", " ", str(raw), flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def to_iso(value):
    """Normalise many date formats (ISO strings, struct_time, epoch) to an ISO-8601 UTC string."""
    if value in (None, ""):
        return None
    try:
        if isinstance(value, time.struct_time):
            dt = datetime(*value[:6], tzinfo=timezone.utc)
        elif isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(value, tz=timezone.utc)
        elif isinstance(value, datetime):
            dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        else:
            s = str(value).strip()
            if re.fullmatch(r"\d{8}T\d{6}Z", s):  # GDELT: 20260929T101500Z
                dt = datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            else:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
                dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def make_item(platform, source, text, url=None, uid=None, title=None, author=None, published_at=None,
              lang=None, likes=0, shares=0, replies=0):
    """One post or article in the common format. `id` is stable, so re-collecting never duplicates."""
    text, title = clean_text(text), clean_text(title) or None
    key = uid or url or f"{source}|{title}|{text[:200]}"
    return {
        "id": f"{platform}:{hashlib.sha1(str(key).encode()).hexdigest()[:20]}",
        "platform": platform,
        "source": source,
        "author": author,
        "title": title,
        "text": text[:4000],
        "url": url,
        "published_at": to_iso(published_at) or now_iso(),
        "collected_at": now_iso(),
        "lang": lang,
        "likes": int(likes or 0),
        "shares": int(shares or 0),
        "replies": int(replies or 0),
    }


class Http:
    """requests.Session with a clear User-Agent, timeouts and retry/backoff on 429 and 5xx.

    A host that fails 3 requests in a row is skipped for the rest of the run, so one blocked or
    unreachable source cannot slow down the whole collection.
    """

    def __init__(self, pause=0.5, jitter=0.0):
        import requests

        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "nl,en;q=0.8"})
        self.pause, self.jitter = pause, jitter
        self.failures = {}

    def _host(self, url):
        return url.split("/")[2] if "://" in url else url

    def get(self, url, params=None, headers=None, tries=3, as_json=False):
        """Return response text (or parsed JSON), or None when the source is unavailable."""
        import requests

        host = self._host(url)
        if self.failures.get(host, 0) >= 3:
            return None
        wait = 2
        for attempt in range(tries):
            try:
                resp = self.session.get(url, params=params, headers=headers, timeout=25)
            except requests.RequestException as exc:
                log.warning("  ! %s unreachable (%s)", url.split("?")[0], type(exc).__name__)
                break
            if resp.status_code == 200:
                self.failures[host] = 0
                time.sleep(self.pause + random.uniform(0, self.jitter))
                try:
                    return resp.json() if as_json else resp.text
                except ValueError:
                    log.warning("  ! %s returned invalid JSON", url.split("?")[0])
                    return None
            if resp.status_code in (404, 410):  # a wrong address, not a blocked host: try its other pages
                log.warning("  ! %s not found (HTTP %s)", url.split("?")[0], resp.status_code)
                return None
            if resp.status_code not in (429, 500, 502, 503, 504):
                log.warning("  ! %s answered HTTP %s", url.split("?")[0], resp.status_code)
                break
            if attempt < tries - 1:
                retry_after = resp.headers.get("Retry-After", "")
                time.sleep(min(120, int(retry_after)) if retry_after.isdigit() else wait)
                wait *= 2
        self.failures[host] = self.failures.get(host, 0) + 1
        if self.failures[host] == 3:
            log.warning("  ! %s failed 3 times in a row: skipping it for this run", host)
        return None

    def is_down(self, url):
        return self.failures.get(self._host(url), 0) >= 3

    def reset(self, url):
        self.failures[self._host(url)] = 0

    def post_json(self, url, payload, headers=None):
        import requests

        try:
            resp = self.session.post(url, json=payload, headers=headers, timeout=60)
        except requests.RequestException:
            return None
        return resp.json() if resp.status_code == 200 else None
