"""Dutch Political Media Monitor: Streamlit dashboard.

Run:  streamlit run dashboard/dashboard.py
"""

import html
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from monitor import insights as ins  # noqa: E402
from monitor.common import PLATFORM_LABELS, load_yaml  # noqa: E402
from monitor.storage import get_store, to_frame  # noqa: E402
from i18n import translator  # noqa: E402

# Language: English or Dutch, kept in the address (?lang=nl) so a Dutch link can be shared.
LANG = "nl" if st.query_params.get("lang") == "nl" else "en"
t = translator(LANG)

st.set_page_config(page_title=t("Dutch Political Media Monitor"), page_icon="🏛️", layout="wide")

ENTITIES = load_yaml("entities.yaml")

# ----------------------------------------------------------------------------- colours
# One colour per job, always the same for the same thing, readable for colour-blind viewers:
#  * parties keep their own party colour (config/entities.yaml), so a party looks the same in every chart;
#  * tone is green (positive) / grey (neutral) / red (negative), in tones that stay apart for most colour-blind
#    viewers (the green leans blue, the red leans orange);
#  * channels and platforms have fixed colours from a colour-blind-safe set;
#  * amounts (heatmaps) use one blue ramp from light to dark.
PARTY_COLORS = {name: spec.get("color", "#898781") for name, spec in ENTITIES["parties"].items()}
POS, NEU, NEG = "#1f9e6e", "#b9b8b0", "#e0453c"
# Before this day items come from the one-off year backfill (weekly news searches, capped per query); from this day
# on from the regular 6-hourly collection, which finds more per day. Volumes on either side are not comparable.
LIVE_SINCE = pd.Timestamp("2026-10-01")

TONE_EXPLAINER = (
    "**Tone is judged per item** (one headline or post), not per party. It describes the text: critical, angry, "
    "alarmed or mocking is *negative*; approving, hopeful or celebrating a success is *positive*; plain factual "
    "reporting is *neutral*.\n\n"
    "**Every party and issue the item is about gets that item's tone.** A negative post that names the PVV and "
    "Migration counts once as negative for the PVV and once as negative for Migration.\n\n"
    "**Tone does not say who the negativity is aimed at.** \"PVV wants an asylum stop, opposition furious\" and "
    "\"PVV furious about asylum chaos\" are both negative: in the first the PVV is criticised, in the second the PVV "
    "is the critic. So a party's negative tone means *the party appears in negative-toned discussion*, often about "
    "an issue it campaigns on, not necessarily that people dislike the party.\n\n"
    "**Net sentiment** = % positive − % negative items. Example: 100 items, 20 positive and 50 negative gives "
    "net −30. News headlines lean negative in general, so compare a party with the average, with other parties or "
    "with itself over time, rather than with zero.")
TONE_COLORS = {"positive": POS, "neutral": NEU, "negative": NEG}
TONE_ORDER = ["negative", "neutral", "positive"]
CHANNEL_COLORS = {"News media": "#4a3aa7", "Social media": "#eb6834"}
PLATFORM_COLORS = {PLATFORM_LABELS[k]: c for k, c in {
    "news": "#2a78d6", "google_news": "#4a3aa7", "gdelt": "#0f8fa8", "bluesky": "#eda100", "mastodon": "#e87ba4",
    "reddit": "#eb6834", "telegram": "#26a5e4", "youtube": "#b5179e", "youtube_comment": "#7a0f6b",
    "x": "#52514e"}.items()}
DIVERGING = [[0, "#a3262a"], [0.25, "#ec8f86"], [0.5, "#f0efec"], [0.75, "#86cfac"], [1, "#127a52"]]
SEQUENTIAL = [[0, "#eef4fc"], [0.2, "#b7d3f6"], [0.45, "#6da7ec"], [0.7, "#2a78d6"], [1, "#0d366b"]]
ACCENT = "#2a78d6"

st.markdown("""
<style>
  .block-container {padding-top: 3.2rem; max-width: 1440px;}
  [data-testid="stMetric"] {border: 1px solid rgba(128,128,128,.22); border-radius: 12px; padding: 12px 16px;}
  [data-testid="stMetricLabel"] p {font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7;}
  .kicker {font-size: .78rem; letter-spacing: .08em; text-transform: uppercase; opacity: .6; margin-bottom: -.5rem;}
  .summary {font-size: .95rem; opacity: .85; margin: -.4rem 0 .8rem 0;}
  .chip {display: inline-block; border: 1px solid rgba(128,128,128,.35); border-radius: 999px; padding: 1px 10px;
         margin: 2px 4px 2px 0; font-size: .8rem;}
  .alert {border-left: 4px solid #eda100; background: rgba(237,161,0,.08); padding: .6rem .9rem;
          border-radius: 6px; margin-bottom: .5rem;}
  .alert b {font-weight: 650;}
  [data-testid="stSidebar"] h3 {margin-top: .4rem;}
  .kpis {display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: .2rem 0 1rem;}
  .kpi {border: 1px solid rgba(128,128,128,.22); border-radius: 12px; padding: 12px 14px; display: flex;
        flex-direction: column; gap: 4px; min-width: 0;}
  .kpi-label {font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; opacity: .65; line-height: 1.2;}
  .kpi-value {font-size: 1.65rem; font-weight: 650; line-height: 1.15; overflow-wrap: anywhere;
              font-variant-numeric: tabular-nums;}
  .kpi-value.small {font-size: 1.25rem;}
  .kpi-sub {font-size: .8rem; opacity: .7; margin-top: auto; line-height: 1.3;}
  .pos {color: #1f9e6e;} .neg {color: #e0453c;}
  .about-card {border: 1px solid rgba(128,128,128,.22); border-radius: 12px; padding: 1rem 1.2rem;}
  @media (max-width: 640px) {
    .block-container {padding: 2.6rem .8rem 2rem;}
    h1 {font-size: 1.7rem !important;}
    .kpis {grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;}
    .kpi-value {font-size: 1.3rem;} .kpi-value.small {font-size: 1.05rem;}
    [data-baseweb="tab-list"] {overflow-x: auto;}
  }
</style>
""", unsafe_allow_html=True)


# ----------------------------------------------------------------------------- helpers

def style(fig, height=380, legend=True):
    fig.update_layout(height=height, margin=dict(l=8, r=8, t=52, b=8), legend_title_text="",
                      showlegend=legend, hoverlabel=dict(namelength=-1), font=dict(size=13),
                      title=dict(font=dict(size=15)), bargap=0.25,
                      legend=dict(orientation="h", yanchor="bottom", y=1.0, xanchor="right", x=1))
    fig.update_xaxes(showgrid=False)
    fig.update_yaxes(gridcolor="rgba(128,128,128,.15)", zeroline=False)
    return fig


