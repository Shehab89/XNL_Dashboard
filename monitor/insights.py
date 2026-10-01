"""Media-analysis metrics. Pure pandas, no Streamlit, so everything here is unit-tested.

Definitions used throughout:
  * Mentions        - items (articles/posts) that mention the party or issue at least once.
  * Share of voice  - a party's mentions as % of all party mentions in the selection.
  * Net sentiment   - % positive items minus % negative items (range -100 … +100), the standard
                      media-monitoring index. Items are scored individually by the sentiment model.
"""

import math
import re
from collections import Counter

import numpy as np
import pandas as pd

from .common import PLATFORM_LABELS, channel_of

TZ = "Europe/Amsterdam"

STOPWORDS = set("""
de het een en van ik te dat die in is hij niet zijn op aan met als voor had er maar om hem dan zou of wat
mijn men dit zo door over ze zich bij ook tot je mij uit der daar haar naar heb hoe heeft hebben deze u want
nog zal me zij nu ge geen omdat iets worden toch al waren veel meer doen toen moet ben zonder kan hun dus
alles onder ja twee laat wel we ons wij wie gaan na via welke steeds wordt werd worden zijn nieuwe gaat
komt echt even jaar jaren dag vandaag gisteren morgen goed heel alleen andere eigen staat zegt zei willen
wil wilt kunnen kun weer waar waarom hier daarom zelf elke iedereen niets niemand allemaal eens natuurlijk
doet doen deed gedaan vindt vind vinden vond lijkt lijken benieuwd vanavond vanochtend vannacht iemand
uitleggen uitgelegd gezegd zeggen zeg komen kom kwam maken maakt gemaakt krijgen krijgt kreeg zien ziet zag
denk denkt dacht weet weten gewoon precies eerlijk zeker misschien eigenlijk inderdaad helemaal beetje keer
nieuws bericht vraag vragen reactie reageert stelt volgens tijdens tegen nadat sinds binnen buiten boven
the and for with this that from are was you not have has but they will one all can new more about
https http www com nl amp rt via co nos nu ad the een aantal procent miljoen euro over
""".split())


def prepare(df):
    """Add helper columns used by every metric."""
    df = df.copy()
    df["channel"] = df["platform"].map(channel_of)
    df["platform_label"] = df["platform"].map(lambda p: PLATFORM_LABELS.get(p, p))
    local = df["published_at"].dt.tz_convert(TZ)
    df["date"] = local.dt.floor("D").dt.tz_localize(None)
    df["engagement"] = df["likes"] + 2 * df["shares"] + df["replies"]
    df["is_pos"] = (df["sentiment"] == "positive").astype(int)
    df["is_neg"] = (df["sentiment"] == "negative").astype(int)
    return df


def explode(df, col):
    out = df.explode(col, ignore_index=True)
    return out[out[col].notna() & (out[col] != "")]


def _net(frame):
    n = len(frame)
    return 0.0 if n == 0 else 100 * (frame["is_pos"].sum() - frame["is_neg"].sum()) / n


def share_of_voice(df, col="parties", by_channel=True):
    ex = explode(df, col)
    if ex.empty:
        return pd.DataFrame(columns=[col, "channel", "mentions", "share"])
    keys = [col, "channel"] if by_channel else [col]
    out = ex.groupby(keys).size().reset_index(name="mentions")
    totals = out.groupby("channel")["mentions"].transform("sum") if by_channel else out["mentions"].sum()
    out["share"] = out["mentions"] / totals
    return out.sort_values("mentions", ascending=False)


