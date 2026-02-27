import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from supabase import create_client, Client
import os
import re
from collections import Counter

# --- Page Configuration ---
st.set_page_config(page_title="Dutch Social Monitor", page_icon="🇳🇱", layout="wide")

# Custom CSS for a professional look
st.markdown("""
    <style>
    .main {background-color: #f8f9fa;}
    h1, h2, h3 {color: #2c3e50;}
    .stMetric {background-color: white; padding: 15px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);}
    </style>
""", unsafe_allow_html=True)

st.title("🇳🇱 Dutch Social Monitor Dashboard")
st.markdown("Real-time sentiment and thematic analysis of Dutch political and social discourse on X.")

# --- 1. Connect to Supabase ---
@st.cache_resource
def init_connection() -> Client:
    url = os.environ.get("SUPABASE_URL") or st.secrets.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or st.secrets.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not url or not key:
        st.error("⚠️ Missing Supabase credentials. Check your .env file or Streamlit Secrets.")
        st.stop()
    return create_client(url, key)

supabase = init_connection()

# --- 2. Fetch & Prepare Data ---
@st.cache_data(ttl=600)
def load_data():
    response = supabase.table("dashboard_tweets").select("*").execute()
    df = pd.DataFrame(response.data)
    
    if df.empty:
        return df

    # Clean data & enforce types
    df = df.drop_duplicates(subset=['tweet_id'])
    df['sentiment_label'] = df['sentiment_label'].astype(str).str.lower()
    
    # Assign numerical scores for average calculations
    sentiment_map = {"positive": 1, "neutral": 0, "negative": -1}
    df["sentiment_value"] = df["sentiment_label"].map(sentiment_map).fillna(0)
    
    # Categorize Topics
    social_list = ["Migratie", "Belasting", "Mensenrechten", "Woning", "Salaris"]
    party_list = ["PVV", "VVD", "CDA", "GPvda", "D66", "J21", "FvD"]
    
    def get_category(topic):
        if topic in social_list: return "Social Issue"
        if topic in party_list: return "Political Party"
        return "Other"
        
    df["category"] = df["topic"].apply(get_category)
    return df

df = load_data()

if df.empty:
    st.warning("No data found in the database yet. Run your GitHub Action pipeline first!")
    st.stop()

# --- 3. Executive Summary Metrics ---
st.subheader("Executive Summary")
c1, c2, c3, c4 = st.columns(4)
c1.metric("Total Analyzed Tweets", f"{len(df):,}")
c2.metric("Most Discussed Topic", df['topic'].mode()[0])
c3.metric("Most Positive Topic", df.groupby('topic')['sentiment_value'].mean().idxmax())
c4.metric("Most Negative Topic", df.groupby('topic')['sentiment_value'].mean().idxmin())

st.markdown("---")

# --- 4. Comparative Figures (Volume & Avg Sentiment) ---
st.subheader("Comparative Overview: Volume & Net Sentiment")
st.markdown("Bars represent tweet volume. Colors represent average sentiment (Green = Positive, Red = Negative).")

col_social, col_party = st.columns(2)

def plot_volume_sentiment(dataframe, title):
    stats = dataframe.groupby('topic').agg(
        Volume=('tweet_id', 'count'),
        Net_Sentiment=('sentiment_value', 'mean')
    ).reset_index()
    
    fig = px.bar(
        stats, x='topic', y='Volume', color='Net_Sentiment',
        color_continuous_scale=['#e74c3c', '#95a5a6', '#2ecc71'],
        range_color=[-1, 1], title=title,
        labels={'topic': 'Topic', 'Volume': 'Number of Tweets', 'Net_Sentiment': 'Avg Sentiment'}
    )
    fig.update_layout(xaxis_categoryorder='total descending', plot_bgcolor='rgba(0,0,0,0)')
    return fig

with col_social:
    st.plotly_chart(plot_volume_sentiment(df[df['category'] == 'Social Issue'], "Social Issues"), use_container_width=True)

with col_party:
    st.plotly_chart(plot_volume_sentiment(df[df['category'] == 'Political Party'], "Political Parties"), use_container_width=True)