def _hover(template):
    """Translate the 'column=value' parts that plotly express writes into hover texts."""
    template = re.sub(r"(^|<br>)([\w ]+)=", lambda m: m.group(1) + t(m.group(2)) + "=", template)
    return re.sub(r"=([^%<{][^<]*)", lambda m: "=" + t(m.group(1)), template)


def localise(fig):
    if LANG == "nl":
        for trace in fig.data:
            if getattr(trace, "name", None):
                trace.name = t(trace.name)
            if getattr(trace, "hovertemplate", None):
                trace.hovertemplate = _hover(trace.hovertemplate)
            if trace.type == "sunburst":
                trace.labels = [t(label) for label in trace.labels]
    return fig


def show(fig, height=380, legend=True):
    st.plotly_chart(style(localise(fig), height, legend), width="stretch", config={"displayModeBar": False})


def note(text):
    st.caption(text)


def kpis(cards):
    """A row of equal-height cards that wraps (two per row on a phone). cards: (label, value, sub, css class)."""
    cells = []
    for label, value, sub, cls in cards:
        value = html.escape(str(value))
        size = " small" if len(value) > 9 else ""
        cells.append(f'<div class="kpi"><div class="kpi-label">{html.escape(label)}</div>'
                     f'<div class="kpi-value{size} {cls}">{value}</div>'
                     f'<div class="kpi-sub">{html.escape(sub or "")}</div></div>')
    st.markdown(f'<div class="kpis">{"".join(cells)}</div>', unsafe_allow_html=True)


def tone_class(net):
    return "pos" if net >= 5 else "neg" if net <= -5 else ""


def complete(frame, col, value="items"):
    """Long table with a row for every date x category (0 where nothing was found), so lines do not skip gaps."""
    if frame.empty:
        return frame
    wide = frame.pivot_table(index="date", columns=col, values=value, aggfunc="sum", fill_value=0)
    freq = "W-MON" if weekly else "D"
    wide = wide.reindex(pd.date_range(wide.index.min(), wide.index.max(), freq=freq), fill_value=0)
    return wide.rename_axis("date").reset_index().melt(id_vars="date", var_name=col, value_name=value)


def smooth_lines(fig):
    fig.update_traces(line=dict(shape="spline", smoothing=0.8, width=2.2))
    return fig


def party_order(df, limit=None):
    names = ins.share_of_voice(df, "parties", by_channel=False)["parties"].tolist()
    return names[:limit] if limit else names


def issue_order(df):
    return ins.share_of_voice(df, "issues", by_channel=False)["issues"].tolist()


def has_any(series, wanted):
    wanted = set(wanted)
    return series.apply(lambda values: bool(wanted.intersection(values)))


@st.cache_data(ttl=600, show_spinner=False)
def load(days):
    store = get_store()
    try:
        return store.load(days=days, max_rows=200_000), store.name, None
    except Exception as exc:
        return to_frame([]), store.name, str(exc)


@st.cache_data(show_spinner="Generating demo data…")
def load_demo():
    from monitor.demo import make_demo_items

    return to_frame(make_demo_items())


# ----------------------------------------------------------------------------- time filter

PRESETS = {"Last 24 hours": 1, "Last 7 days": 7, "Last 30 days": 30, "Last 90 days": 90, "Last 6 months": 182,
           "Last 12 months": 365, "All data": None, "Custom dates": None}
today = date.today()


def _apply_preset():
    """Choosing a preset fills in the From / To dates."""
    preset = st.session_state["preset"]
    if preset == "Custom dates":
        return
    span = PRESETS[preset]
    st.session_state["date_from"] = today - timedelta(days=span) if span else today - timedelta(days=400)
    st.session_state["date_to"] = today


def _mark_custom():
    st.session_state["preset"] = "Custom dates"


if "preset" not in st.session_state:
    st.session_state["preset"] = "Last 30 days"
    _apply_preset()

def _set_lang():
    st.query_params["lang"] = "nl" if st.session_state["lang"] == "Nederlands" else "en"


with st.sidebar:
    st.segmented_control(t("Language"), ["English", "Nederlands"], key="lang", on_change=_set_lang,
                         default="Nederlands" if LANG == "nl" else "English", label_visibility="collapsed")
    st.markdown("### 🏛️ " + t("Media Monitor"))
    st.markdown("**" + t("Time") + "**")
    st.selectbox(t("Period"), list(PRESETS), key="preset", on_change=_apply_preset, label_visibility="collapsed",
                 format_func=t)
    d1, d2 = st.columns(2)
    d1.date_input(t("From"), key="date_from", on_change=_mark_custom, format="DD-MM-YYYY", max_value=today)
    d2.date_input(t("To"), key="date_to", on_change=_mark_custom, format="DD-MM-YYYY", max_value=today)

date_from, date_to = st.session_state["date_from"], st.session_state["date_to"]
if date_from > date_to:
    date_from, date_to = date_to, date_from
span_days = (date_to - date_from).days + 1
days_needed = (today - date_from).days + 1 + span_days  # + the period before, for comparisons
with st.spinner(t("Loading data…")):
    raw, store_name, load_error = load(30 if days_needed <= 30 else 90 if days_needed <= 90 else 400)

demo = raw.empty
if demo:
    raw = load_demo()
data = ins.prepare(raw)
if demo:  # demo data ends "now"; keep the chosen span but anchor it to the demo's newest item
    newest = data["published_at"].max().tz_convert(ins.TZ).date()
    date_to, date_from = newest, newest - timedelta(days=span_days - 1)

start = pd.Timestamp(date_from, tz=ins.TZ)
end = pd.Timestamp(date_to, tz=ins.TZ) + pd.Timedelta(days=1)
if st.session_state["preset"] == "Last 24 hours" and not demo:
    end = data["published_at"].max()
    start = end - pd.Timedelta(hours=24)
in_time = data[(data["published_at"] >= start) & (data["published_at"] < end)]

# ----------------------------------------------------------------------------- other filters

