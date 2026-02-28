import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from supabase import create_client, Client
import os
from datetime import datetime, timedelta

# --- Page Configuration ---
st.set_page_config(page_title="SocialMonitor AI", page_icon="📈", layout="wide")

# Custom CSS for Professional Look
st.markdown("""
    <style>
    .main { background-color: #F8FAFC; }
    .stMetric { background-color: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #E2E8F0; }
    [data-testid="stHeader"] { background: #1E293B; }
    h1, h2 { color: #1E293B; font-weight: 700; }
    </style>
""", unsafe_allow_html=True)

# --- Data Connection ---
@st.cache_resource
def init_connection() -> Client:
    url = os.environ.get("SUPABASE_URL") or st.secrets.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or st.secrets.get("SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)

supabase = init_connection()

@st.cache_data(ttl=300)
def load_data():
    # Fetch from the summary table
    res = supabase.table("daily_topic_summary").select("*").execute()
    df = pd.DataFrame(res.data)
    
    # Define Categories
    social_topics = ["Migratie", "Belasting", "Mensenrechten", "Woning", "Salaris", "huisvesting", "zorg", "klimaat", "onderwijs"]
    party_topics = ["PVV", "VVD", "CDA", "GPvda", "D66", "J21", "FvD"]
    
    df['category'] = df['topic'].apply(lambda x: "Social" if x in social_topics else ("Party" if x in party_topics else "Other"))
    return df

df = load_data()

# --- Dashboard Logic ---
st.title("🏛️ Dutch Social Intelligence Monitor")
st.markdown("Automated sentiment and thematic tracking for Dutch public discourse.")

# Create Tabs for the two dashboards
tab_social, tab_party = st.tabs(["🌍 Social Issues Dashboard", "🗳️ Political Parties Dashboard"])

def render_dashboard(data, title, color_theme):
    if data.empty:
        st.warning(f"No data available for {title}.")
        return

    # Topline KPIs
    total_vol = data['tweet_count'].sum()
    avg_sent = data['avg_sentiment_score'].mean()
    
    k1, k2, k3 = st.columns(3)
    k1.metric(f"Total {title} Volume", f"{total_vol:,}")
    k2.metric("Net Sentiment Index", f"{avg_sent:.2f}")
    k3.metric("Primary Driver", data.loc[data['tweet_count'].idxmax(), 'topic'])

    st.markdown("---")

    col_l, col_r = st.columns([2, 1])
    
    with col_l:
        st.subheader(f"{title} Breakdown: Volume vs Sentiment")
        # Treemap for hierarchical view
        fig = px.treemap(data, path=['topic', 'cluster_label'], values='tweet_count',
                         color='avg_sentiment_score', color_continuous_scale='RdYlGn',
                         color_continuous_min=-0.6, color_continuous_max=0.6)
        st.plotly_chart(fig, use_container_width=True)

    with col_r:
        st.subheader("Sentiment Distribution")
        # Pie chart for high-level sentiment split
        sent_agg = data.agg({'positive_count':'sum', 'negative_count':'sum', 'tweet_count':'sum'})
        neu_count = sent_agg['tweet_count'] - (sent_agg['positive_count'] + sent_agg['negative_count'])
        
        fig_pie = px.pie(
            names=['Positive', 'Neutral', 'Negative'],
            values=[sent_agg['positive_count'], neu_count, sent_agg['negative_count']],
            color_discrete_sequence=['#10B981', '#94A3B8', '#EF4444'],
            hole=0.4
        )
        st.plotly_chart(fig_pie, use_container_width=True)

    st.markdown("---")
    st.subheader(f"{title} Trend Analysis")
    trend = data.groupby('date').agg({'tweet_count':'sum', 'avg_sentiment_score':'mean'}).reset_index()
    fig_line = px.line(trend, x='date', y='avg_sentiment_score', markers=True, 
                       color_discrete_sequence=[color_theme])
    fig_line.add_hline(y=0, line_dash="dash", line_color="black")
    st.plotly_chart(fig_line, use_container_width=True)

# --- Render Social Dashboard ---
with tab_social:
    social_df = df[df['category'] == "Social"]
    render_dashboard(social_df, "Social Issues", "#2563EB")

# --- Render Party Dashboard ---
with tab_party:
    party_df = df[df['category'] == "Party"]
    render_dashboard(party_df, "Political Parties", "#DC2626")
