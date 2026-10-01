import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from monitor import collectors as col  # noqa: E402
from monitor import insights as ins  # noqa: E402
from monitor import llm, nlp, pipeline  # noqa: E402
from monitor.common import load_yaml, make_item, to_iso  # noqa: E402
from monitor.demo import make_demo_items  # noqa: E402
from monitor.storage import LocalStore, to_frame  # noqa: E402

NOW = datetime.now(timezone.utc)
SINCE = NOW - timedelta(days=2)
RECENT = (NOW - timedelta(hours=3)).strftime("%a, %d %b %Y %H:%M:%S +0000")
OLD = (NOW - timedelta(days=10)).strftime("%a, %d %b %Y %H:%M:%S +0000")


@pytest.fixture(scope="module")
def tagger():
    return nlp.Tagger()


# ----------------------------------------------------------------------------- tagging

@pytest.mark.parametrize("text, parties, issues", [
    ("Wilders wil de asielinstroom beperken", ["PVV"], ["Migratie & asiel"]),
    ("Yeşilgöz en Jetten debatteren over huurprijzen", ["VVD", "D66"], ["Wonen"]),
    ("De SP en GL-PvdA willen het eigen risico in de zorg afschaffen", ["GL-PvdA", "SP"], ["Zorg"]),
    ("Ik denk dat de sp niet goed is en we zorgen ons", [], []),     # lower-case 'sp' / 'zorgen' are not matches
    ("DENK stelt vragen; denk daar maar eens over na", ["DENK"], []),
    ("Een klaver met vier blaadjes", [], []),                           # 'klaver' (clover) is not Klaver
])
def test_tagger(tagger, text, parties, issues):
    p, i = tagger.tag(text)
    assert sorted(p) == sorted(parties)
    assert sorted(i) == sorted(issues)


def test_lexicon_sentiment_with_negation():
    assert nlp.label_of(nlp.lexicon_score("Dit is een schandalig en slecht plan")) == "negative"
    assert nlp.label_of(nlp.lexicon_score("Goed nieuws, een sterke oplossing")) == "positive"
    assert nlp.label_of(nlp.lexicon_score("Dit is niet goed")) == "negative"
    assert nlp.label_of(nlp.lexicon_score("De Kamer vergadert dinsdag")) == "neutral"


def test_model_output_mapping():
    score, label = nlp._probs_to_score([{"label": "negative", "score": 0.7}, {"label": "neutral", "score": 0.2},
                                        {"label": "positive", "score": 0.1}])
    assert round(score, 2) == -0.6 and label == "negative"
    score, _ = nlp._probs_to_score([{"label": "LABEL_2", "score": 0.9}, {"label": "LABEL_0", "score": 0.1}])
    assert round(score, 2) == 0.8