with st.sidebar:
    st.markdown("**" + t("Sources") + "**")
    channel = st.segmented_control(t("Channel"), ["All", "News media", "Social media"], default="All",
                                   label_visibility="collapsed", format_func=t) or "All"
    platforms_all = sorted(data["platform"].unique(),
                           key=lambda p: list(PLATFORM_LABELS).index(p) if p in PLATFORM_LABELS else 99)
    platforms = st.multiselect(t("Platforms"), platforms_all, default=platforms_all,
                               format_func=lambda p: t(PLATFORM_LABELS.get(p, p)))
    source_options = in_time[in_time["platform"].isin(platforms)]["source"].value_counts().index.tolist()
    sources = st.multiselect(t("Outlets / channels"), source_options, placeholder=t("All outlets and channels"),
                             help=t("Sorted by number of items in the chosen period."))

    st.markdown("**" + t("Topics") + "**")
    all_parties = party_order(in_time) or list(PARTY_COLORS)
    focus = st.multiselect(t("Parties"), all_parties, default=all_parties[:8],
                           help=t("Charts compare these parties. Default: the 8 most-mentioned in the period."))
    only_focus = st.toggle(t("Only items about these parties"), value=False)
    issue_filter = st.multiselect(t("Issues"), issue_order(in_time) or list(ENTITIES["issues"]),
                                  placeholder=t("All issues"))

    st.markdown("**" + t("Content") + "**")
    tones = st.pills(t("Tone"), TONE_ORDER, selection_mode="multi", default=TONE_ORDER,
                     format_func=lambda x: t(x.capitalize()))
    query = st.text_input(t("Search text"), placeholder=t("e.g. huurprijzen, Schoof, asiel"))
    ai_only = st.toggle(t("Only AI-labelled items"), value=False,
                        help=t("Items whose party, issue and tone were judged by the AI model, not by keywords."))

    st.divider()
    if demo:
        st.info(t("Showing **fictional demo data**. Run the pipeline to collect real data (see README)."))
    else:
        st.caption(t("Data: {store} · {n} items loaded · newest {newest}", store=store_name, n=f"{len(data):,}",
                     newest=f"{data['published_at'].max().tz_convert(ins.TZ):%d-%m-%Y %H:%M}"))
    if load_error:
        st.warning(t("Could not read {store}: {error}", store=store_name, error=load_error[:160]))
    c1, c2 = st.columns(2)
    if c1.button(t("↻ Refresh"), width="stretch"):
        st.cache_data.clear()
        st.rerun()
    if c2.button(t("Reset filters"), width="stretch"):
        for key in list(st.session_state):
            if key != "lang":
                del st.session_state[key]
        st.rerun()

def apply_filters(frame):
    """Every sidebar filter except the period, so the same selection can be applied to other periods."""
    frame = frame[frame["platform"].isin(platforms)]
    if channel != "All":
        frame = frame[frame["channel"] == channel]
    if sources:
        frame = frame[frame["source"].isin(sources)]
    if only_focus and focus:
        frame = frame[has_any(frame["parties"], focus)]
    if issue_filter:
        frame = frame[has_any(frame["issues"], issue_filter)]
    if tones:
        frame = frame[frame["sentiment"].isin(tones)]
    if query:
        frame = frame[frame["text"].str.contains(query, case=False, na=False, regex=False) |
                      frame["title"].fillna("").str.contains(query, case=False, regex=False)]
    if ai_only:
        frame = frame[frame["analysed_by"] == "llm"]
    return frame


df = apply_filters(in_time)
# The same selection over the period of equal length just before, for "compared with" findings. Only when that
# period is fully inside the loaded data.
prev_start = start - (end - start)
previous = (apply_filters(data[(data["published_at"] >= prev_start) & (data["published_at"] < start)])
            if len(data) and data["published_at"].min() <= prev_start + pd.Timedelta(days=1) else None)
focus = focus or all_parties[:8]

# Long periods are shown per week, short ones per day.
weekly = span_days > 120
if weekly:
    df = df.assign(date=df["date"].dt.to_period("W-SUN").dt.start_time)
unit = t("week" if weekly else "day")

# ----------------------------------------------------------------------------- header

st.markdown(f'<p class="kicker">{t("Dutch politics · news & social media")}</p>', unsafe_allow_html=True)
st.title(t("Political Media Monitor"))
active = [t(channel) if channel != "All" else None,
          t("{n} of {total} platforms", n=len(platforms), total=len(platforms_all))
          if len(platforms) < len(platforms_all) else None,
          t("{n} outlets", n=len(sources)) if sources else None,
          t("only selected parties") if only_focus else None,
          ", ".join(issue_filter) if issue_filter else None,
          t("tone: {tones}", tones=", ".join(t(x) for x in tones)) if tones and len(tones) < 3 else None,
          f'"{query}"' if query else None, t("AI-labelled only") if ai_only else None]
chips = "".join(f'<span class="chip">{a}</span>' for a in active if a)
st.markdown(f'<p class="summary"><b>{t("{n} items", n=f"{len(df):,}")}</b> · {date_from:%d-%m-%Y} – '
            f'{date_to:%d-%m-%Y} · {t("per week" if weekly else "per day")} {chips}</p>', unsafe_allow_html=True)
if demo:
    st.warning(t("**Demo mode:** the numbers below are generated from fictional posts and invented outlets, only to "
                 "show what the dashboard does. Real data appears after the first pipeline run."), icon="🧪")
if df.empty:
    st.error(t("No items match the current filters. Widen the dates or remove a filter (or press Reset filters)."))
    st.stop()

tabs = st.tabs([t(x) for x in ["🧭 Briefing", "📈 Trends", "🗳️ Parties", "📌 Issues", "📰 Media landscape",
                                "💬 Narratives", "🔎 Explorer", "ℹ️ Methodology", "👤 About"]])

# ----------------------------------------------------------------------------- 1. briefing

