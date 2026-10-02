"""Where items are kept.

* SupabaseStore - used when SUPABASE_URL and a key are set (recommended for the daily GitHub Actions run).
* LocalStore    - a Parquet file in data/ (for running everything on your own computer).
"""

import re
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

from .common import ITEM_FIELDS, ROOT, Http, env, log

LIST_FIELDS = ["parties", "issues"]


def _cutoff(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def to_frame(rows):
    df = pd.DataFrame(rows, columns=ITEM_FIELDS) if rows else pd.DataFrame(columns=ITEM_FIELDS)
    for col in LIST_FIELDS:
        df[col] = df[col].apply(lambda v: list(v) if isinstance(v, (list, tuple)) or hasattr(v, "tolist") else [])
    df["published_at"] = pd.to_datetime(df["published_at"], utc=True, errors="coerce", format="ISO8601")
    for col in ["likes", "shares", "replies"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
    df["sentiment_score"] = pd.to_numeric(df["sentiment_score"], errors="coerce")
    return df


def item_key(title, text):
    """Duplicate key: the title (or the first 160 characters of the text), lower case, without punctuation."""
    base = title if isinstance(title, str) and title else (text or "")[:160]
    return re.sub(r"[^a-z0-9à-ÿ]+", " ", base.lower()).strip()[:120]


class LocalStore:
    name = "local file"

    def __init__(self, path=None):
        self.path = path or ROOT / "data" / "items.parquet"

    def _read(self):
        if not self.path.exists():
            return to_frame([])
        return to_frame(pd.read_parquet(self.path).to_dict("records"))

    def upsert(self, items):
        if not items:
            return 0
        df = pd.concat([self._read(), to_frame(items)], ignore_index=True)
        df = df.drop_duplicates("id", keep="last")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        out = df.copy()
        out["published_at"] = out["published_at"].astype(str)
        out.to_parquet(self.path, index=False)
        return len(items)

    def load(self, days=30, max_rows=None):
        df = self._read()
        return df[df["published_at"] >= pd.Timestamp(_cutoff(days))].reset_index(drop=True)

    def backlog(self, limit):
        """The newest items not labelled by the LLM yet, as dicts."""
        df = self._read()
        df = df[df["analysed_by"] != "llm"].sort_values("published_at", ascending=False).head(limit)
        return df.to_dict("records")

    def delete(self, ids):
        if ids:
            df = self._read()
            keep = df[~df["id"].isin(set(ids))].copy()
            keep["published_at"] = keep["published_at"].astype(str)
            keep.to_parquet(self.path, index=False)

    def remove_duplicates(self):
        """Same rule as remove_duplicate_items in database/schema.sql."""
        df = self._read()
        if df.empty:
            return 0
        keys = [item_key(t, x) for t, x in zip(df["title"], df["text"])]
        rank = df.assign(_key=keys, _llm=(df["analysed_by"] != "llm"),
                         _src=df["platform"].map({"news": 0, "google_news": 1, "gdelt": 2}).fillna(3))
        rank = rank.sort_values(["_llm", "_src", "published_at", "id"])
        dup = rank[(rank["_key"].str.len() >= 25) & rank.duplicated("_key")]["id"]
        self.delete(list(dup))
        return len(dup)

    def publish(self, spec, reference):
        return 0, 0  # the website snapshot is built in Supabase only

    def llm_done_ids(self, ids):
        df = self._read()
        return set(df.loc[df["analysed_by"] == "llm", "id"]) & set(ids)

    def prune(self, days):
        df = self._read()
        keep = df[df["published_at"] >= pd.Timestamp(_cutoff(days))]
        if len(keep) < len(df):
            keep = keep.copy()
            keep["published_at"] = keep["published_at"].astype(str)
            keep.to_parquet(self.path, index=False)
        return len(df) - len(keep)


class SupabaseStore:
    name = "Supabase"
    table = "items"

    def __init__(self, url, key):
        self.base = url.rstrip("/") + "/rest/v1/" + self.table
        # `Http` uses a browser-like user agent for news sources.  Supabase
        # deliberately rejects secret keys accompanied by a browser user
        # agent, so override it for server-to-server database requests.
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "DutchPoliticalMediaMonitor/2.0 (GitHub Actions)",
        }
        self.http = Http(pause=0)

    def _request(self, method, params=None, json=None, extra=None, attempts=4, url=None):
        # retry dropped connections and server errors: one slow write must not lose a whole run's analysis
        for attempt in range(attempts):
            try:
                resp = self.http.session.request(method, url or self.base, params=params, json=json,
                                                 headers={**self.headers, **(extra or {})}, timeout=(15, 120))
            except (requests.ConnectionError, requests.Timeout) as exc:
                if attempt == attempts - 1:
                    raise
                log.warning("Supabase %s failed (%s); retrying.", method, type(exc).__name__)
                time.sleep(5 * (attempt + 1))
                continue
            if resp.status_code < 500 or attempt == attempts - 1:
                break
            time.sleep(5 * (attempt + 1))
        if resp.status_code >= 300:
            raise RuntimeError(f"Supabase {method} failed: HTTP {resp.status_code}: {resp.text[:300]}")
        return resp

    def rpc(self, function, args=None):
        """Call a database function (database/schema.sql)."""
        return self._request("POST", json=args or {}, url=self.base.rsplit("/", 1)[0] + "/rpc/" + function).json()

    def remove_duplicates(self):
        """Delete repeated headlines/posts with the database function remove_duplicate_items."""
        return int(self.rpc("remove_duplicate_items") or 0)

    def publish(self, spec, reference):
        """Tag stored items with politicians, then rebuild the website's aggregate snapshot (web_snapshot)."""
        tagged = int(self.rpc("tag_politicians", {"spec": spec}) or 0)
        size = int(self.rpc("refresh_web_snapshot", {"reference": reference}) or 0)
        return tagged, size

    def upsert(self, items, chunk=100):
        rows = [{k: item.get(k) for k in ITEM_FIELDS} for item in items]
        for i in range(0, len(rows), chunk):
            self._request("POST", params={"on_conflict": "id"}, json=rows[i:i + chunk],
                          extra={"Prefer": "resolution=merge-duplicates,return=minimal"})
        return len(rows)

    def load(self, days=30, page=1000, max_rows=100_000):
        rows, offset = [], 0
        while offset < max_rows:
            batch = self._request("GET", params={
                "select": ",".join(ITEM_FIELDS), "published_at": f"gte.{_cutoff(days)}",
                "order": "published_at.desc", "limit": page, "offset": offset}).json()
            rows += batch
            if len(batch) < page:
                break
            offset += page
        return to_frame(rows)

    def llm_done_ids(self, ids, chunk=150):
        """Which of these ids the LLM already labelled (so they are not analysed and paid for again)."""
        found = set()
        ids = list(ids)
        for i in range(0, len(ids), chunk):
            quoted = ",".join('"' + x.replace('"', '') + '"' for x in ids[i:i + chunk])
            rows = self._request("GET", params={"select": "id", "id": f"in.({quoted})",
                                                "analysed_by": "eq.llm"}).json()
            found |= {r["id"] for r in rows}
        return found

    def backlog(self, limit):
        """The newest items not labelled by the LLM yet, as dicts."""
        return self._request("GET", params={
            "select": ",".join(ITEM_FIELDS), "or": "(analysed_by.is.null,analysed_by.neq.llm)",
            "order": "published_at.desc", "limit": limit}).json()

    def delete(self, ids, chunk=150):
        ids = list(ids)
        for i in range(0, len(ids), chunk):
            quoted = ",".join('"' + x.replace('"', '') + '"' for x in ids[i:i + chunk])
            self._request("DELETE", params={"id": f"in.({quoted})"})

    def prune(self, days):
        self._request("DELETE", params={"published_at": f"lt.{_cutoff(days)}"})
        return None


def get_store():
    url = env("SUPABASE_URL")
    key = env("SUPABASE_SERVICE_ROLE_KEY") or env("SUPABASE_KEY")
    if url and key:
        return SupabaseStore(url, key)
    log.info("No SUPABASE_URL/key set: using the local file data/items.parquet")
    return LocalStore()