def test_backend_failure_falls_back_to_lexicon(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no model")
    monkeypatch.setattr(nlp, "_score_local", boom)
    scores, used = nlp.score_sentiment(["Een geweldig goed plan"], backend="local")
    assert used == "lexicon" and scores[0][1] == "positive"


def test_analyse_drops_irrelevant(tagger):
    items = [make_item("news", "NOS", "Kabinet valt over stikstof", url="u1"),
             make_item("news", "NOS", "Voetbaluitslagen van het weekend", url="u2")]
    kept, used = nlp.analyse(items, tagger, backend="lexicon")
    assert len(kept) == 1 and "Kabinet & formatie" in kept[0]["issues"] and used == "lexicon"


# ----------------------------------------------------------------------------- LLM classification

class _FakeClient:
    def __init__(self, reply, fail=False):
        self.reply, self.fail, self.calls = reply, fail, []

    def generate(self, model, system, prompt, schema):
        self.calls.append({"model": model, "system": system, "prompt": prompt, "schema": schema})
        if self.fail:
            raise RuntimeError("finishReason=SAFETY")
        return json.dumps(self.reply)


PARTIES, ISSUES = ["PVV", "D66"], ["Wonen", "Zorg"]


def _res(i, **kw):
    base = {"i": i, "relevant": True, "parties": [], "issues": [], "sentiment": "neutral", "score": 0.0}
    return {**base, **kw}


def test_llm_classify_validates_and_fixes_results():
    fake = _FakeClient({"results": [
        _res(0, parties=["PVV", "Fantasie"], issues=["Wonen"], sentiment="negative", score=0.7),   # sign fixed, name dropped
        _res(1, relevant=False)]})
    out = llm.classify([{"text": "a", "platform": "x"}, {"text": "b", "platform": "x"}], PARTIES, ISSUES, client=fake)
    assert out[0] == {"relevant": True, "parties": ["PVV"], "issues": ["Wonen"], "sentiment": "negative", "score": -0.7}
    assert out[1]["relevant"] is False
    call = fake.calls[0]
    assert call["schema"]["properties"]["results"]["items"]["properties"]["parties"]["items"]["enum"] == PARTIES
    assert "Dutch" in call["system"] and "[1] (x) b" in call["prompt"]


def test_llm_missing_or_refused_batch_gives_none():
    assert llm.classify([{"text": "a", "platform": "x"}], PARTIES, ISSUES, client=_FakeClient({"results": []})) == [None]
    refused = _FakeClient({"results": []}, fail=True)
    assert llm.classify([{"text": "a", "platform": "x"}], PARTIES, ISSUES, client=refused) == [None]


def test_gemini_client_request_shape(monkeypatch):
    class Resp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": '{"results": []}'}]}}]}

    sent = {}

    class Session:
        def post(self, url, json, timeout, headers):
            sent.update(url=url, body=json, headers=headers)
            return Resp()

    text = llm.GeminiClient("k", session=Session()).generate("gemini-flash-latest", "sys", "p", {"type": "object"})
    assert text == '{"results": []}' and sent["headers"]["x-goog-api-key"] == "k"
    assert "gemini-flash-latest:generateContent" in sent["url"]
    assert sent["body"]["generationConfig"]["responseJsonSchema"] == {"type": "object"}


def test_analyse_uses_llm_then_falls_back(tagger, monkeypatch):
    items = [make_item("news", "NOS", "Wilders over huurprijzen", url="u1"),
             make_item("news", "NOS", "Wilders en de zorg: een geweldig plan", url="u2"),
             make_item("news", "NOS", "Zorg kost veel", url="u3")]
    answers = [{"relevant": True, "parties": ["PVV"], "issues": ["Wonen"], "sentiment": "negative", "score": -0.6},
               None,
               {"relevant": False, "parties": [], "issues": [], "sentiment": "neutral", "score": 0.0}]
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "classify", lambda *a, **k: answers)
    kept, used = nlp.analyse(items, tagger)
    by_url = {i["url"]: i for i in kept}
    assert set(by_url) == {"u1", "u2"} and used.startswith("llm+")
    assert by_url["u1"]["sentiment"] == "negative" and by_url["u1"]["issues"] == ["Wonen"]
    assert by_url["u2"]["sentiment"] == "positive"          # lexicon fallback for the item the LLM skipped


# ----------------------------------------------------------------------------- collectors (offline fixtures)

RSS = f"""<?xml version="1.0"?><rss version="2.0"><channel><title>NOS Politiek</title>
<item><title>Kabinet presenteert woningplan</title><link>https://nos.nl/a/1</link>
<description>&lt;p&gt;Minister wil &lt;b&gt;100.000&lt;/b&gt; huizen per jaar.&lt;/p&gt;</description>
<pubDate>{RECENT}</pubDate><guid>https://nos.nl/a/1</guid></item>
<item><title>Oud bericht</title><link>https://nos.nl/a/0</link><pubDate>{OLD}</pubDate></item>
</channel></rss>"""