with tabs[0]:
    sent = ins.sentiment_table(df, "parties", min_n=5)
    sov = ins.share_of_voice(df, "parties", by_channel=False)
    issues_sov = ins.share_of_voice(df, "issues", by_channel=False)
    net_all = 100 * (df["is_pos"].mean() - df["is_neg"].mean())
    items_sub = (t("{change} vs. previous period", change=f"{len(df) / len(previous) - 1:+.0%}")
                 if previous is not None and len(previous) >= 20 else
                 t("{n} news · {m} social", n=f"{(df['channel'] == 'News media').sum():,}",
                   m=f"{(df['channel'] == 'Social media').sum():,}"))
    kpis([
        (t("Items"), f"{len(df):,}", items_sub, ""),
        (t("Net tone"), f"{net_all:+.0f}", t("{pos} positive · {neg} negative", pos=f"{df['is_pos'].mean():.0%}",
                                              neg=f"{df['is_neg'].mean():.0%}"), tone_class(net_all)),
        (t("Social media share"), f"{(df['channel'] == 'Social media').mean():.0%}",
         t("{n} posts", n=f"{(df['channel'] == 'Social media').sum():,}"), ""),
        (t("Sources"), f"{df['source'].nunique():,}", t("outlets and channels"), ""),
        (t("Most discussed"), sov.iloc[0]["parties"] if len(sov) else "–",
         t("{share} share of voice", share=f"{sov.iloc[0]['share']:.0%}") if len(sov) else "", ""),
        (t("Top issue"), issues_sov.iloc[0]["issues"] if len(issues_sov) else "–",
         t("{share} of issue mentions", share=f"{issues_sov.iloc[0]['share']:.0%}") if len(issues_sov) else "", ""),
    ])

    ai_share = (df["analysed_by"] == "llm").mean()
    if ai_share < 0.5 and not demo:
        st.info(t("**{share} of these items have AI labels.** The rest are labelled by a simpler keyword model that "
                  "marks more headlines negative than the AI does, so tone here leans negative. AI labelling catches up "
                  "every run; switch on *AI-labelled only* in the sidebar for the most reliable tone.",
                  share=f"{ai_share:.0%}"), icon="🤖")

    left, right = st.columns([3, 2])
    with left:
        st.subheader(t("Key findings"))
        st.caption(t("Computed from the items that match your filters, {start} – {end}.",
                     start=f"{date_from:%d-%m-%Y}", end=f"{date_to:%d-%m-%Y}"))
        for line in ins.executive_brief(df, lang=LANG, parties=focus, issues=issue_filter or None,
                                        previous=previous, days=span_days):
            st.markdown(f"- {line}")
    with right:
        st.subheader(t("🚨 Alerts (last 24 hours)"))
        found = False
        for col, kind in [("parties", "party"), ("issues", "issue")]:
            al = ins.alerts(apply_filters(data), col)
            al = al[al[col].isin(focus)] if col == "parties" and not al.empty else al
            for row in al.head(4).itertuples():
                found = True
                tone = (t("tone {shift} pts vs. usual", shift=f"{row.net_shift:+.0f}") if abs(row.net_shift) >= 5
                        else t("tone unchanged"))
                text = t("<b>{name}</b> ({kind}): <b>{recent}</b> mentions vs. ~{typical} normally ({ratio}×); {tone}.",
                         name=getattr(row, col), kind=t(kind), recent=row.recent, typical=f"{row.typical:.0f}",
                         ratio=f"{row.recent / max(row.typical, 1):.1f}", tone=tone)
                st.markdown(f'<div class="alert">{text}</div>', unsafe_allow_html=True)
        if not found:
            st.caption(t("No unusual spikes: every party and issue is within its normal range."))

    c1, c2 = st.columns(2)
    with c1:
        s = ins.share_of_voice(df, "parties", by_channel=True)
        s = s[s["parties"].isin(focus)]
        fig = px.bar(s, x="mentions", y="parties", color="channel", orientation="h", color_discrete_map=CHANNEL_COLORS,
                     title=t("Share of voice: mentions per party"),
                     category_orders={"parties": [p for p in party_order(df) if p in focus]})
        fig.update_layout(yaxis_title="", xaxis_title=t("Mentions"), barmode="stack")
        show(fig, 420)
    with c2:
        st_ = sent[sent["parties"].isin(focus)].sort_values("net")
        fig = go.Figure(go.Scatter(
            x=st_["net"], y=st_["parties"], mode="markers",
            error_x=dict(type="data", array=st_["ci"], color="rgba(128,128,128,.55)", thickness=1.5),
            marker=dict(size=[max(9, min(28, m ** 0.5)) for m in st_["mentions"]],
                        color=[PARTY_COLORS.get(p, "#898781") for p in st_["parties"]],
                        line=dict(width=2, color="rgba(255,255,255,.9)")),
            customdata=st_[["mentions", "positive", "negative"]],
            hovertemplate="<b>%{y}</b><br>" + t("Net sentiment {value}", value="%{x:+.0f}") + "<br>" +
                          t("{n} mentions", n="%{customdata[0]}") + "<br>" +
                          t("positive {pos} · negative {neg}", pos="%{customdata[1]:.0%}", neg="%{customdata[2]:.0%}") +
                          "<extra></extra>"))
        fig.add_vline(x=0, line_dash="dot", line_color="gray")
        fig.add_vline(x=net_all, line_dash="dash", line_color="#52514e", line_width=1,
                      annotation_text=t("average {value}", value=f"{net_all:+.0f}"), annotation_position="top",
                      annotation_font_size=11)
        fig.update_layout(title=t("Net sentiment per party (±95% interval)"), xaxis_title=t("% positive − % negative"),
                          yaxis_title="")
        show(fig, 420, legend=False)
    with st.expander(t("ℹ️ What does tone mean? (e.g. a negative post that names a party and an issue)")):
        st.markdown(t(TONE_EXPLAINER))
    note(t("Share of voice counts items that mention a party. Net sentiment = % positive items − % negative items; "
           "bubble size = number of mentions; the whisker shows the statistical uncertainty. Compare a party with the "
           "dashed average line rather than with zero: headlines are on balance negative for everyone."))

# ----------------------------------------------------------------------------- 2. trends

