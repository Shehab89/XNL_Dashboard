"""Analysis of each item: which parties and issues it mentions, and its sentiment.

Sentiment backends (chosen automatically, override with SENTIMENT_BACKEND=local|api|lexicon):
  * local   - runs the model on your own machine / GitHub Actions (free, needs `transformers` + `torch`)
  * api     - Hugging Face Inference API (free tier, needs HUGGINGFACE_API_KEY)
  * lexicon - built-in Dutch word list: instant, offline, less accurate. Used as the fallback.

Default model: cardiffnlp/twitter-xlm-roberta-base-sentiment (multilingual, trained on social media,
labels negative / neutral / positive). Override with SENTIMENT_MODEL.
"""

import re
from functools import lru_cache

from .common import env, load_yaml, log

DEFAULT_MODEL = "cardiffnlp/twitter-xlm-roberta-base-sentiment"
HF_API = "https://router.huggingface.co/hf-inference/models/{model}"


# --------------------------------------------------------------------------- entity & issue tagging

class Tagger:
    def __init__(self, entities=None):
        entities = entities or load_yaml("entities.yaml")
        self.parties = []
        for name, spec in entities["parties"].items():
            pats = [re.compile(rf"(?<![\w-]){re.escape(a)}(?![\w-])") for a in spec.get("exact", [])]
            pats += [re.compile(rf"(?<!\w){re.escape(a)}(?!\w)", re.I) for a in spec.get("words", [])]
            pats.append(re.compile(rf"(?<![\w-]){re.escape(name)}(?![\w-])"))
            self.parties.append((name, pats))
        self.issues = []
        for name, stems in entities["issues"].items():
            parts = []
            for stem in stems:
                whole = stem.endswith("$")
                parts.append(re.escape(stem.rstrip("$")) + (r"(?!\w)" if whole else ""))
            self.issues.append((name, re.compile(r"(?<!\w)(?:" + "|".join(parts) + ")", re.I)))
        self.colors = {name: spec.get("color", "#888888") for name, spec in entities["parties"].items()}

    def tag(self, text):
        parties = [name for name, pats in self.parties if any(p.search(text) for p in pats)]
        issues = [name for name, pat in self.issues if pat.search(text)]
        return parties, issues


# --------------------------------------------------------------------------- lexicon sentiment

POSITIVE = set("""
goed goede beter best beste mooi mooie prima geweldig fantastisch uitstekend sterk sterke succes succesvol
positief positieve winst wint winnen gewonnen steun steunt eens akkoord oplossing opgelost verbetering
verbeteren vooruitgang groei stijgt hoop hoopvol blij trots dank bedankt terecht eerlijk betrouwbaar
verstandig helder duidelijk welkom veilig veiliger gezond gezonder kans kansen samen samenwerking
bravo applaus goedkoper gelukt geslaagd respect vertrouwen belofte waargemaakt redelijk
""".split())
NEGATIVE = set("""
slecht slechte slechter slechtst fout fouten schandalig schande belachelijk waardeloos rampzalig ramp
crisis probleem problemen negatief negatieve verlies verliest verloren kritiek boos woedend woede
bang angst zorgelijk onveilig gevaarlijk gevaar leugen leugens liegt gelogen corrupt corruptie fraude
chaos mislukt faalt falen gefaald zwak zwakke oneerlijk onrecht onzin idioot dom schaamte walgelijk
duurder armoede tekort tekorten ontslag protest woest onacceptabel teleurgesteld teleurstellend
teleurstelling boete schuld schuldig nep treurig triest verraad verraden ophef rel dreiging haat
""".split())
NEGATORS = {"niet", "geen", "nooit", "nauwelijks", "niets"}
_WORD = re.compile(r"[a-zà-ÿ]+")


def lexicon_score(text):
    """Score in [-1, 1]: (positive - negative) / matched words, with simple negation handling."""
    words = _WORD.findall(text.lower())
    pos = neg = 0
    for i, w in enumerate(words):
        polarity = 1 if w in POSITIVE else -1 if w in NEGATIVE else 0
        if polarity and any(p in NEGATORS for p in words[max(0, i - 2):i]):
            polarity = -polarity
        pos += polarity > 0
        neg += polarity < 0
    total = pos + neg
    return 0.0 if total == 0 else (pos - neg) / total


def label_of(score, threshold=0.15):
    return "positive" if score > threshold else "negative" if score < -threshold else "neutral"


# --------------------------------------------------------------------------- model sentiment

def _probs_to_score(results):
    """Model output [{label, score}, ...] -> score in [-1, 1] = P(positive) - P(negative)."""
    probs = {}
    for r in results:
        label = str(r["label"]).lower()
        label = {"label_0": "negative", "label_1": "neutral", "label_2": "positive"}.get(label, label)
        probs[label] = r["score"]
    return probs.get("positive", 0.0) - probs.get("negative", 0.0), max(probs, key=probs.get)


@lru_cache(maxsize=1)
def _local_pipeline(model):
    from transformers import pipeline

    return pipeline("text-classification", model=model, tokenizer=model, top_k=None, truncation=True,
                    max_length=256)


def _score_local(texts, model):
    clf = _local_pipeline(model)
    out = clf(texts, batch_size=32)
    return [_probs_to_score(r) for r in out]


def _score_api(texts, model, token, http):
    results = []
    for i in range(0, len(texts), 16):
        batch = texts[i:i + 16]
        data = http.post_json(HF_API.format(model=model), {"inputs": batch, "options": {"wait_for_model": True}},
                              headers={"Authorization": f"Bearer {token}"})
        if not isinstance(data, list) or len(data) != len(batch):
            raise RuntimeError("Hugging Face API returned no result (quota or model loading)")
        results += [_probs_to_score(r if isinstance(r, list) else [r]) for r in data]
    return results


def choose_backend():
    wanted = (env("SENTIMENT_BACKEND") or "").lower()
    if wanted in ("local", "api", "lexicon"):
        return wanted
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401

        return "local"
    except ImportError:
        return "api" if env("HUGGINGFACE_API_KEY") else "lexicon"


def score_sentiment(texts, backend=None, http=None):
    """Return [(score, label), ...] for texts, falling back to the lexicon if a model backend fails."""
    backend = backend or choose_backend()
    model = env("SENTIMENT_MODEL", DEFAULT_MODEL)
    short = [t[:1000] for t in texts]
    try:
        if backend == "local":
            scored = _score_local(short, model)
        elif backend == "api":
            from .common import Http

            scored = _score_api(short, model, env("HUGGINGFACE_API_KEY"), http or Http(pause=0))
        else:
            scored = None
        if scored is not None:
            return [(round(float(s), 3), label_of(float(s))) for s, _ in scored], backend
    except Exception as exc:
        log.warning("Sentiment backend '%s' failed (%s: %s); using the lexicon instead.",
                    backend, type(exc).__name__, exc)
    return [(round(s, 3), label_of(s)) for s in map(lexicon_score, short)], "lexicon"


def analyse(items, tagger=None, backend=None, keep_irrelevant=False):
    """Tag parties/issues, drop items that mention neither, and add sentiment. Returns (items, backend)."""
    tagger = tagger or Tagger()
    kept = []
    for item in items:
        parties, issues = tagger.tag(f"{item.get('title') or ''} {item['text']}")
        if parties or issues or keep_irrelevant:
            kept.append({**item, "parties": parties, "issues": issues})
    if not kept:
        return [], backend or "none"
    scores, used = score_sentiment([i["text"] for i in kept], backend)
    for item, (score, label) in zip(kept, scores):
        item["sentiment_score"], item["sentiment"] = score, label
    return kept, used
