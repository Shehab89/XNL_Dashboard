"""
Dutch Social Monitor — Streamlit Dashboard
==========================================
Run locally:
    pip install streamlit supabase pandas plotly python-dotenv
    streamlit run dashboard.py

Deploy free:
    Push to GitHub → Connect to streamlit.io/cloud → Set secrets in app settings
"""

import os
from datetime import datetime, timezone, timedelta

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from supabase import create_client

# ─── Page config ──────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="🇳🇱 Dutch Social Monitor",
    page_icon="🇳🇱",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Supabase connection ──────────────────────────────────────────────────────

@st.cache_resource
def get_client():
    url = os.environ.get("SUPABASE_URL") or st.secrets.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or st.secrets.get("SUPABASE_KEY")  # anon key is fine for read
    return create_client(url, key)

# ─── Data loaders ─────────────────────────────────────────────────────────────

@st.cache_data(ttl=600)  # refresh cache every 10 minutes
def load_tweets(days_back: int = 7) -> pd.DataFrame:
    client = get_client()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
    resp = (
        client.table("dashboard_tweets")
        .select("*")
        .gte("analysis_date", cutoff[:10])
        .order("published_at", desc=True)
        .limit(5000)
        .execute()
    )
    df = pd.DataFrame(resp.data or [])
    if not df.empty:
        df["published_at"] = pd.to_datetime(df["published_at"], utc=True)
        df["date"] = df["published_at"].dt.date
    return df


@st.cache_data(ttl=600)
def load_topic_summary(days_back: int = 30) -> pd.DataFrame:
    client = get_client()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).date().isoformat()
    resp = (
        client.table("daily_topic_summary")
        .select("*")
        .gte("date", cutoff)
        .order("date", desc=True)
        .execute()
    )
    df = pd.DataFrame(resp.data or [])
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"]).dt.date
    return df

# ─── Colour palette ───────────────────────────────────────────────────────────

TOPIC_COLORS = {
    "Salaris":    "#2563EB",
    "Woningnood": "#DC2626",
    "Zorg":       "#16A34A",
    "Klimaat":    "#D97706",
    "Onderwijs":  "#7C3AED",
}

SENTIMENT_COLORS = {
    "positive": "#22C55E",
    "negative": "#EF4444",
    "neutral":  "#94A3B8",
    "unknown":  "#CBD5E1",
}

# ─── Sidebar ──────────────────────────────────────────────────────────────────

with st.sidebar:
    st.image("https://flagcdn.com/nl.svg", width=60)
    st.title("🇳🇱 Dutch Social Monitor")
    st.caption("Realtime inzicht in Nederlands sociaal debat")

    st.divider()

    days_back = st.slider("Periode (dagen)", min_value=1, max_value=30, value=7)

    all_topics = ["Salaris", "Woningnood", "Zorg", "Klimaat", "Onderwijs"]
    selected_topics = st.multiselect(
        "Filter op onderwerp",
        options=all_topics,
        default=all_topics,
    )

    sentiment_filter = st.multiselect(
        "Filter op sentiment",
        options=["positive", "negative", "neutral", "unknown"],
        default=["positive", "negative", "neutral"],
    )

    st.divider()
    if st.button("🔄 Data verversen"):
        st.cache_data.clear()
        st.rerun()

    st.caption(f"Bijgewerkt: {datetime.now().strftime('%d %b %Y, %H:%M')}")

# ─── Load data ────────────────────────────────────────────────────────────────

tweets_df  = load_tweets(days_back)
summary_df = load_topic_summary(days_back)

# Apply filters
if not tweets_df.empty:
    tweets_df = tweets_df[
        (tweets_df["topic"].isin(selected_topics)) &
        (tweets_df["sentiment_label"].isin(sentiment_filter))
    ]

if not summary_df.empty:
    summary_df = summary_df[summary_df["topic"].isin(selected_topics)]

# ─── Header KPIs ──────────────────────────────────────────────────────────────

st.title("🇳🇱 Dutch Social Monitor — Dashboard")
st.markdown(f"**Analyse van de afgelopen {days_back} dag(en) | Geselecteerde onderwerpen: {', '.join(selected_topics)}**")

col1, col2, col3, col4, col5 = st.columns(5)

if not tweets_df.empty:
    total = len(tweets_df)
    pos_pct = (tweets_df["sentiment_label"] == "positive").mean() * 100
    neg_pct = (tweets_df["sentiment_label"] == "negative").mean() * 100
    avg_likes = tweets_df["likes"].mean()
    avg_rt    = tweets_df["retweets"].mean()
else:
    total = pos_pct = neg_pct = avg_likes = avg_rt = 0

col1.metric("📝 Totaal tweets",   f"{total:,}")
col2.metric("💚 Positief",         f"{pos_pct:.1f}%")
col3.metric("❤️ Negatief",         f"{neg_pct:.1f}%")
col4.metric("❤️ Gem. likes",        f"{avg_likes:.0f}")
col5.metric("🔁 Gem. retweets",    f"{avg_rt:.0f}")

st.divider()

# ─── Row 1: Sentiment trend + Topic distribution ──────────────────────────────

row1_left, row1_right = st.columns([2, 1])

with row1_left:
    st.subheader("📈 Dagelijkse sentiment trend")

    if not tweets_df.empty:
        trend = (
            tweets_df.groupby(["date", "sentiment_label"])
            .size()
            .reset_index(name="count")
        )
        fig_trend = px.line(
            trend,
            x="date",
            y="count",
            color="sentiment_label",
            color_discrete_map=SENTIMENT_COLORS,
            labels={"date": "Datum", "count": "Aantal tweets", "sentiment_label": "Sentiment"},
            markers=True,
        )
        fig_trend.update_layout(height=300, margin=dict(t=10, b=10))
        st.plotly_chart(fig_trend, use_container_width=True)
    else:
        st.info("Geen data beschikbaar.")