with tabs[1]:
    if df["date"].nunique() < 2:
        st.caption(t("Choose a longer period to see trends."))
    else:
        vol = df.groupby(["date", "sentiment"]).size().reset_index(name="items")
        mark_live = df["date"].min() < LIVE_SINCE <= df["date"].max()
        if mark_live:
            note(t("The dotted line marks {day}: before it the history was collected once from weekly news searches, "
                   "after it the regular collection runs every 6 hours. Compare tone across the line, not volume.",
                   day=f"{LIVE_SINCE:%d-%m-%Y}"))

        def live_line(fig):
            if mark_live:
                fig.add_vline(x=LIVE_SINCE.timestamp() * 1000, line_dash="dot", line_color="#52514e", line_width=1)
            return fig

        c1, c2 = st.columns([3, 2])
        with c1:
            fig = px.area(complete(vol, "sentiment"), x="date", y="items", color="sentiment", line_shape="spline",
                          color_discrete_map=TONE_COLORS, category_orders={"sentiment": TONE_ORDER},
                          title=t("Items per {unit}, by tone", unit=unit))
            fig.update_traces(line=dict(width=1, smoothing=0.8))
            fig.update_layout(xaxis_title="", yaxis_title=t("Items per {unit}", unit=unit), hovermode="x unified")
            show(live_line(fig), 380)
        with c2:
            net = df.groupby("date").agg(n=("id", "size"), pos=("is_pos", "sum"), neg=("is_neg", "sum"))
            net = net[net["n"] >= 5]
            net["net"] = 100 * (net["pos"] - net["neg"]) / net["n"]
            # the trend line pools the counts of a few neighbouring days/weeks, so quiet days do not make it jump
            window = 3 if weekly else 7 if span_days >= 14 else 1
            roll = net[["n", "pos", "neg"]].rolling(window, min_periods=1, center=True).sum()
            trend = 100 * (roll["pos"] - roll["neg"]) / roll["n"]
            fig = go.Figure(go.Bar(x=net.index, y=net["net"], marker_color=[POS if v >= 0 else NEG for v in net["net"]],
                                   opacity=0.35, customdata=net["n"], name=t("per {unit}", unit=unit),
                                   hovertemplate="%{x|%d-%m-%Y}<br>" + t("net tone {value}", value="%{y:+.0f}") +
                                                 "<br>%{customdata} items<extra></extra>"))
            if window > 1:
                fig.add_trace(go.Scatter(x=trend.index, y=trend, mode="lines", name=t("trend"),
                                         line=dict(color="#3d3c38", width=2.5, shape="spline", smoothing=1.0),
                                         hovertemplate=t("trend {value}", value="%{y:+.0f}") + "<extra></extra>"))
            fig.add_hline(y=0, line_color="gray", line_width=1)
            fig.update_layout(title=t("Overall net tone per {unit}", unit=unit), yaxis_title=t("% positive − % negative"),
                              xaxis_title="")
            show(live_line(fig), 380, legend=window > 1)

        def heat(col, names, title):
            ex = ins.explode(df, col)
            ex = ex[ex[col].isin(names)]
            if ex.empty:
                return
            grid = pd.crosstab(ex[col], ex["date"]).reindex(names).dropna(how="all")
            fig = px.imshow(grid, aspect="auto", color_continuous_scale=SEQUENTIAL, title=title,
                            labels=dict(x="", y="", color="Mentions"))
            fig.update_traces(hovertemplate="%{y}<br>%{x|%d-%m-%Y}: " + t("{z} mentions", z="%{z}") + "<extra></extra>",
                              xgap=1, ygap=1)
            fig.update_layout(coloraxis_colorbar=dict(thickness=10, title=""))
            show(fig, 90 + 30 * len(grid), legend=False)

        heat("parties", focus, t("Attention per party and {unit}", unit=unit))
        heat("issues", issue_filter or issue_order(df), t("Attention per issue and {unit}", unit=unit))
        note(t("Darker cells = more mentions. Read a row left to right to see when a party or issue was in the news; "
               "read a column to see what dominated that {unit}.", unit=unit))

        plat = complete(df.groupby(["date", "platform_label"]).size().reset_index(name="items"), "platform_label")
        fig = px.area(plat, x="date", y="items", color="platform_label", color_discrete_map=PLATFORM_COLORS,
                      line_shape="spline", title=t("Where the items came from, per {unit}", unit=unit))
        fig.update_traces(line=dict(width=1, smoothing=0.8))
        fig.update_layout(xaxis_title="", yaxis_title=t("Items per {unit}", unit=unit), hovermode="x unified")
        show(live_line(fig), 340)

# ----------------------------------------------------------------------------- 3. parties

with tabs[2]:
    st.subheader(t("Attention over time"))
    vol = ins.daily_volume(df, "parties", focus)
    if df["date"].nunique() > 1 and not vol.empty:
        pivot = vol.pivot(index="date", columns="parties", values="mentions").fillna(0)
        pivot = pivot.reindex(pd.date_range(pivot.index.min(), pivot.index.max(), freq="W-MON" if weekly else "D"),
                              fill_value=0).rename_axis("date")
        smooth = pivot.rolling(3, min_periods=1).mean() if (span_days >= 14 and not weekly) else pivot
        long = smooth.reset_index().melt(id_vars="date", var_name="parties", value_name="mentions")
        fig = px.line(long, x="date", y="mentions", color="parties", color_discrete_map=PARTY_COLORS,
                      title=t("Mentions per {unit}", unit=unit) +
                      (t(" (3-day average)") if span_days >= 14 and not weekly else ""),
                      category_orders={"parties": focus})
        smooth_lines(fig)
        fig.update_layout(xaxis_title="", yaxis_title=t("Mentions per {unit}", unit=unit), hovermode="x unified")
        show(fig, 400)

        if weekly:
            net = ins.daily_net(df, "parties", focus[:6])
            net = net[net["n"] >= 10]
        else:
            net = ins.rolling_net(df, "parties", focus[:6], window=7 if span_days >= 14 else 1)
        if not net.empty:
            fig = px.line(net, x="date", y="net", color="parties", color_discrete_map=PARTY_COLORS,
                          title=t("Net sentiment per week" if weekly else "Net sentiment, 7-day rolling"
                                  if span_days >= 14 else "Daily net sentiment") + t(" (first 6 selected parties)"),
                          category_orders={"parties": focus[:6]})
            smooth_lines(fig)
            fig.add_hline(y=0, line_dash="dot", line_color="gray")
            fig.update_layout(xaxis_title="", yaxis_title=t("Net sentiment"), hovermode="x unified")
            show(fig, 380)
    else:
        st.caption(t("Choose a period of 7 days or more to see trends."))

    c1, c2 = st.columns(2)
    with c1:
        mom = ins.momentum(df if span_days >= 14 else data[data["platform"].isin(platforms)], "parties")
        mom = mom[mom["parties"].isin(focus)].sort_values("change") if not mom.empty else mom
        if not mom.empty:
            span = max(mom["change"].abs().max(), 0.01)
            fig = px.bar(mom, x="change", y="parties", orientation="h",
                         title=t("Momentum: share of voice, last 7 days vs. the 7 days before"),
                         color="change", color_continuous_scale=DIVERGING, range_color=[-span, span])
            fig.update_traces(hovertemplate="%{y}: %{x:+.1%}<extra></extra>")
            fig.update_layout(xaxis_tickformat="+.0%", xaxis_title=t("Change in share of voice (pts)"), yaxis_title="",
                              coloraxis_showscale=False)
            show(fig, 400, legend=False)
    with c2:
        tone = sent[sent["parties"].isin(focus)].sort_values("mentions")
        if not tone.empty:
            long = tone.melt(id_vars="parties", value_vars=TONE_ORDER, var_name="tone", value_name="share")
            fig = px.bar(long, x="share", y="parties", color="tone", orientation="h", title=t("Tone of coverage"),
                         color_discrete_map=TONE_COLORS, category_orders={"tone": TONE_ORDER})
            fig.update_layout(xaxis_tickformat=".0%", xaxis_title="", yaxis_title="", barmode="stack")
            show(fig, 400)

    st.subheader(t("News vs. social media tone"))
    both = sent[sent["parties"].isin(focus)].dropna(subset=["news_net", "social_net"])
    if not both.empty:
        fig = go.Figure()
        for row in both.itertuples():
            fig.add_trace(go.Scatter(x=[row.news_net, row.social_net], y=[row.parties] * 2, mode="lines",
                                     line=dict(color="rgba(140,140,140,.45)", width=3), showlegend=False,
                                     hoverinfo="skip"))
        for name, col in [("News media", "news_net"), ("Social media", "social_net")]:
            fig.add_trace(go.Scatter(x=both[col], y=both["parties"], mode="markers", name=name,
                                     marker=dict(size=13, color=CHANNEL_COLORS[name],
                                                 line=dict(width=2, color="rgba(255,255,255,.9)")),
                                     hovertemplate="%{y}: %{x:+.0f}<extra>" + t(name) + "</extra>"))
        fig.add_vline(x=0, line_dash="dot", line_color="gray")
        fig.update_layout(xaxis_title=t("Net sentiment"), yaxis_title="", title=t("Where is a party judged more harshly?"))
        show(fig, 380)
        note(t("A long line means the party is judged very differently by journalists and by the public online."))
    else:
        st.caption(t("Needs both news and social items for the selected parties."))

    st.subheader(t("Issue profile per party"))
    matrix = ins.party_issue_matrix(df, focus)
    if not matrix.empty:
        fig = px.imshow(matrix, text_auto=".0%", aspect="auto", color_continuous_scale=SEQUENTIAL,
                        title=t("Share of each party's mentions that is about each issue"))
        fig.update_traces(xgap=2, ygap=2)
        fig.update_layout(coloraxis_showscale=False, xaxis_title="", yaxis_title="")
        fig.update_xaxes(tickangle=-35)
        show(fig, 90 + 38 * len(matrix))
        note(t("Read across a row: which issues a party is linked to in the media (issue ownership)."))

