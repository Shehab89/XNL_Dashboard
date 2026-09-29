"""Dutch Political Media Monitor: Streamlit dashboard.

Run:  streamlit run dashboard/dashboard.py
"""

import sys
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from monitor import insights as ins  # noqa: E402
from monitor.common import PLATFORM_LABELS, load_yaml  # noqa: E402
from monitor.storage import LocalStore, SupabaseStore, get_store, to_frame  # noqa: E402

st.set_page_config(page_title="Dutch Political Media Monitor", page_icon="🏛️", layout="wide")

ENTITIES = load_yaml("entities.yaml")
PARTY_COLORS = {name: spec.get("color", "#888") for name, spec in ENTITIES["parties"].items()}
POS, NEU, NEG = "#1a9850", "#b8bec6", "#d73027"
CHANNEL_COLORS = {"News media": "#1f4e79", "Social media": "#e07b39"}
DIVERGING = [[0, NEG], [0.5, "#f7f7f7"], [1, POS]]
SEQUENTIAL = ["#f1f5f9", "#bfdbfe", "#60a5fa", "#2563eb", "#1e3a8a"]

st.markdown("""
<style>
  .block-container {padding-top: 2.2rem; max-width: 1400px;}
  [data-testid="stMetric"] {border: 1px solid rgba(128,128,128,.25); border-radius: 10px; padding: 12px 16px;}
  [data-testid="stMetricLabel"] p {font-size: .82rem; text-transform: uppercase; letter-spacing: .04em; opacity: .75;}
  .kicker {font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; opacity: .65; margin-bottom: -.4rem;}
  .alert {border-left: 4px solid #d97706; background: rgba(217,119,6,.08); padding: .6rem .9rem;
          border-radius: 6px; margin-bottom: .5rem;}
  .alert b {font-weight: 650;}
</style>
""", unsafe_allow_html=True)


# ----------------------------------------------------------------------------- helpers

def style(fig, height=380, legend=True):
    fig.update_layout(height=height, margin=dict(l=8, r=8, t=48, b=8), legend_title_text="",
                      showlegend=legend, hoverlabel=dict(namelength=-1), font=dict(size=13),
                      title=dict(font=dict(size=15)))
    return fig


def show(fig, height=380, legend=True):
    st.plotly_chart(style(fig, height, legend), width="stretch", config={"displayModeBar": False})


def note(text):
    st.caption(text)


def party_order(df, limit=None):
    sov = ins.share_of_voice(df, "parties", by_channel=False)
    names = sov["parties"].tolist()
    return names[:limit] if limit else names


@st.cache_data(ttl=600, show_spinner="Loading data…")
def load(days):
    store = get_store()
    try:
        return store.load(days=days), store.name, None
    except Exception as exc:
        return to_frame([]), store.name, str(exc)


@st.cache_data(show_spinner="Generating demo data…")
def load_demo():
    from monitor.demo import make_demo_items

    return to_frame(make_demo_items())


# ----------------------------------------------------------------------------- sidebar & data