GOOGLE = f"""<?xml version="1.0"?><rss version="2.0"><channel><title>Google News</title>
<item><title>Wilders reageert op peiling - de Volkskrant</title><link>https://news.google.com/rss/articles/abc</link>
<pubDate>{RECENT}</pubDate><description>&lt;a&gt;Wilders reageert&lt;/a&gt;</description>
<source url="https://www.volkskrant.nl">de Volkskrant</source></item></channel></rss>"""

REDDIT = f"""<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><author><name>/u/kiezer</name></author><category term="thenetherlands" label="r/thenetherlands"/>
<content type="html">&lt;p&gt;Wat vinden jullie van het plan van de VVD?&lt;/p&gt;</content>
<id>t3_abc</id><link href="https://www.reddit.com/r/thenetherlands/comments/abc/"/>
<updated>{(NOW - timedelta(hours=2)).isoformat()}</updated><published>{(NOW - timedelta(hours=2)).isoformat()}</published>
<title>VVD plan huurwoningen</title></entry></feed>"""

TELEGRAM = """<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="kanaal/42">
<div class="tgme_widget_message_text">Baudet spreekt vanavond over <b>Oekraïne</b></div>
<span class="tgme_widget_message_views">12.5K</span>
<a class="tgme_widget_message_date" href="https://t.me/kanaal/42"><time datetime="%s">now</time></a>
</div></div>""" % (NOW - timedelta(hours=1)).isoformat()


def test_parse_news_rss():
    items = col.parse_feed(RSS, "news", "NOS", SINCE)
    assert len(items) == 1  # the 10-day-old article is outside the window
    it = items[0]
    assert it["source"] == "NOS" and it["url"] == "https://nos.nl/a/1"
    assert "100.000 huizen" in it["text"] and "<" not in it["text"]


def test_parse_google_news_uses_real_outlet():
    it = col.parse_feed(GOOGLE, "google_news", "Google News", SINCE)[0]
    assert it["source"] == "de Volkskrant" and it["title"] == "Wilders reageert op peiling"


def test_parse_reddit_atom():
    it = col.parse_feed(REDDIT, "reddit", "Reddit", SINCE)[0]
    assert it["source"] == "r/thenetherlands" and "plan van de VVD" in it["text"] and it["author"] == "/u/kiezer"


def test_parse_telegram():
    it = col.parse_telegram(TELEGRAM, "kanaal")[0]
    assert it["url"] == "https://t.me/kanaal/42" and it["likes"] == 12_500 and "Oekraïne" in it["text"]


def test_parse_bluesky_mastodon_gdelt():
    bsky = col.parse_bluesky({"posts": [{
        "uri": "at://did:plc:x/app.bsky.feed.post/3kabc", "author": {"handle": "kiezer.bsky.social"},
        "record": {"text": "Jetten heeft gelijk over klimaat", "createdAt": "2026-09-29T08:00:00Z", "langs": ["nl"]},
        "likeCount": 5, "repostCount": 2, "quoteCount": 1, "replyCount": 3}]})[0]
    assert bsky["url"] == "https://bsky.app/profile/kiezer.bsky.social/post/3kabc"
    assert (bsky["likes"], bsky["shares"], bsky["replies"]) == (5, 3, 3)

    masto = col.parse_mastodon([{"uri": "https://mastodon.nl/users/a/statuses/1", "url": "https://mastodon.nl/@a/1",
                                 "content": "<p>De <a>#tweedekamer</a> stemt over de begroting</p>",
                                 "created_at": "2026-09-29T07:00:00.000Z", "account": {"acct": "a"},
                                 "favourites_count": 4, "reblogs_count": 1, "replies_count": 0, "language": "nl"}],
                               "mastodon.nl")[0]
    assert masto["text"] == "De #tweedekamer stemt over de begroting" and masto["source"] == "mastodon.nl"

    gd = col.parse_gdelt({"articles": [{"url": "https://www.nu.nl/x", "title": "PVV wint in peiling",
                                        "seendate": "20260929T081500Z", "domain": "nu.nl"}]})[0]
    assert gd["source"] == "nu.nl" and gd["published_at"].startswith("2026-09-29T08:15")