# ----------------------------------------------------------------------------- 4. issues

with tabs[3]:
    isent = ins.sentiment_table(df, "issues", min_n=5)
    order = issue_order(df)
    c1, c2 = st.columns([3, 2])
    with c1:
        s = ins.share_of_voice(df, "issues", by_channel=True)
        fig = px.bar(s, x="mentions", y="issues", color="channel", orientation="h", color_discrete_map=CHANNEL_COLORS,
                     title=t("The political agenda: mentions per issue"), category_orders={"issues": order})
        fig.update_layout(yaxis_title="", xaxis_title=t("Mentions"), barmode="stack")
        show(fig, 520)
    with c2:
        gap = ins.agenda_gap(df)
        if not gap.empty and df["channel"].nunique() > 1:
            span = max(gap["gap"].abs().max(), 0.01)
            fig = px.bar(gap, x="gap", y="issue", orientation="h", color="gap", color_continuous_scale=[
                [0, CHANNEL_COLORS["News media"]], [0.5, "#e1e0d9"], [1, CHANNEL_COLORS["Social media"]]],
                range_color=[-span, span], title=t("Agenda gap"),
                hover_data={"news": ":.1%", "social": ":.1%", "gap": ":+.1%"})
            fig.update_layout(xaxis_tickformat="+.0%", xaxis_title=t("← bigger in news · bigger on social →"),
                              yaxis_title="", coloraxis_showscale=False)
            show(fig, 520, legend=False)
        else:
            st.caption(t("Select both channels to compare the news agenda with the social-media agenda."))

    pick = st.multiselect(t("Issues to compare over time"), order, default=order[:4], max_selections=6,
                          key="issue_trend")
    if pick and df["date"].nunique() > 1:
        vol = complete(ins.daily_volume(df, "issues", pick), "issues", "mentions")
        if not weekly and span_days >= 14:
            vol["mentions"] = vol.groupby("issues")["mentions"].transform(lambda v: v.rolling(3, min_periods=1).mean())
        palette = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"]
        fig = px.line(vol, x="date", y="mentions", color="issues", title=t("Mentions per {unit}", unit=unit),
                      color_discrete_map=dict(zip(pick, palette)), category_orders={"issues": pick})
        smooth_lines(fig)
        fig.update_layout(xaxis_title="", yaxis_title=t("Mentions per {unit}", unit=unit), hovermode="x unified")
        show(fig, 380)

    if not isent.empty:
        issue_tone = isent.sort_values("net")
        span = max(10, issue_tone["net"].abs().max())
        fig = px.bar(issue_tone, x="net", y="issues", orientation="h", color="net", color_continuous_scale=DIVERGING,
                     range_color=[-span, span], title=t("Tone of the debate per issue"), hover_data={"mentions": True})
        fig.update_layout(xaxis_title=t("Net sentiment"), yaxis_title="", coloraxis_showscale=False)
        show(fig, 460, legend=False)
        note(t("Issue tone reflects how people and media talk about the topic (e.g. worry about housing), "
               "not support for a policy."))

# ----------------------------------------------------------------------------- 5. media landscape

with tabs[4]:
    c1, c2 = st.columns([2, 3])
    with c1:
        mix = df.groupby(["channel", "platform_label"]).size().reset_index(name="items")
        fig = px.sunburst(mix, path=["channel", "platform_label"], values="items", title=t("Where the items come from"),
                          color="platform_label", color_discrete_map={**PLATFORM_COLORS, **CHANNEL_COLORS})
        fig.update_traces(insidetextorientation="radial", marker=dict(
            colors=[CHANNEL_COLORS.get(lb, PLATFORM_COLORS.get(lb, "#898781")) for lb in fig.data[0].labels],
            line=dict(width=2, color="white")))
        show(fig, 440, legend=False)
    with c2:
        top_src = df.groupby(["source", "platform_label"]).size().reset_index(name="items") \
            .sort_values("items", ascending=False).head(20)
        fig = px.bar(top_src, x="items", y="source", color="platform_label", orientation="h",
                     color_discrete_map=PLATFORM_COLORS, title=t("Most active sources"))
        fig.update_layout(yaxis_title="", xaxis_title=t("Items"), yaxis_categoryorder="total ascending")
        show(fig, 440)

    st.subheader(t("How each outlet covers each party"))
    grid = ins.outlet_tone(df, focus)
    if grid is not None and not grid.empty and grid.notna().any().any():
        fig = px.imshow(grid, text_auto=".0f", aspect="auto", color_continuous_scale=DIVERGING, zmin=-60, zmax=60,
                        title=t("Net sentiment by news outlet (blank = fewer than 4 articles)"))
        fig.update_traces(xgap=2, ygap=2)
        fig.update_layout(xaxis_title="", yaxis_title="", coloraxis_colorbar=dict(title=t("Net"), thickness=10))
        show(fig, 90 + 34 * len(grid))
        note(t("Differences between outlets can reflect editorial choices, but also which events they covered. "
               "Treat as a signal to investigate, not as proof of bias."))
    else:
        st.caption(t("Not enough news articles per outlet and party in this selection."))

    attention = ins.explode(df[df["channel"] == "News media"], "parties")
    attention = attention[attention["parties"].isin(focus)]
    if not attention.empty:
        top_outlets = attention["source"].value_counts().head(10).index
        ct = pd.crosstab(attention["source"], attention["parties"], normalize="index").reindex(top_outlets)
        long = ct.reset_index().melt(id_vars="source", var_name="parties", value_name="share")
        fig = px.bar(long, x="share", y="source", color="parties", orientation="h", color_discrete_map=PARTY_COLORS,
                     title=t("Which parties each outlet pays attention to"),
                     category_orders={"parties": [p for p in focus if p in ct.columns]})
        fig.update_layout(xaxis_tickformat=".0%", xaxis_title=t("Share of the outlet's party mentions"), yaxis_title="",
                          barmode="stack")
        show(fig, 460)