with st.sidebar:
    st.markdown("### 🏛️ Media Monitor")
    period = st.selectbox("Period", ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days"], index=2)
    days = {"Last 24 hours": 1, "Last 7 days": 7, "Last 30 days": 30, "Last 90 days": 90}[period]

raw, store_name, load_error = load(max(days, 14))
demo = False
if raw.empty:
    demo = True
    raw = load_demo()

data = ins.prepare(raw)
end = data["published_at"].max()
period_mask = data["published_at"] > end - pd.Timedelta(days=days)

with st.sidebar:
    channel = st.radio("Channel", ["All", "News media", "Social media"], horizontal=True)
    platforms_all = sorted(data["platform"].unique(), key=lambda p: list(PLATFORM_LABELS).index(p)
                           if p in PLATFORM_LABELS else 99)
    platforms = st.multiselect("Platforms", platforms_all, default=platforms_all,
                               format_func=lambda p: PLATFORM_LABELS.get(p, p))
    all_parties = party_order(data[period_mask])
    focus = st.multiselect("Parties in charts", all_parties, default=all_parties[:8],
                           help="Charts show these parties. Default: the 8 most-mentioned.")
    st.divider()
    if demo:
        st.info("Showing **fictional demo data**. Run the pipeline to collect real data (see README).")
    else:
        st.caption(f"Data: {store_name} · newest item {end.tz_convert(ins.TZ):%d %b %Y %H:%M}")
    if load_error:
        st.warning(f"Could not read {store_name}: {load_error[:160]}")
    if st.button("↻ Refresh data", width="stretch"):
        st.cache_data.clear()
        st.rerun()

df = data[period_mask & data["platform"].isin(platforms)]
if channel != "All":
    df = df[df["channel"] == channel]
focus = focus or all_parties[:8]

# ----------------------------------------------------------------------------- header

st.markdown('<p class="kicker">Dutch politics · news & social media</p>', unsafe_allow_html=True)
st.title("Political Media Monitor")
if demo:
    st.warning("**Demo mode:** the numbers below are generated from fictional posts and invented outlets, "
               "only to show what the dashboard does. Real data appears after the first pipeline run.", icon="🧪")
if df.empty:
    st.error("No items match the current filters. Widen the period or select more platforms.")
    st.stop()

tabs = st.tabs(["🧭 Briefing", "🗳️ Parties", "📌 Issues", "📰 Media landscape", "💬 Narratives", "🔎 Explorer",
                "ℹ️ Methodology"])

# ----------------------------------------------------------------------------- 1. briefing

with tabs[0]:
    sent = ins.sentiment_table(df, "parties", min_n=5)
    sov = ins.share_of_voice(df, "parties", by_channel=False)
    issues_sov = ins.share_of_voice(df, "issues", by_channel=False)
    k = st.columns([1, 1, 0.8, 1.1, 1.6])
    k[0].metric("Items analysed", f"{len(df):,}")
    k[1].metric("Social media share", f"{(df['channel'] == 'Social media').mean():.0%}",
                f"{(df['channel'] == 'Social media').sum():,} posts",
                delta_color="off", delta_arrow="off")
    k[2].metric("Sources", f"{df['source'].nunique():,}")
    k[3].metric("Most discussed", sov.iloc[0]["parties"] if len(sov) else "–",
                f"{sov.iloc[0]['share']:.0%} share of voice" if len(sov) else None, delta_color="off", delta_arrow="off")
    k[4].metric("Top issue", issues_sov.iloc[0]["issues"] if len(issues_sov) else "–",
                f"{issues_sov.iloc[0]['share']:.0%} of issue mentions" if len(issues_sov) else None, delta_color="off", delta_arrow="off")

    left, right = st.columns([3, 2])
    with left:
        st.subheader("Key findings")
        for line in ins.executive_brief(df):
            st.markdown(f"- {line}")
    with right:
        st.subheader("🚨 Alerts (last 24 hours)")
        found = False
        for col, kind in [("parties", "party"), ("issues", "issue")]:
            al = ins.alerts(data[data["platform"].isin(platforms)], col)
            for row in al.head(4).itertuples():
                found = True
                name = getattr(row, col)
                tone = (f"tone {row.net_shift:+.0f} pts vs. usual" if abs(row.net_shift) >= 5 else "tone unchanged")
                st.markdown(f'<div class="alert"><b>{name}</b> ({kind}): <b>{row.recent}</b> mentions vs. '
                            f'~{row.typical:.0f} normally ({row.recent / max(row.typical, 1):.1f}×); {tone}.</div>',
                            unsafe_allow_html=True)
        if not found:
            st.caption("No unusual spikes: every party and issue is within its normal range.")

    c1, c2 = st.columns(2)
    with c1:
        s = ins.share_of_voice(df, "parties", by_channel=True)
        s = s[s["parties"].isin(focus)]
        fig = px.bar(s, x="mentions", y="parties", color="channel", orientation="h", color_discrete_map=CHANNEL_COLORS,
                     title="Share of voice: mentions per party",
                     category_orders={"parties": [p for p in party_order(df) if p in focus]})
        fig.update_layout(yaxis_title="", xaxis_title="Mentions", barmode="stack")
        show(fig, 420)
    with c2:
        st_ = sent[sent["parties"].isin(focus)].sort_values("net")
        fig = go.Figure(go.Scatter(
            x=st_["net"], y=st_["parties"], mode="markers",
            error_x=dict(type="data", array=st_["ci"], color="rgba(120,120,120,.6)", thickness=1.5),
            marker=dict(size=[max(8, min(28, m ** 0.5)) for m in st_["mentions"]],
                        color=[PARTY_COLORS.get(p, "#888") for p in st_["parties"]], line=dict(width=1, color="white")),
            customdata=st_[["mentions", "positive", "negative"]],
            hovertemplate="<b>%{y}</b><br>Net sentiment %{x:+.0f}<br>%{customdata[0]} mentions<br>"
                          "positive %{customdata[1]:.0%} · negative %{customdata[2]:.0%}<extra></extra>"))
        fig.add_vline(x=0, line_dash="dot", line_color="gray")
        fig.update_layout(title="Net sentiment per party (±95% interval)", xaxis_title="% positive − % negative",
                          yaxis_title="")
        show(fig, 420, legend=False)
    note("Share of voice counts items that mention a party. Net sentiment = % positive items − % negative items; "
         "bubble size = number of mentions; the whisker shows the statistical uncertainty.")

# ----------------------------------------------------------------------------- 2. parties

with tabs[1]:
    st.subheader("Attention over time")
    vol = ins.daily_volume(df, "parties", focus)
    if days > 1 and not vol.empty:
        pivot = vol.pivot(index="date", columns="parties", values="mentions").fillna(0)
        smooth = pivot.rolling(3, min_periods=1).mean() if days >= 14 else pivot
        long = smooth.reset_index().melt(id_vars="date", var_name="parties", value_name="mentions")
        fig = px.line(long, x="date", y="mentions", color="parties", color_discrete_map=PARTY_COLORS,
                      title="Daily mentions" + (" (3-day average)" if days >= 14 else ""))
        fig.update_traces(line=dict(width=2.4))
        fig.update_layout(xaxis_title="", yaxis_title="Mentions per day", hovermode="x unified")
        show(fig, 400)

        net = ins.rolling_net(df, "parties", focus[:6], window=7 if days >= 14 else 1)
        if not net.empty:
            fig = px.line(net, x="date", y="net", color="parties", color_discrete_map=PARTY_COLORS,
                          title=("Net sentiment, 7-day rolling" if days >= 14 else "Daily net sentiment") +
                                " (top 6 selected parties)")
            fig.update_traces(line=dict(width=2.4))
            fig.add_hline(y=0, line_dash="dot", line_color="gray")
            fig.update_layout(xaxis_title="", yaxis_title="Net sentiment", hovermode="x unified")
            show(fig, 380)
    else:
        st.caption("Choose a period of 7 days or more to see trends.")

    c1, c2 = st.columns(2)
    with c1:
        mom = ins.momentum(df if days >= 14 else data[data["platform"].isin(platforms)], "parties")
        mom = mom[mom["parties"].isin(focus)].sort_values("change")
        if not mom.empty:
            fig = px.bar(mom, x="change", y="parties", orientation="h", title="Momentum: share of voice, this week vs. last week",
                         color="change", color_continuous_scale=DIVERGING, range_color=[-mom["change"].abs().max(),
                                                                                        mom["change"].abs().max()])
            fig.update_traces(hovertemplate="%{y}: %{x:+.1%}<extra></extra>")
            fig.update_layout(xaxis_tickformat="+.0%", xaxis_title="Change in share of voice (pts)", yaxis_title="",
                              coloraxis_showscale=False)
            show(fig, 400, legend=False)
    with c2:
        tone = sent[sent["parties"].isin(focus)].sort_values("mentions")
        long = tone.melt(id_vars="parties", value_vars=["negative", "neutral", "positive"], var_name="tone",
                         value_name="share")
        fig = px.bar(long, x="share", y="parties", color="tone", orientation="h", title="Tone of coverage",
                     color_discrete_map={"positive": POS, "neutral": NEU, "negative": NEG},
                     category_orders={"tone": ["negative", "neutral", "positive"]})
        fig.update_layout(xaxis_tickformat=".0%", xaxis_title="", yaxis_title="", barmode="stack")
        show(fig, 400)

    st.subheader("News vs. social media tone")
    both = sent[sent["parties"].isin(focus)].dropna(subset=["news_net", "social_net"])
    if not both.empty:
        fig = go.Figure()
        for row in both.itertuples():
            fig.add_trace(go.Scatter(x=[row.news_net, row.social_net], y=[row.parties] * 2, mode="lines",
                                     line=dict(color="rgba(140,140,140,.5)", width=3), showlegend=False,
                                     hoverinfo="skip"))
        for name, col in [("News media", "news_net"), ("Social media", "social_net")]:
            fig.add_trace(go.Scatter(x=both[col], y=both["parties"], mode="markers", name=name,
                                     marker=dict(size=13, color=CHANNEL_COLORS[name]),
                                     hovertemplate="%{y}: %{x:+.0f}<extra>" + name + "</extra>"))
        fig.add_vline(x=0, line_dash="dot", line_color="gray")
        fig.update_layout(xaxis_title="Net sentiment", yaxis_title="", title="Where is a party judged more harshly?")
        show(fig, 380)
        note("A long line means the party is judged very differently by journalists and by the public online.")

    st.subheader("Issue profile per party")
    matrix = ins.party_issue_matrix(df, focus)
    if not matrix.empty:
        fig = px.imshow(matrix, text_auto=".0%", aspect="auto", color_continuous_scale=SEQUENTIAL,
                        title="Share of each party's mentions that is about each issue")
        fig.update_layout(coloraxis_showscale=False, xaxis_title="", yaxis_title="")
        fig.update_xaxes(tickangle=-35)
        show(fig, 60 + 38 * len(matrix))
        note("Read across a row: which issues a party is linked to in the media (issue ownership).")

# ----------------------------------------------------------------------------- 3. issues

with tabs[2]:
    isent = ins.sentiment_table(df, "issues", min_n=5)
    c1, c2 = st.columns([3, 2])
    with c1:
        s = ins.share_of_voice(df, "issues", by_channel=True)
        order = ins.share_of_voice(df, "issues", by_channel=False)["issues"].tolist()
        fig = px.bar(s, x="mentions", y="issues", color="channel", orientation="h", color_discrete_map=CHANNEL_COLORS,
                     title="The political agenda: mentions per issue", category_orders={"issues": order})
        fig.update_layout(yaxis_title="", xaxis_title="Mentions", barmode="stack")
        show(fig, 520)
    with c2:
        gap = ins.agenda_gap(df)
        if not gap.empty and df["channel"].nunique() > 1:
            fig = px.bar(gap, x="gap", y="issue", orientation="h", color="gap", color_continuous_scale=[
                [0, CHANNEL_COLORS["News media"]], [0.5, "#eeeeee"], [1, CHANNEL_COLORS["Social media"]]],
                range_color=[-gap["gap"].abs().max(), gap["gap"].abs().max()], title="Agenda gap",
                hover_data={"news": ":.1%", "social": ":.1%", "gap": ":+.1%"})
            fig.update_layout(xaxis_tickformat="+.0%", xaxis_title="← bigger in news · bigger on social →",
                              yaxis_title="", coloraxis_showscale=False)
            show(fig, 520, legend=False)
        else:
            st.caption("Select 'All' channels to compare the news agenda with the social-media agenda.")

    if days > 1:
        vol = ins.daily_volume(df, "issues", order[:6])
        if not vol.empty:
            fig = px.area(vol, x="date", y="mentions", color="issues", title="Top 6 issues over time",
                          color_discrete_sequence=px.colors.qualitative.Safe)
            fig.update_layout(xaxis_title="", yaxis_title="Mentions per day", hovermode="x unified")
            show(fig, 380)

    if not isent.empty:
        t = isent.sort_values("net")
        span = max(10, t["net"].abs().max())
        fig = px.bar(t, x="net", y="issues", orientation="h", color="net", color_continuous_scale=DIVERGING,
                     range_color=[-span, span], title="Tone of the debate per issue", hover_data={"mentions": True})
        fig.update_layout(xaxis_title="Net sentiment", yaxis_title="", coloraxis_showscale=False)
        show(fig, 460, legend=False)
        note("Issue tone reflects how people and media talk about the topic (e.g. worry about housing), "
             "not support for a policy.")

# ----------------------------------------------------------------------------- 4. media landscape

with tabs[3]:
    c1, c2 = st.columns([2, 3])
    with c1:
        mix = df.groupby(["channel", "platform_label"]).size().reset_index(name="items")
        fig = px.sunburst(mix, path=["channel", "platform_label"], values="items", title="Where the items come from",
                          color="channel", color_discrete_map=CHANNEL_COLORS)
        fig.update_traces(insidetextorientation="radial")
        show(fig, 440, legend=False)
    with c2:
        top_src = df.groupby(["source", "channel"]).size().reset_index(name="items") \
            .sort_values("items", ascending=False).head(20)
        fig = px.bar(top_src, x="items", y="source", color="channel", orientation="h",
                     color_discrete_map=CHANNEL_COLORS, title="Most active sources")
        fig.update_layout(yaxis_title="", xaxis_title="Items", yaxis_categoryorder="total ascending")
        show(fig, 440)

    st.subheader("How each outlet covers each party")
    grid = ins.outlet_tone(df, focus)
    if grid is not None and not grid.empty and grid.notna().any().any():
        fig = px.imshow(grid, text_auto=".0f", aspect="auto", color_continuous_scale=DIVERGING, zmin=-60, zmax=60,
                        title="Net sentiment by news outlet (blank = fewer than 4 articles)")
        fig.update_layout(xaxis_title="", yaxis_title="", coloraxis_colorbar=dict(title="Net"))
        show(fig, 80 + 34 * len(grid))
        note("Differences between outlets can reflect editorial choices, but also which events they covered. "
             "Treat as a signal to investigate, not as proof of bias.")
    else:
        st.caption("Not enough news articles per outlet and party in this selection.")

    attention = ins.explode(df[df["channel"] == "News media"], "parties")
    attention = attention[attention["parties"].isin(focus)]
    if not attention.empty:
        top_outlets = attention["source"].value_counts().head(10).index
        ct = pd.crosstab(attention["source"], attention["parties"], normalize="index").reindex(top_outlets)
        long = ct.reset_index().melt(id_vars="source", var_name="parties", value_name="share")
        fig = px.bar(long, x="share", y="source", color="parties", orientation="h", color_discrete_map=PARTY_COLORS,
                     title="Which parties each outlet pays attention to",
                     category_orders={"parties": [p for p in focus if p in ct.columns]})
        fig.update_layout(xaxis_tickformat=".0%", xaxis_title="Share of the outlet's party mentions", yaxis_title="",
                          barmode="stack")
        show(fig, 460)

# ----------------------------------------------------------------------------- 5. narratives

with tabs[4]:
    subject = st.selectbox("Subject", ["All items"] + [f"Party: {p}" for p in all_parties] +
                           [f"Issue: {i}" for i in ins.share_of_voice(df, "issues", False)["issues"]])
    sub = df
    exclude = set()
    if subject.startswith("Party: "):
        name = subject[7:]
        sub = df[df["parties"].apply(lambda l: name in l)]
        spec = ENTITIES["parties"][name]
        exclude = {w.lower() for w in [name] + spec.get("exact", []) + spec.get("words", [])}
    elif subject.startswith("Issue: "):
        name = subject[7:]
        sub = df[df["issues"].apply(lambda l: name in l)]

    if sub.empty:
        st.caption("No items for this subject.")
    else:
        c1, c2 = st.columns(2)
        with c1:
            terms = pd.DataFrame(ins.top_terms(sub["text"], 15, exclude), columns=["term", "items"])
            if not terms.empty:
                fig = px.bar(terms.iloc[::-1], x="items", y="term", orientation="h", title="Most used words & phrases")
                fig.update_traces(marker_color="#2563eb")
                fig.update_layout(yaxis_title="", xaxis_title="Items")
                show(fig, 460, legend=False)
        with c2:
            em = ins.emerging_terms(sub, exclude=exclude)
            if not em.empty:
                fig = px.bar(em.iloc[::-1], x="lift", y="term", orientation="h", title="Emerging in the last 48 hours",
                             hover_data={"recent": True, "before": True, "lift": ":.2f"})
                fig.update_traces(marker_color="#e07b39")
                fig.update_layout(yaxis_title="", xaxis_title="How much more frequent than before (log ratio)")
                show(fig, 460, legend=False)
            else:
                st.caption("No clearly emerging terms for this subject in the last 48 hours.")

        c3, c4 = st.columns(2)
        link = st.column_config.LinkColumn("Link", display_text="open ↗")
        with c3:
            st.markdown("**Most engaged social posts**")
            posts = sub[sub["channel"] == "Social media"].sort_values("engagement", ascending=False).head(10)
            st.dataframe(posts[["platform_label", "author", "text", "engagement", "sentiment", "url"]], hide_index=True,
                         column_config={"platform_label": "Platform", "author": "Author", "text": "Post",
                                        "engagement": st.column_config.NumberColumn("Engagement", help="likes + 2×shares + replies"),
                                        "sentiment": "Tone", "url": link})
        with c4:
            st.markdown("**Latest headlines**")
            news = sub[sub["channel"] == "News media"].sort_values("published_at", ascending=False).head(10)
            news = news.assign(headline=news["title"].fillna(news["text"]))
            st.dataframe(news[["source", "headline", "sentiment", "url"]], hide_index=True,
                         column_config={"source": "Outlet", "headline": "Headline", "sentiment": "Tone", "url": link})

# ----------------------------------------------------------------------------- 6. explorer

with tabs[5]:
    c1, c2, c3 = st.columns([2, 1, 1])
    query = c1.text_input("Search in text", placeholder="e.g. huurprijzen")
    tone_filter = c2.multiselect("Tone", ["positive", "neutral", "negative"])
    party_filter = c3.multiselect("Party", all_parties)
    ex = df
    if query:
        ex = ex[ex["text"].str.contains(query, case=False, na=False, regex=False)]
    if tone_filter:
        ex = ex[ex["sentiment"].isin(tone_filter)]
    if party_filter:
        ex = ex[ex["parties"].apply(lambda l: any(p in l for p in party_filter))]
    ex = ex.sort_values("published_at", ascending=False)
    st.caption(f"{len(ex):,} items")
    table = ex.assign(parties=ex["parties"].apply(", ".join), issues=ex["issues"].apply(", ".join),
                      published=ex["published_at"].dt.tz_convert(ins.TZ).dt.strftime("%d-%m %H:%M"))
    st.dataframe(table[["published", "platform_label", "source", "text", "parties", "issues", "sentiment",
                        "sentiment_score", "engagement", "url"]].head(2000), hide_index=True, height=560,
                 column_config={"published": "Time", "platform_label": "Platform", "source": "Source", "text": "Text",
                                "parties": "Parties", "issues": "Issues", "sentiment": "Tone",
                                "sentiment_score": st.column_config.NumberColumn("Score", format="%+.2f"),
                                "engagement": "Engagement",
                                "url": st.column_config.LinkColumn("Link", display_text="open ↗")})
    st.download_button("⬇️ Download selection (CSV)", table.drop(columns=["is_pos", "is_neg"]).to_csv(index=False).encode(),
                       "political_media_monitor.csv", "text/csv")

# ----------------------------------------------------------------------------- 7. methodology

with tabs[6]:
    st.markdown(f"""
#### What is measured
- **Items**: news articles (RSS feeds of Dutch outlets, Google News, GDELT) and public social-media posts
  (Bluesky, Mastodon, Reddit, Telegram, YouTube, optionally X). Only items that mention at least one party or
  political issue are kept. The same headline arriving via several news sources is counted once.
- **Party mention**: the party name, abbreviation or its leader's name appears in the text
  (list in `config/entities.yaml`). An item can mention several parties.
- **Issue**: the item contains keywords for one of {len(ENTITIES['issues'])} political issues (also in `entities.yaml`).
- **Sentiment**: every item is scored by a multilingual sentiment model trained on social-media text
  (`cardiffnlp/twitter-xlm-roberta-base-sentiment`), or by a Dutch word list when the model is not available.
  **Net sentiment** = % positive − % negative items.
- **Alerts**: mentions in the last 24 hours compared with the previous two weeks; flagged when at least
  2 standard deviations above normal.

#### How to read it responsibly
- Sentiment is about the **tone of the text**, not necessarily about the party. "Wilders is right that the
  situation is terrible" reads negative. Compare parties and trends, rather than trusting single numbers.
- Social media is **not representative** of the electorate: active users, bots and campaigns are over-represented.
- Headlines from Google News and GDELT are short, so their sentiment is less reliable than full posts.
- The whiskers on the sentiment chart show uncertainty: small parties with few mentions have wide intervals.
""")