def sentiment_table(df, col="parties", min_n=5):
    """Per entity: mentions, net sentiment with a 95% interval, and the positive/neutral/negative split."""
    rows = []
    for name, g in explode(df, col).groupby(col):
        n = len(g)
        if n < min_n:
            continue
        news, social = g[g["channel"] == "News media"], g[g["channel"] == "Social media"]
        p_pos, p_neg = g["is_pos"].mean(), g["is_neg"].mean()
        net = 100 * (p_pos - p_neg)
        # variance of (pos - neg) indicator, per item: values in {-1, 0, 1}
        var = p_pos + p_neg - (p_pos - p_neg) ** 2
        ci = 100 * 1.96 * math.sqrt(max(var, 0) / n)
        rows.append({col: name, "mentions": n, "net": net, "ci": ci, "positive": p_pos,
                     "neutral": 1 - p_pos - p_neg, "negative": p_neg,
                     "news_n": len(news), "social_n": len(social),
                     "news_net": _net(news) if len(news) >= min_n else np.nan,
                     "social_net": _net(social) if len(social) >= min_n else np.nan})
    return pd.DataFrame(rows).sort_values("mentions", ascending=False) if rows else pd.DataFrame(
        columns=[col, "mentions", "net", "ci", "positive", "neutral", "negative", "news_n", "social_n", "news_net",
                 "social_net"])


def daily_volume(df, col, entities=None):
    ex = explode(df, col)
    if entities:
        ex = ex[ex[col].isin(entities)]
    return ex.groupby(["date", col]).size().reset_index(name="mentions")


def daily_net(df, col, entities):
    ex = explode(df, col)
    ex = ex[ex[col].isin(entities)]
    out = ex.groupby(["date", col]).agg(n=("id", "size"), pos=("is_pos", "sum"), neg=("is_neg", "sum")).reset_index()
    out["net"] = 100 * (out["pos"] - out["neg"]) / out["n"]
    return out


def rolling_net(df, col, entities, window=7, min_n=10):
    """Net sentiment over a rolling window of days (pooled counts, so busy days weigh more)."""
    d = daily_net(df, col, entities)
    if d.empty:
        return d
    out = []
    for name, g in d.groupby(col):
        g = g.set_index("date")[["n", "pos", "neg"]]
        g = g.asfreq("D", fill_value=0) if len(g) > 1 else g
        roll = g.rolling(window, min_periods=1).sum()
        roll = roll[roll["n"] >= min_n]
        out.append(pd.DataFrame({"date": roll.index, col: name,
                                 "net": 100 * (roll["pos"] - roll["neg"]) / roll["n"], "n": roll["n"]}))
    return pd.concat(out, ignore_index=True) if out else d.iloc[0:0]


def momentum(df, col="parties", days=7):
    """Share of voice in the last `days` vs the `days` before: who is gaining attention."""
    end = df["published_at"].max()
    if pd.isna(end):
        return pd.DataFrame()
    recent = df[df["published_at"] > end - pd.Timedelta(days=days)]
    before = df[(df["published_at"] <= end - pd.Timedelta(days=days)) &
                (df["published_at"] > end - pd.Timedelta(days=2 * days))]
    a = share_of_voice(recent, col, by_channel=False).set_index(col)["share"]
    b = share_of_voice(before, col, by_channel=False).set_index(col)["share"]
    out = pd.DataFrame({"now": a, "before": b}).fillna(0)
    out["change"] = out["now"] - out["before"]
    return out.reset_index(names=col).sort_values("change", ascending=False)


def alerts(df, col="parties", hours=24, baseline_days=14, z=2.0, min_count=8):
    """Unusual volume in the last `hours` compared with the same-length windows before it.

    The baseline is split into windows of `hours` each; a mention count is flagged when it is `z`
    standard deviations above the baseline mean (and at least `min_count`). Also reports the shift in
    net sentiment compared with the baseline.
    """
    end = df["published_at"].max()
    if pd.isna(end):
        return pd.DataFrame()
    ex = explode(df, col)
    age = (end - ex["published_at"]) / pd.Timedelta(hours=hours)
    ex = ex.assign(window=np.floor(age).astype(int))
    n_windows = max(1, int(baseline_days * 24 / hours) - 1)
    recent = ex[ex["window"] == 0]
    base = ex[(ex["window"] >= 1) & (ex["window"] <= n_windows)]
    if base.empty:
        return pd.DataFrame()
    counts = base.groupby([col, "window"]).size().unstack(fill_value=0)
    counts = counts.reindex(columns=range(1, n_windows + 1), fill_value=0)
    rows = []
    for name, g in recent.groupby(col):
        hist = counts.loc[name] if name in counts.index else pd.Series([0] * n_windows)
        mean = hist.mean()
        std = max(hist.std(ddof=0), math.sqrt(max(mean, 1.0)))
        score = (len(g) - mean) / std
        if len(g) >= min_count and score >= z:
            before = base[base[col] == name]
            rows.append({col: name, "recent": len(g), "typical": mean, "z": score,
                         "net_now": _net(g), "net_before": _net(before)})
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["net_shift"] = out["net_now"] - out["net_before"]
    return out.sort_values("z", ascending=False)