# ----------------------------------------------------------------------------- 6. narratives

with tabs[5]:
    labels = {("all", ""): t("All items"), **{("party", p): t("Party: {name}", name=p) for p in all_parties},
              **{("issue", i): t("Issue: {name}", name=i) for i in issue_order(df)}}
    kind, name = st.selectbox(t("Subject"), list(labels), format_func=labels.get)
    sub = df
    exclude = set()
    if kind == "party":
        sub = df[df["parties"].apply(lambda values: name in values)]
        spec = ENTITIES["parties"][name]
        exclude = {w.lower() for w in [name] + spec.get("exact", []) + spec.get("words", [])}
    elif kind == "issue":
        sub = df[df["issues"].apply(lambda values: name in values)]

    if sub.empty:
        st.caption(t("No items for this subject."))
    else:
        c1, c2 = st.columns(2)
        with c1:
            terms = pd.DataFrame(ins.top_terms(sub["text"], 15, exclude), columns=["term", "items"])
            if not terms.empty:
                fig = px.bar(terms.iloc[::-1], x="items", y="term", orientation="h", title=t("Most used words & phrases"))
                fig.update_traces(marker_color=ACCENT)
                fig.update_layout(yaxis_title="", xaxis_title=t("Items"))
                show(fig, 460, legend=False)
        with c2:
            em = ins.emerging_terms(sub, exclude=exclude)
            if not em.empty:
                fig = px.bar(em.iloc[::-1], x="lift", y="term", orientation="h",
                             title=t("Emerging in the last 48 hours of the period"),
                             hover_data={"recent": True, "before": True, "lift": ":.2f"})
                fig.update_traces(marker_color="#eb6834")
                fig.update_layout(yaxis_title="", xaxis_title=t("How much more frequent than before (log ratio)"))
                show(fig, 460, legend=False)
            else:
                st.caption(t("No clearly emerging terms for this subject in the last 48 hours of the period."))

        c3, c4 = st.columns(2)
        link = st.column_config.LinkColumn("Link", display_text=t("open ↗"))
        with c3:
            st.markdown("**" + t("Most engaged social posts") + "**")
            posts = sub[sub["channel"] == "Social media"].sort_values("engagement", ascending=False).head(10)
            posts = posts.assign(sentiment=posts["sentiment"].map(t), platform_label=posts["platform_label"].map(t))
            st.dataframe(posts[["platform_label", "author", "text", "engagement", "sentiment", "url"]], hide_index=True,
                         column_config={"platform_label": t("Platform"), "author": t("Author"), "text": t("Post"),
                                        "engagement": st.column_config.NumberColumn(
                                            t("Engagement"), help=t("likes + 2×shares + replies")),
                                        "sentiment": t("Tone"), "url": link})
        with c4:
            st.markdown("**" + t("Latest headlines") + "**")
            news = sub[sub["channel"] == "News media"].sort_values("published_at", ascending=False).head(10)
            news = news.assign(headline=news["title"].fillna(news["text"]), sentiment=news["sentiment"].map(t))
            st.dataframe(news[["source", "headline", "sentiment", "url"]], hide_index=True,
                         column_config={"source": t("Outlet"), "headline": t("Headline"), "sentiment": t("Tone"),
                                        "url": link})

# ----------------------------------------------------------------------------- 7. explorer

with tabs[6]:
    st.caption(t("{n} items match the filters in the sidebar (newest first; the table shows up to 3,000).",
                 n=f"{len(df):,}"))
    ex = df.sort_values("published_at", ascending=False)
    table = ex.assign(parties=ex["parties"].apply(", ".join), issues=ex["issues"].apply(", ".join),
                      published=ex["published_at"].dt.tz_convert(ins.TZ).dt.strftime("%d-%m-%Y %H:%M"),
                      method=ex["analysed_by"].map({"llm": "AI"}).fillna(t("keywords")),
                      sentiment=ex["sentiment"].map(t), platform_label=ex["platform_label"].map(t))
    st.dataframe(table[["published", "platform_label", "source", "author", "text", "parties", "issues", "sentiment",
                        "sentiment_score", "method", "engagement", "url"]].head(3000), hide_index=True, height=600,
                 column_config={"published": t("Time ").strip(), "platform_label": t("Platform"), "source": t("Source"),
                                "author": t("Author"), "text": st.column_config.TextColumn(t("Text"), width="large"),
                                "parties": t("Parties"), "issues": t("Issues"), "sentiment": t("Tone"),
                                "sentiment_score": st.column_config.ProgressColumn(
                                    t("Score"), min_value=-1, max_value=1, format="%+.2f"),
                                "method": t("Labelled by"), "engagement": t("Engagement"),
                                "url": st.column_config.LinkColumn("Link", display_text=t("open ↗"))})
    st.download_button(t("⬇️ Download selection (CSV)"), table.drop(columns=["is_pos", "is_neg"]).to_csv(index=False).encode(),
                       "political_media_monitor.csv", "text/csv")

# ----------------------------------------------------------------------------- 8. methodology


