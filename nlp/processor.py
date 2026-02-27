"""
Dutch Social Monitor — Professional Dashboard
Organized by Social Topics and Political Parties
"""

import os
import requests
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from datetime import datetime, timezone, timedelta

# --- Page Configuration ---
st.set_page_config(
    page_title="Dutch Social Monitor | Analytics",
    page_icon="🇳🇱",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- Theme Styling ---
st.markdown("""
    <style>
    .main { background-color: #f8f9fa; }
    .stMetric { background-color: #ffffff; padding: 15px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    </style>
    """, unsafe_allow_html=True)

# --- Data Fetching (Using REST for Production Stability) ---
def get_creds():
    url = os.environ.get("SUPABASE_URL") or st.secrets.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY") or st.secrets.get("SUPABASE_KEY", "")
    return url.strip(), key.strip()

@st.cache_data(ttl=900)
def load_data(days=7):
    url, key = get_creds()
    if not url or not key: return pd.DataFrame()
    
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    params = {"analysis_date": f"gte.{cutoff}", "order": "published_at.desc"}
    
    r = requests.get(f"{url}/rest/v1/dashboard_tweets", headers=headers, params=params)
    df = pd.DataFrame(r.json())
    if not df.empty:
        df["published_at"] = pd.to_datetime(df["published_at"])
    return df

# --- Sidebar & Navigation ---
with st.sidebar:
    st.image("https://flagcdn.com/w80/nl.png", width=50)
    st.title("Social Monitor")
    st.subheader("Data Control Panel")
    
    days = st.select_slider("Time Horizon", options=[1, 3, 7, 14, 30], value=7)
    
    st.divider()
    st.caption("NLP Model: RobBERT-v2 Dutch Sentiment")
    if st.button("Refresh Pipeline Data"):
        st.cache_data.clear()
        st.rerun()

# --- Main Logic ---
df = load_data(days)

if df.empty:
    st.warning("No data found for the selected period. Please ensure the scraper has run.")
else:
    # Header
    st.title("🇳🇱 Dutch Public Discourse Analytics")
    st.info(f"Analyzing {len(df):,} tweets from the last {days} days.")

    # KPI Row
    c1, c2, c3, c4 = st.columns(4)
    pos_perc = (df['sentiment_label'] == 'positive').mean() * 100
    neg_perc = (df['sentiment_label'] == 'negative').mean() * 100
    
    c1.metric("Total Volume", f"{len(df):,}")
    c2.metric("Positive Sentiment", f"{pos_perc:.1f}%", delta=None)
    c3.metric("Negative Sentiment", f"{neg_perc:.1f}%", delta_color="inverse")
    c4.metric("Avg Engagement", f"{df['likes'].mean():.1f} ❤️")

    # --- Tabs for Organization ---
    tab1, tab2, tab3 = st.tabs(["📊 Social Topics", "🏛️ Political Parties", "🔍 Raw Intelligence"])

    with tab1:
        st.subheader("Group 1: Social Issues Analysis")
        social_list = ["Migratie", "Belasting", "Mensenrechten", "Woning", "Salaris"]
        df_social = df[df['topic'].isin(social_list)]
        
        col_a, col_b = st.columns(2)
        with col_a:
            fig_bar = px.bar(df_social.groupby('topic').size().reset_index(name='count'), 
                             x='topic', y='count', title="Volume by Topic", color='topic')
            st.plotly_chart(fig_bar, use_container_width=True)
        with col_b:
            # Sentiment heatmap by topic
            sentiment_map = df_social.groupby(['topic', 'sentiment_label']).size().unstack(fill_value=0)
            st.write("Sentiment Distribution by Social Topic")
            st.dataframe(sentiment_map.style.background_gradient(cmap='RdYlGn', axis=1), use_container_width=True)

    with tab2:
        st.subheader("Group 2: Political Party Sentiment")
        party_list = ["PVV", "VVD", "CDA", "GPvda", "D66", "J21", "FvD"]
        df_party = df[df['topic'].isin(party_list)]
        
        # Comparison of Parties
        fig_pol = px.box(df_party, x='topic', y='sentiment_score', color='topic',
                         title="Sentiment Variance by Political Party",
                         labels={'sentiment_score': 'Sentiment Intensity', 'topic': 'Party'})
        st.plotly_chart(fig_pol, use_container_width=True)

    with tab3:
        st.subheader("Exploration Engine")
        search = st.text_input("Search within the discourse...", placeholder="Search keywords (e.g., 'stikstof', 'inflatie')")
        
        filtered_df = df.copy()
        if search:
            filtered_df = df[df['text'].str.contains(search, case=False)]
            
        st.dataframe(
            filtered_df[['published_at', 'author', 'topic', 'text', 'sentiment_label', 'likes']],
            column_config={
                "text": st.column_config.TextColumn("Tweet Content", width="large"),
                "published_at": "Timestamp",
                "sentiment_label": "Sentiment"
            },
            use_container_width=True,
            hide_index=True
        )