with row1_right:
    st.subheader("🗂️ Verdeling per onderwerp")

    if not tweets_df.empty:
        topic_counts = tweets_df["topic"].value_counts().reset_index()
        topic_counts.columns = ["topic", "count"]
        fig_donut = px.pie(
            topic_counts,
            names="topic",
            values="count",
            color="topic",
            color_discrete_map=TOPIC_COLORS,
            hole=0.5,
        )
        fig_donut.update_layout(height=300, showlegend=True, margin=dict(t=10, b=10))
        st.plotly_chart(fig_donut, use_container_width=True)
    else:
        st.info("Geen data beschikbaar.")

st.divider()

# ─── Row 2: Top 5 topics + Engagement ─────────────────────────────────────────

row2_left, row2_right = st.columns(2)

with row2_left:
    st.subheader("🏆 Top 5 sociale thema's vandaag")

    if not summary_df.empty:
        today_summary = summary_df[summary_df["date"] == summary_df["date"].max()]
        top5 = (
            today_summary.groupby("cluster_label")
            .agg(total_tweets=("tweet_count", "sum"), total_likes=("total_likes", "sum"))
            .nlargest(5, "total_tweets")
            .reset_index()
        )
        fig_top5 = px.bar(
            top5,
            x="total_tweets",
            y="cluster_label",
            orientation="h",
            color="total_likes",
            color_continuous_scale="Blues",
            labels={"total_tweets": "Aantal tweets", "cluster_label": "Thema", "total_likes": "Likes"},
        )
        fig_top5.update_layout(height=300, margin=dict(t=10, b=10), yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(fig_top5, use_container_width=True)
    else:
        st.info("Nog geen samenvatting beschikbaar.")

with row2_right:
    st.subheader("📊 Engagement per onderwerp")

    if not tweets_df.empty:
        eng = (
            tweets_df.groupby("topic")
            .agg(avg_likes=("likes", "mean"), avg_retweets=("retweets", "mean"))
            .reset_index()
        )
        fig_eng = go.Figure()
        fig_eng.add_trace(go.Bar(name="Gem. likes",    x=eng["topic"], y=eng["avg_likes"],    marker_color="#2563EB"))
        fig_eng.add_trace(go.Bar(name="Gem. retweets", x=eng["topic"], y=eng["avg_retweets"], marker_color="#16A34A"))
        fig_eng.update_layout(barmode="group", height=300, margin=dict(t=10, b=10))
        st.plotly_chart(fig_eng, use_container_width=True)
    else:
        st.info("Geen data beschikbaar.")

st.divider()

# ─── Row 3: Sentiment heatmap per topic ───────────────────────────────────────

st.subheader("🌡️ Sentiment per onderwerp over tijd")

if not tweets_df.empty:
    heat_data = (
        tweets_df.groupby(["date", "topic"])
        .apply(lambda g: (g["sentiment_label"] == "positive").mean() - (g["sentiment_label"] == "negative").mean())
        .reset_index(name="sentiment_net")
    )
    heat_pivot = heat_data.pivot(index="topic", columns="date", values="sentiment_net")
    fig_heat = px.imshow(
        heat_pivot,
        color_continuous_scale="RdYlGn",
        zmin=-1, zmax=1,
        labels={"color": "Net sentiment", "x": "Datum", "y": "Onderwerp"},
        aspect="auto",
    )
    fig_heat.update_layout(height=250, margin=dict(t=10, b=10))
    st.plotly_chart(fig_heat, use_container_width=True)
else:
    st.info("Geen data beschikbaar.")

st.divider()

# ─── Row 4: Influential tweets table ─────────────────────────────────────────

st.subheader("⭐ Meest invloedrijke tweets")

search_query = st.text_input("🔍 Zoek in tweets…", placeholder="bijv. huurprijs, salaris, wachttijd")

if not tweets_df.empty:
    display_df = tweets_df.copy()

    if search_query:
        display_df = display_df[
            display_df["text"].str.contains(search_query, case=False, na=False)
        ]

    # Influence score = likes + (2 × retweets)
    display_df["influence_score"] = display_df["likes"] + 2 * display_df["retweets"]
    top_tweets = (
        display_df
        .nlargest(50, "influence_score")
        [["author", "author_handle", "topic", "text", "likes", "retweets", "sentiment_label", "published_at", "tweet_url"]]
        .rename(columns={
            "author":         "Auteur",
            "author_handle":  "Handle",
            "topic":          "Onderwerp",
            "text":           "Tweet",
            "likes":          "❤️",
            "retweets":       "🔁",
            "sentiment_label":"Sentiment",
            "published_at":   "Datum",
            "tweet_url":      "Link",
        })
    )

    # Truncate long tweets for display
    top_tweets["Tweet"] = top_tweets["Tweet"].str[:140] + "…"

    st.dataframe(
        top_tweets,
        use_container_width=True,
        hide_index=True,
        column_config={
            "Link": st.column_config.LinkColumn("🔗 Link"),
            "Datum": st.column_config.DatetimeColumn("Datum", format="DD/MM/YYYY HH:mm"),
        },
        height=400,
    )
else:
    st.info("Geen tweets gevonden voor de geselecteerde filters.")

# ─── Footer ───────────────────────────────────────────────────────────────────

st.divider()
st.caption(
    "Dutch Social Monitor • Data scraped from X (Twitter) • "
    "Sentiment analyse met RobBERT (DTAI-KULeuven) • "
    "Gebouwd met Streamlit + Supabase"
)