def pipeline_diagram():
    """How an item travels from a source to this page, as a top-down Graphviz flow chart (narrow enough for phones)."""
    node = lambda key, label, fill: f'{key} [label="{label}", fillcolor="{fill}"];'
    news, social, step, store, out = "#e4e1f6", "#fde6d8", "#eef4fc", "#e7f5ee", "#f0efec"
    lines = [
        'digraph G { rankdir=TB; bgcolor="transparent"; nodesep=0.35; ranksep=0.32;',
        'node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=13, color="#9a9890", '
        'margin="0.18,0.08"];',
        'edge [color="#7a7870", arrowsize=0.7];',
        node("news", t("News media\\nnews sites (RSS), Google News, GDELT"), news),
        node("social", t("Social media\\nMastodon, YouTube, Reddit,\\nTelegram, Bluesky, X"), social),
        node("collect", t("Collect every 6 hours\\n(GitHub Actions, polite pauses)"), step),
        node("dedupe", t("Remove duplicates\\n(same headline or post)"), step),
        node("ai", t("AI reads each item (Gemini)\\nrelevant? parties, issues, tone"), step),
        node("kw", t("Fallback when the AI quota is used up:\\nkeywords + sentiment model"), out),
        node("db", t("Supabase database\\n(400 days kept)"), store),
        node("relabel", t("Older items relabelled\\nby the AI each run"), out),
        node("dash", t("This dashboard\\nfilters, charts, findings"), store),
        "{rank=same; news; social;}",
        "news -> collect; social -> collect; collect -> dedupe -> ai -> db -> dash;",
        "ai -> kw [style=dashed]; kw -> db [style=dashed]; db -> relabel [style=dashed, dir=both];",
        "}",
    ]
    return "\n".join(lines)


with tabs[7]:
    n_issues = len(ENTITIES["issues"])
    c1, c2 = st.columns([1, 1], gap="large")
    with c1:
        st.markdown("#### " + t("How the monitor works"))
        st.graphviz_chart(pipeline_diagram(), width="stretch")
        note(t("Solid arrows: the path of every item. Dashed: items the AI could not label yet get keyword labels "
               "first and are relabelled by the AI in later runs."))
    with c2:
        st.markdown("#### " + t("What tone (sentiment) means"))
        st.markdown(t(TONE_EXPLAINER))
        if LANG == "nl":
            st.markdown(f"""
#### Wat wordt gemeten
- **Items**: nieuwsartikelen (RSS-feeds van Nederlandse media, Google News, GDELT) en openbare berichten op sociale
  media (Mastodon, Reddit, YouTube, Telegram, Bluesky, optioneel X). Alleen items over Nederlandse politiek worden
  bewaard. Dezelfde kop of hetzelfde bericht telt één keer: dubbele items worden na elke run verwijderd.
- **Partijen, thema's en toon** worden beoordeeld door een AI-model (Google Gemini) dat elk item leest en kiest uit
  de vaste lijst partijen en {n_issues} thema's in `config/entities.yaml`. Items die de AI nog niet kon labelen
  (gratis dagquotum) krijgen labels via trefwoorden en een meertalig sentimentmodel; de kolom "Gelabeld door" in
  de Verkenner laat zien welke.
- **Geschiedenis**: het afgelopen jaar is één keer verzameld uit Google News (week voor week), GDELT en Mastodon;
  sinds 1 oktober 2026 wordt alles elke 6 uur verzameld. De wekelijkse zoekopdrachten leveren minder items per week
  op dan de reguliere verzameling, dus vergelijk over die datum de **toon**, niet het volume (stippellijn bij
  Trends). Oudere items krijgen geleidelijk AI-labels, nieuwste eerst; de AI verwijdert ook items die niet over
  Nederlandse politiek gaan.
- **Bevindingen** op het Overzicht worden berekend uit de items die bij je filters passen, en vergeleken met
  dezelfde selectie in de even lange periode ervoor.
- **Signalen**: vermeldingen in de laatste 24 uur vergeleken met de twee weken ervoor; gemarkeerd bij minstens
  2 standaardafwijkingen boven normaal.

#### Kleuren
- Toon is **groen = positief, grijs = neutraal, rood = negatief**. Elke partij houdt overal haar eigen kleur.
  Heatmaps lopen van licht (weinig) naar donkerblauw (veel).

#### Verantwoord lezen
- Sociale media zijn **niet representatief** voor het electoraat: actieve gebruikers, bots en campagnes zijn
  oververtegenwoordigd.
- Koppen zijn kort, dus hun toon is minder zeker dan bij volledige berichten.
- Het trefwoordmodel voor items zonder AI-label noemt meer koppen negatief dan de AI. Vergelijk partijen met het
  gemiddelde, of zet *alleen AI-gelabeld* aan.
- De strepen in de sentimentgrafiek tonen onzekerheid: kleine partijen met weinig vermeldingen hebben brede
  intervallen.
""")
        else:
            st.markdown(f"""
#### What is measured
- **Items**: news articles (RSS feeds of Dutch outlets, Google News, GDELT) and public social-media posts
  (Mastodon, Reddit, YouTube, Telegram, Bluesky, optionally X). Only items about Dutch politics are kept.
  The same headline or post is counted once: duplicates are removed after every run.
- **Parties, issues and tone** are judged by an AI model (Google Gemini) that reads each item and picks from the
  fixed list of parties and {n_issues} issues in `config/entities.yaml`. Items the AI could not label yet (daily
  free quota) use keyword matching and a multilingual sentiment model; the Explorer's "Labelled by" column shows
  which.
- **History**: the past year was collected once from Google News (week by week), GDELT and Mastodon; since
  1 October 2026 everything is collected every 6 hours. The weekly searches return fewer items per week than the
  regular collection, so compare **tone**, not volume, across that date (dotted line in Trends). Older items get
  AI labels gradually, newest first; the AI also removes items it finds are not about Dutch politics.
- **Findings** on the Briefing are computed from the items that match your filters, and compared with the same
  selection in the period of equal length before it.
- **Alerts**: mentions in the last 24 hours compared with the previous two weeks; flagged when at least
  2 standard deviations above normal.

#### Colours
- Tone is **green = positive, grey = neutral, red = negative**. Each party keeps its own colour everywhere.
  Heatmaps go from light (few) to dark blue (many).

#### How to read it responsibly
- Social media is **not representative** of the electorate: active users, bots and campaigns are over-represented.
- Headlines are short, so their tone is less certain than that of full posts.
- The keyword model used for items without AI labels marks more headlines negative than the AI does. Compare
  parties with the average, or switch on *AI-labelled only*.
- The whiskers on the sentiment chart show uncertainty: small parties with few mentions have wide intervals.
""")

# ----------------------------------------------------------------------------- 9. about

with tabs[8]:
    about = load_yaml("about.yaml") or {}
    text = about.get(LANG) or about.get("en") or {}
    st.subheader(t("About"))
    c1, c2 = st.columns(2)
    for col, key in [(c1, "eindata"), (c2, "author")]:
        block = text.get(key) or {}
        with col:
            st.markdown(f'<div class="about-card"><h4>{html.escape(block.get("title", ""))}</h4>'
                        f'{"".join(f"<p>{html.escape(p)}</p>" for p in block.get("paragraphs", []))}</div>',
                        unsafe_allow_html=True)
    links = [f"[{html.escape(label)}]({url})" for label, url in (about.get("links") or {}).items() if url]
    if links:
        st.markdown(" · ".join(links))
    st.caption(text.get("project", ""))
