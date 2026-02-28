import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import os
import re
from collections import Counter

# --- Page Configuration ---
st.set_page_config(page_title="Dutch Social Monitor", page_icon="nl", layout="wide")

st.markdown("""
    <style>
    .main {background-color: #f8f9fa;}
    h1, h2, h3 {color: #2c3e50;}
    .stMetric {background-color: white; padding: 15px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);}
    </style>
""", unsafe_allow_html=True)

st.title("Dutch Social Monitor Dashboard")
st.markdown("Real-time sentiment and thematic analysis of Dutch political and social discourse on X.")

# --- Connect to Supabase via REST (no SDK needed) ---
import requests as req

def get_creds():
    url = os.environ.get("SUPABASE_URL") or st.secrets.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY") or st.secrets.get("SUPABASE_KEY", "")
    return url.strip(), key.strip()

def sb_fetch(table, params=None):
    url, key = get_creds()
    if not url or not key:
        st.error("Missing SUPABASE_URL or SUPABASE_KEY in secrets.")
        st.stop()
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    r = req.get(url + "/rest/v1/" + table, headers=headers, params=params or {}, timeout=30)
    if r.status_code != 200:
        st.error("Supabase error " + str(r.status_code) + ": " + r.text[:200])
        st.stop()
    return r.json()

# --- Fetch & Prepare Data ---
@st.cache_data(ttl=600)
def load_data():
    rows = sb_fetch("dashboard_tweets", {"limit": "5000", "order": "published_at.desc"})
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df.drop_duplicates(subset=["tweet_id"])
    df["sentiment_label"] = df["sentiment_label"].astype(str).str.lower()
    sentiment_map = {"positive": 1, "neutral": 0, "negative": -1}
    df["sentiment_value"] = df["sentiment_label"].map(sentiment_map).fillna(0)
    return df

df = load_data()

if df.empty:
    st.warning("No data found yet. Run the GitHub Actions pipeline first!")
    st.stop()

# --- Executive Summary ---
st.subheader("Executive Summary")
c1, c2, c3, c4 = st.columns(4)
c1.metric("Total Tweets", f"{len(df):,}")
c2.metric("Most Discussed", df["topic"].mode()[0] if "topic" in df.columns else "-")
c3.metric("Most Positive Topic", df.groupby("topic")["sentiment_value"].mean().idxmax() if "topic" in df.columns else "-")
c4.metric("Most Negative Topic", df.groupby("topic")["sentiment_value"].mean().idxmin() if "topic" in df.columns else "-")

st.markdown("---")

# --- Volume & Sentiment ---
st.subheader("Volume & Net Sentiment per Topic")
st.markdown("Bar height = tweet volume. Color = average sentiment (green = positive, red = negative).")

if "topic" in df.columns:
    stats = df.groupby("topic").agg(
        Volume=("tweet_id", "count"),
        Net_Sentiment=("sentiment_value", "mean")
    ).reset_index()

    fig = px.bar(
        stats, x="topic", y="Volume", color="Net_Sentiment",
        color_continuous_scale=["#e74c3c", "#95a5a6", "#2ecc71"],
        range_color=[-1, 1],
        labels={"topic": "Topic", "Volume": "Tweets", "Net_Sentiment": "Avg Sentiment"}
    )
    fig.update_layout(xaxis_categoryorder="total descending", plot_bgcolor="rgba(0,0,0,0)")
    st.plotly_chart(fig, use_container_width=True)

st.markdown("---")

# --- Sentiment Distribution ---
st.subheader("Sentiment Distribution per Topic")

if "topic" in df.columns and "sentiment_label" in df.columns:
    dist = df.groupby(["topic", "sentiment_label"]).size().reset_index(name="Count")
    fig2 = px.bar(
        dist, x="topic", y="Count", color="sentiment_label",
        barmode="stack", barnorm="percent",
        color_discrete_map={"positive": "#2ecc71", "neutral": "#95a5a6", "negative": "#e74c3c"},
        labels={"Count": "Percentage (%)", "topic": "Topic", "sentiment_label": "Sentiment"}
    )
    fig2.update_layout(plot_bgcolor="rgba(0,0,0,0)")
    st.plotly_chart(fig2, use_container_width=True)