def test_search_queries_cover_parties_and_issues():
    entities = load_yaml("entities.yaml")
    queries = dict(col.search_queries(entities))
    assert "Wilders" in queries["PVV"] and len(queries) == len(entities["parties"]) + len(entities["issues"])


def test_youtube_handle_resolution():
    class FakeHttp:
        def get(self, url, params=None):
            return '<meta itemprop="identifier" content="x"><script>{"channelId":"UCExcZNwh_3Mwm4fF4VSiu2w"}</script>' \
                if "@Nieuwsuur" in url else None

    assert col.resolve_youtube_channel(FakeHttp(), "UCExcZNwh_3Mwm4fF4VSiu2w") == "UCExcZNwh_3Mwm4fF4VSiu2w"
    assert col.resolve_youtube_channel(FakeHttp(), "@Nieuwsuur") == "UCExcZNwh_3Mwm4fF4VSiu2w"
    assert col.resolve_youtube_channel(FakeHttp(), "@bestaatniet") is None


def test_collect_all_survives_broken_source(monkeypatch):
    monkeypatch.setitem(col.COLLECTORS, "news", lambda cfg, **k: (_ for _ in ()).throw(RuntimeError("down")))
    monkeypatch.setitem(col.COLLECTORS, "bluesky", lambda cfg, **k: [make_item("bluesky", "Bluesky", "PVV", uid="1")])
    items, report = col.collect_all({"lookback_hours": 24}, load_yaml("entities.yaml"), only={"news", "bluesky"})
    assert report == {"news": 0, "bluesky": 1} and len(items) == 1


def test_to_iso_formats():
    assert to_iso("20260929T081500Z").startswith("2026-09-29T08:15:00")
    assert to_iso("2026-09-29T08:15:00Z") == "2026-09-29T08:15:00+00:00"
    assert to_iso("not a date") is None


# ----------------------------------------------------------------------------- pipeline & storage

def test_dedupe_prefers_rss_over_google():
    a = make_item("google_news", "NU.nl", "Kabinet valt", url="g1", title="Kabinet valt")
    b = make_item("news", "NU.nl", "Kabinet valt. Lange tekst", url="n1", title="Kabinet valt")
    kept = pipeline.dedupe([a, b, b])
    assert len(kept) == 1 and kept[0]["platform"] == "news"


def test_pipeline_run_end_to_end(tmp_path, monkeypatch):
    store = LocalStore(tmp_path / "items.parquet")
    monkeypatch.setattr(pipeline, "get_store", lambda: store)
    monkeypatch.setattr(pipeline, "collect_all", lambda *a, **k: ([
        make_item("news", "NOS", "Wilders en Yeşilgöz botsen over asiel", url="n1", title="Botsing"),
        make_item("bluesky", "Bluesky", "Geweldig plan van D66 voor woningbouw!", uid="b1"),
        make_item("reddit", "r/x", "Wie heeft er zin in pizza", uid="r1"),
    ], {"news": 1, "bluesky": 1, "reddit": 1}))
    assert pipeline.run(backend="lexicon") == 0
    df = store.load(days=7)
    assert set(df["platform"]) == {"news", "bluesky"}  # the pizza post is not political
    row = df[df["platform"] == "bluesky"].iloc[0]
    assert row["parties"] == ["D66"] and row["sentiment"] == "positive"
    # running again does not duplicate
    pipeline.run(backend="lexicon")
    assert len(store.load(days=7)) == 2


# ----------------------------------------------------------------------------- insights

@pytest.fixture(scope="module")
def demo_df():
    return ins.prepare(to_frame(make_demo_items()))


def test_demo_metrics(demo_df):
    sov = ins.share_of_voice(demo_df, "parties", by_channel=False)
    assert abs(sov["share"].sum() - 1) < 1e-9 and sov.iloc[0]["parties"] == "PVV"
    sent = ins.sentiment_table(demo_df)
    assert sent["net"].between(-100, 100).all() and (sent["ci"] > 0).all()


