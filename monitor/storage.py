"""Where items are kept.

* SupabaseStore - used when SUPABASE_URL and a key are set (recommended for the daily GitHub Actions run).
* LocalStore    - a Parquet file in data/ (for running everything on your own computer).
"""

from datetime import datetime, timedelta, timezone

import pandas as pd

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

    def load(self, days=30):
        df = self._read()
        return df[df["published_at"] >= pd.Timestamp(_cutoff(days))].reset_index(drop=True)

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
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        self.http = Http(pause=0)

    def _request(self, method, params=None, json=None, extra=None):
        resp = self.http.session.request(method, self.base, params=params, json=json,
                                         headers={**self.headers, **(extra or {})}, timeout=60)
        if resp.status_code >= 300:
            raise RuntimeError(f"Supabase {method} failed: HTTP {resp.status_code}: {resp.text[:300]}")
        return resp

    def upsert(self, items):
        rows = [{k: item.get(k) for k in ITEM_FIELDS} for item in items]
        for i in range(0, len(rows), 500):
            self._request("POST", params={"on_conflict": "id"}, json=rows[i:i + 500],
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