st.markdown("---")

# --- Keyword Deep Dive ---
st.subheader("Topic Deep Dive: Top Keywords")

DUTCH_STOPWORDS = {
    "de","en","van","ik","te","dat","die","in","een","hij","het","niet",
    "zijn","is","was","op","aan","met","als","voor","had","er","maar","om",
    "hem","dan","zou","of","wat","mijn","men","dit","zo","door","over","ze",
    "zich","bij","ook","tot","je","mij","uit","der","daar","haar","naar",
    "heb","hoe","heeft","hebben","deze","u","want","nog","zal","me","zij",
    "nu","ge","geen","omdat","iets","worden","toch","al","waren","veel",
    "meer","doen","toen","moet","ben","zonder","kan","hun","dus","alles",
    "onder","ja","twee","laat","wel","we","ons","wij","wie","gaan","na",
    "via","welke","steeds","rt","https","t","co","amp"
}

def top_words(texts, n=15):
    words = []
    for t in texts:
        if isinstance(t, str):
            clean = re.sub(r"http\S+|www\.\S+|@\w+", "", t.lower())
            tokens = re.findall(r"\b[a-z]{3,}\b", clean)
            words.extend([w for w in tokens if w not in DUTCH_STOPWORDS])
    return Counter(words).most_common(n)

if "topic" in df.columns:
    col1, col2 = st.columns([1, 2])
    with col1:
        topic = st.selectbox("Choose a topic:", sorted(df["topic"].unique()))
        tdf   = df[df["topic"] == topic]
        st.write(f"**Tweets:** {len(tdf)}")
        avg = tdf["sentiment_value"].mean()
        st.write("**Sentiment:** " + ("Positive" if avg > 0 else "Negative" if avg < -0.1 else "Neutral"))

    with col2:
        kws   = top_words(tdf["text"].dropna())
        kw_df = pd.DataFrame(kws, columns=["Word", "Frequency"])
        fig3  = px.bar(
            kw_df, x="Frequency", y="Word", orientation="h",
            title="Top Keywords: " + topic,
            color="Frequency", color_continuous_scale="Blues"
        )
        fig3.update_layout(yaxis={"categoryorder": "total ascending"}, plot_bgcolor="rgba(0,0,0,0)")
        st.plotly_chart(fig3, use_container_width=True)

st.markdown("---")

# --- Sentiment Trend Over Time ---
st.subheader("Sentiment Trend Over Time")

if "published_at" in df.columns and "sentiment_label" in df.columns:
    df["date"] = pd.to_datetime(df["published_at"], utc=True).dt.date
    trend = df.groupby(["date", "sentiment_label"]).size().reset_index(name="count")
    fig4  = px.line(
        trend, x="date", y="count", color="sentiment_label",
        color_discrete_map={"positive": "#2ecc71", "negative": "#e74c3c", "neutral": "#95a5a6"},
        markers=True,
        labels={"date": "Date", "count": "Tweets", "sentiment_label": "Sentiment"}
    )
    fig4.update_layout(plot_bgcolor="rgba(0,0,0,0)")
    st.plotly_chart(fig4, use_container_width=True)

st.markdown("---")

# --- Raw Data Explorer ---
with st.expander("View Raw Dataset"):
    cols = [c for c in ["topic","sentiment_label","sentiment_score","text","author","published_at"] if c in df.columns]
    st.dataframe(
        df[cols].sort_values("sentiment_score", ascending=False) if "sentiment_score" in df.columns else df[cols],
        use_container_width=True,
        hide_index=True
    )

st.caption("Dutch Social Monitor - Powered by Streamlit + Supabase")