def test_alerts_detect_demo_spike(demo_df):
    al = ins.alerts(demo_df, "issues")
    assert "Zorg" in set(al["issues"])
    assert ins.alerts(demo_df, "parties").iloc[0]["parties"] == "CDA"


def test_agenda_gap_and_matrix(demo_df):
    gap = ins.agenda_gap(demo_df)
    assert gap.iloc[-1]["issue"] in {"Migratie & asiel", "Midden-Oosten"}
    m = ins.party_issue_matrix(demo_df, ["PVV", "D66"])
    assert list(m.index) == ["PVV", "D66"] and m.values.max() <= 1


def test_emerging_terms_and_brief(demo_df):
    em = ins.emerging_terms(demo_df)
    assert not em.empty and (em["lift"] > 0).all()
    brief = ins.executive_brief(demo_df)
    assert len(brief) >= 5 and "PVV" in brief[1]


def test_rolling_net_and_outlet_tone(demo_df):
    r = ins.rolling_net(demo_df, "parties", ["PVV", "D66"])
    assert set(r["parties"]) == {"PVV", "D66"} and r["net"].between(-100, 100).all()
    grid = ins.outlet_tone(demo_df, ["PVV", "D66"])
    assert grid.shape[1] == 2 and grid.notna().any().any()


def test_empty_frame_is_safe():
    empty = ins.prepare(to_frame([]))
    assert ins.executive_brief(empty) == []
    assert ins.alerts(empty).empty and ins.momentum(empty).empty
    assert isinstance(ins.share_of_voice(empty), pd.DataFrame)


def test_supabase_store_requests(monkeypatch):
    from monitor.storage import SupabaseStore

    calls = []

    class Resp:
        def __init__(self, status=201, data=None):
            self.status_code, self._data, self.text = status, data, ""

        def json(self):
            return self._data

    rows = [make_item("news", "NOS", f"PVV bericht {i}", url=f"u{i}") | {"parties": ["PVV"], "issues": [],
                                                                        "sentiment": "neutral", "sentiment_score": 0}
            for i in range(1200)]

    def fake_request(method, url, params=None, json=None, headers=None, timeout=None):
        calls.append((method, params, len(json) if json else 0, headers.get("Prefer")))
        if method == "GET":
            start = params["offset"]
            return Resp(200, rows[start:start + params["limit"]])
        return Resp(201)

    store = SupabaseStore("https://abc.supabase.co", "key")
    monkeypatch.setattr(store.http.session, "request", fake_request)
    assert store.upsert(rows) == 1200
    posts = [c for c in calls if c[0] == "POST"]
    assert [c[2] for c in posts] == [500, 500, 200]
    assert posts[0][1] == {"on_conflict": "id"} and "merge-duplicates" in posts[0][3]
    df = store.load(days=30)
    assert len(df) == 1200 and [c[1]["offset"] for c in calls if c[0] == "GET"] == [0, 1000]
    assert df["parties"].iloc[0] == ["PVV"]


def test_local_model_backend(monkeypatch):
    fake = lambda texts, batch_size: [[{"label": "positive", "score": 0.8}, {"label": "negative", "score": 0.1},
                                       {"label": "neutral", "score": 0.1}] for _ in texts]
    monkeypatch.setattr(nlp, "_local_pipeline", lambda model: fake)
    scores, used = nlp.score_sentiment(["a", "b"], backend="local")
    assert used == "local" and scores == [(0.7, "positive"), (0.7, "positive")]


def test_local_failure_uses_api_before_lexicon(monkeypatch):
    monkeypatch.setenv("HUGGINGFACE_API_KEY", "hf_test")
    monkeypatch.setattr(nlp, "_score_local", lambda *a: (_ for _ in ()).throw(OSError("model download failed")))
    monkeypatch.setattr(nlp, "_score_api", lambda texts, *a: [(-0.5, "negative") for _ in texts])
    scores, used = nlp.score_sentiment(["x"], backend="local")
    assert used == "api" and scores == [(-0.5, "negative")]