st.markdown("---")

# --- 5. Sentiment Distribution Per Topic ---
st.subheader("Sentiment Distribution Breakdown")
st.markdown("100% stacked view showing the exact proportion of sentiment per topic.")

dist_df = df.groupby(['topic', 'sentiment_label']).size().reset_index(name='Count')
fig_dist = px.bar(
    dist_df, x='topic', y='Count', color='sentiment_label',
    barmode='stack', barnorm='percent',
    color_discrete_map={"positive": "#2ecc71", "neutral": "#95a5a6", "negative": "#e74c3c"},
    labels={'Count': 'Percentage (%)', 'topic': 'Topic', 'sentiment_label': 'Sentiment'}
)
fig_dist.update_layout(xaxis_categoryorder='category ascending', plot_bgcolor='rgba(0,0,0,0)')
st.plotly_chart(fig_dist, use_container_width=True)

st.markdown("---")

# --- 6. NLP Deep Dive: Representative Words ---
st.subheader("Topic Deep Dive: Representative Themes")
st.markdown("Select a topic to extract the most frequently used words (excluding basic Dutch stopwords).")

# Dutch stopword list for cleaner keyword extraction
DUTCH_STOPWORDS = {
    "de", "en", "van", "ik", "te", "dat", "die", "in", "een", "hij", "het", "niet", 
    "zijn", "is", "was", "op", "aan", "met", "als", "voor", "had", "er", "maar", "om", 
    "hem", "dan", "zou", "of", "wat", "mijn", "men", "dit", "zo", "door", "over", "ze", 
    "zich", "bij", "ook", "tot", "je", "mij", "uit", "der", "daar", "haar", "naar", 
    "heb", "hoe", "heeft", "hebben", "deze", "u", "want", "nog", "zal", "me", "zij", 
    "nu", "ge", "geen", "omdat", "iets", "worden", "toch", "al", "waren", "veel", 
    "meer", "doen", "toen", "moet", "ben", "zonder", "kan", "hun", "dus", "alles", 
    "onder", "ja", "twee", "laat", "wel", "we", "ons", "wij", "wie", "gaan", "na", 
    "via", "welke", "steeds", "rt", "https", "t.co"
}

def extract_top_words(texts, num_words=15):
    words = []
    for text in texts:
        if isinstance(text, str):
            # Remove URLs and @mentions
            clean_text = re.sub(r'http\S+|www\.\S+|@\w+', '', text.lower())
            # Remove punctuation and split
            tokens = re.findall(r'\b[a-z]{3,}\b', clean_text)
            words.extend([w for w in tokens if w not in DUTCH_STOPWORDS])
    return Counter(words).most_common(num_words)

col_select, col_kw_chart = st.columns([1, 2])

with col_select:
    target_topic = st.selectbox("Choose a Topic:", sorted(df['topic'].unique()))
    target_df = df[df['topic'] == target_topic]
    
    st.write(f"**Total Tweets analyzed for {target_topic}:** {len(target_df)}")
    st.write(f"**Overall Sentiment:** {'🟢 Positive' if target_df['sentiment_value'].mean() > 0 else '🔴 Negative' if target_df['sentiment_value'].mean() < -0.1 else '⚪ Neutral'}")

with col_kw_chart:
    top_words = extract_top_words(target_df['text'].dropna())
    kw_df = pd.DataFrame(top_words, columns=['Word', 'Frequency'])
    
    fig_kw = px.bar(
        kw_df, x='Frequency', y='Word', orientation='h', 
        title=f"Top Keywords for: {target_topic}",
        color='Frequency', color_continuous_scale='Blues'
    )
    fig_kw.update_layout(yaxis={'categoryorder':'total ascending'}, plot_bgcolor='rgba(0,0,0,0)')
    st.plotly_chart(fig_kw, use_container_width=True)

st.markdown("---")

# --- 7. Data Explorer ---
with st.expander("🔍 View Raw Dataset"):
    st.dataframe(
        df[["topic", "category", "sentiment_label", "sentiment_score", "text"]].sort_values(by="sentiment_score", ascending=False),
        use_container_width=True,
        hide_index=True
    )