def agenda_gap(df):
    """Share of news items vs social items that mention each issue (the 'agenda-setting gap')."""
    rows = []
    news, social = df[df["channel"] == "News media"], df[df["channel"] == "Social media"]
    for issue in sorted({i for lst in df["issues"] for i in lst}):
        n_share = news["issues"].apply(lambda l, i=issue: i in l).mean() if len(news) else 0
        s_share = social["issues"].apply(lambda l, i=issue: i in l).mean() if len(social) else 0
        rows.append({"issue": issue, "news": n_share, "social": s_share, "gap": s_share - n_share})
    return pd.DataFrame(rows).sort_values("gap") if rows else pd.DataFrame(columns=["issue", "news", "social", "gap"])


def party_issue_matrix(df, parties, issues=None, normalize=True):
    """For each party: which share of its mentions is about each issue (its 'issue profile')."""
    ex = explode(explode(df, "parties"), "issues")
    ex = ex[ex["parties"].isin(parties)]
    if issues:
        ex = ex[ex["issues"].isin(issues)]
    m = pd.crosstab(ex["parties"], ex["issues"])
    if normalize and not m.empty:
        totals = explode(df, "parties").groupby("parties").size()
        m = m.div(totals.reindex(m.index), axis=0)
    return m.reindex([p for p in parties if p in m.index])


def outlet_tone(df, parties, top_outlets=10, min_n=4):
    """Net sentiment of each news outlet towards each party (only cells with enough items)."""
    news = explode(df[df["channel"] == "News media"], "parties")
    news = news[news["parties"].isin(parties)]
    outlets = news["source"].value_counts().head(top_outlets).index
    news = news[news["source"].isin(outlets)]
    grid = news.groupby(["source", "parties"]).agg(n=("id", "size"), pos=("is_pos", "sum"), neg=("is_neg", "sum"))
    grid["net"] = np.where(grid["n"] >= min_n, 100 * (grid["pos"] - grid["neg"]) / grid["n"], np.nan)
    return grid["net"].unstack().reindex(index=outlets, columns=[p for p in parties if p in grid.index.get_level_values(1)])


_TOKEN = re.compile(r"[a-zà-ÿ][a-zà-ÿ\-']{2,}")


def _tokens(text):
    """Content words plus two-word phrases made of *adjacent* content words."""
    raw = _TOKEN.findall(re.sub(r"https?://\S+", " ", str(text).lower()))
    words = [w for w in raw if w not in STOPWORDS]
    phrases = [f"{a} {b}" for a, b in zip(raw, raw[1:]) if a not in STOPWORDS and b not in STOPWORDS]
    return words + phrases


def _excluded(term, exclude):
    return term in exclude or any(part in exclude for part in term.split())


def top_terms(texts, n=15, exclude=()):
    exclude = {e.lower() for e in exclude}
    counts = Counter(t for text in texts for t in set(_tokens(text)) if not _excluded(t, exclude))
    return counts.most_common(n)


def emerging_terms(df, recent_hours=48, n=12, min_count=4, exclude=()):
    """Words/phrases that are unusually frequent in the last `recent_hours` (smoothed log-odds ratio)."""
    end = df["published_at"].max()
    if pd.isna(end):
        return pd.DataFrame(columns=["term", "recent", "before", "lift"])
    exclude = {e.lower() for e in exclude}
    mask = df["published_at"] > end - pd.Timedelta(hours=recent_hours)
    recent = Counter(t for text in df.loc[mask, "text"] for t in set(_tokens(text)) if not _excluded(t, exclude))
    before = Counter(t for text in df.loc[~mask, "text"] for t in set(_tokens(text)) if not _excluded(t, exclude))
    n_recent, n_before = max(mask.sum(), 1), max((~mask).sum(), 1)
    rows = []
    for term, c in recent.items():
        if c < min_count:
            continue
        b = before.get(term, 0)
        lift = math.log(((c + 1) / (n_recent + 2)) / ((b + 1) / (n_before + 2)))
        rows.append({"term": term, "recent": c, "before": b, "lift": lift})
    out = pd.DataFrame(rows)
    if out.empty:
        return pd.DataFrame(columns=["term", "recent", "before", "lift"])
    out = out[out["lift"] > 0.4].sort_values(["lift", "recent"], ascending=False)
    # drop single words that are already covered by a stronger phrase
    keep, seen = [], set()
    for row in out.itertuples():
        parts = set(row.term.split())
        if not (len(parts) == 1 and row.term in seen):
            keep.append(row.Index)
            seen |= parts
    return out.loc[keep].head(n)


def executive_brief(df, parties_col="parties"):
    """Short, plain-language findings for the briefing page."""
    lines = []
    if df.empty:
        return lines
    n_news = (df["channel"] == "News media").sum()
    n_social = len(df) - n_news
    lines.append(f"Monitored **{len(df):,}** political items: **{n_news:,}** news articles and "
                 f"**{n_social:,}** social-media posts from **{df['source'].nunique()}** sources.")

    sov = share_of_voice(df, parties_col, by_channel=False)
    if not sov.empty:
        top = sov.iloc[0]
        lines.append(f"**{top[parties_col]}** dominates the conversation with **{top['share']:.0%}** share of voice.")
    mom = momentum(df, parties_col)
    if not mom.empty and mom.iloc[0]["change"] > 0.02:
        m = mom.iloc[0]
        lines.append(f"Biggest riser this week: **{m[parties_col]}** (+{100 * m['change']:.1f} pts share of voice "
                     f"vs. the week before).")
    sent = sentiment_table(df, parties_col, min_n=20)
    if not sent.empty:
        worst, best = sent.sort_values("net").iloc[0], sent.sort_values("net").iloc[-1]
        lines.append(f"Most negative coverage: **{worst[parties_col]}** (net {worst['net']:+.0f}); "
                     f"most positive: **{best[parties_col]}** (net {best['net']:+.0f}).")
        both = sent.head(8)
        both = both[(both["news_n"] >= 20) & (both["social_n"] >= 20)].copy()
        both["gap"] = both["social_net"] - both["news_net"]
        g = both.reindex(both["gap"].abs().sort_values(ascending=False).index).iloc[0] if len(both) else None
        if g is not None and abs(g["gap"]) >= 10:
            where = "harsher on social media than in the news" if g["gap"] < 0 else "warmer on social media than in the news"
            lines.append(f"Tone about **{g[parties_col]}** is clearly {where} "
                         f"(social {g['social_net']:+.0f} vs. news {g['news_net']:+.0f}).")
    issues = share_of_voice(df, "issues", by_channel=False)
    if not issues.empty:
        lines.append(f"Top issue: **{issues.iloc[0]['issues']}** ({issues.iloc[0]['share']:.0%} of issue mentions), "
                     f"followed by **{issues.iloc[1]['issues'] if len(issues) > 1 else '-'}**.")
    gap = agenda_gap(df)
    if not gap.empty and gap["gap"].max() > 0.03:
        g = gap.iloc[-1]
        lines.append(f"Agenda gap: **{g['issue']}** gets far more attention on social media ({g['social']:.0%} of posts) "
                     f"than in the news ({g['news']:.0%} of articles).")
    return lines
