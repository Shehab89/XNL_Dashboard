"""LLM analysis of each item: is it about Dutch politics, which parties and issues, and what is the sentiment.

Uses Google Gemini when GEMINI_API_KEY is set, otherwise Claude when ANTHROPIC_API_KEY is set. Items are sent in small batches and the
answer is constrained to a JSON schema, so every label comes from the fixed lists in config/entities.yaml
(the dashboard depends on those names). Anything the LLM cannot answer is returned as None and the caller
falls back to the local model / lexicon.

Settings (environment): GEMINI_API_KEY or ANTHROPIC_API_KEY, LLM_MODEL (default
gemini-2.5-flash, -flash-lite, flash-latest, flash-lite-latest for Gemini, claude-opus-5-5 for Claude; a comma-separated list is tried in
order), LLM_BATCH_SIZE (default 60), LLM_WORKERS (default 1 for Gemini, 4 for Claude).

Gemini's free tier allows only a small number of requests per day per model, so items are sent in large batches,
one at a time. When one model's daily quota is used up the next model in the list takes over, and when all are
used up the rest of the run uses the fallback instead of retrying.
"""

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from .common import env, log

DEFAULT_MODELS = {"gemini": "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-latest,gemini-flash-lite-latest",
                  "claude": "claude-opus-5-5"}
DEFAULT_WORKERS = {"gemini": 1, "claude": 4}


class QuotaExhausted(RuntimeError):
    """The provider's daily quota is used up: stop calling it for the rest of the run."""
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
SENTIMENTS = ["positive", "neutral", "negative"]
MAX_CHARS = 700

SYSTEM_PROMPT = """\
You are the analysis engine of a Dutch political media monitor. You receive numbered news headlines and social \
media posts (mostly Dutch, some English) and classify each one on four points.

1. relevant (true/false)
   True only when the item is about Dutch politics or public policy: Dutch parties, politicians, the cabinet, \
parliament, provincial or municipal councils, elections, or a policy debate that concerns the Netherlands. \
False for sports, entertainment, accidents, traffic, riots and crime reports with no policy angle, \
Belgian/Flemish news (Dutch-language but not about the Netherlands), foreign politics with no Dutch angle, \
business or technology news with no policy angle, adverts, lists of names, and posts where a party name or \
issue word is used in a non-political sense (e.g. "SP" as an abbreviation, "zorgen maken" meaning "to worry").

2. parties - the Dutch parties the item is substantially about. Use only names from the allowed list. A party \
counts when it, its leader or its MPs/ministers are a subject of the item; a passing mention does not. \
Return [] when no party is a real subject.

3. issues - the policy topics the item is about. Use only names from the allowed list. Pick every topic that \
is clearly discussed (usually 1, at most 3). Return [] when none fits.

4. sentiment and score - the tone of the item towards its main subject.
   positive: approving, praising, hopeful, celebrating a success or a good outcome.
   negative: critical, angry, fearful, mocking, blaming, reporting a failure, scandal or crisis in a way that \
conveys disapproval or alarm.
   neutral: factual reporting or a question without evaluative language. Plain news headlines are usually \
neutral; do not mark a headline negative only because the event it reports is bad (e.g. "Cabinet falls" is \
neutral, "Cabinet collapses in shameful chaos" is negative).
   score is a number from -1 (very negative) to 1 (very positive); 0 for neutral, and its sign must agree \
with the label. Handle negation, irony, sarcasm and Dutch idiom: "wat een geweldig beleid, weer 3 jaar \
wachten" is negative.

Rules: judge only the text you are given; do not use outside knowledge to decide the tone; return exactly one \
result per input item, with the same index; never invent party or issue names."""


def _schema(parties, issues):
    return {
        "type": "object",
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "i": {"type": "integer"},
                        "relevant": {"type": "boolean"},
                        "parties": {"type": "array", "items": {"type": "string", "enum": list(parties)}},
                        "issues": {"type": "array", "items": {"type": "string", "enum": list(issues)}},
                        "sentiment": {"type": "string", "enum": SENTIMENTS},
                        "score": {"type": "number"},
                    },
                    "required": ["i", "relevant", "parties", "issues", "sentiment", "score"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["results"],
        "additionalProperties": False,
    }


def provider():
    if env("GEMINI_API_KEY"):
        return "gemini"
    if env("ANTHROPIC_API_KEY"):
        return "claude"
    return None


def available():
    return provider() is not None


def _retry_delay(text, default):
    """Seconds Gemini asks us to wait ("retryDelay": "40s"), capped at 90."""
    match = re.search(r'"retryDelay":\s*"([\d.]+)s"', text)
    return min(90.0, float(match.group(1)) + 1) if match else default


class GeminiClient:
    """Minimal Gemini REST client returning the JSON text of one structured-output call."""

    def __init__(self, api_key, session=None):
        self.api_key, self.session = api_key, session or requests.Session()

    def generate(self, model, system, prompt, schema):
        config = {"temperature": 0, "responseMimeType": "application/json",
                  "responseJsonSchema": schema, "maxOutputTokens": 16000}
        if "2.5" in model:
            # 2.5 models think by default and the thinking counts against maxOutputTokens (run 116 hit
            # MAX_TOKENS); labelling does not need it
            config["thinkingConfig"] = {"thinkingBudget": 0}
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": config,
        }
        for attempt in range(4):
            r = self.session.post(GEMINI_URL.format(model=model), json=body, timeout=120,
                                  headers={"x-goog-api-key": self.api_key})
            if r.status_code == 429 and "PerDay" in r.text:
                raise QuotaExhausted(f"Gemini daily quota for {model} used up")
            if r.status_code == 404:  # model name not offered (any more): move on to the next model
                raise QuotaExhausted(f"Gemini model {model} is not available")
            if r.status_code not in (429, 500, 502, 503, 504) or attempt == 3:
                break
            time.sleep(_retry_delay(r.text, default=10 * (attempt + 1)))
        if r.status_code >= 400:
            raise RuntimeError(f"Gemini HTTP {r.status_code}: {r.text[:300]}")
        candidate = r.json()["candidates"][0]
        if candidate.get("finishReason") not in (None, "STOP"):
            raise RuntimeError(f"finishReason={candidate.get('finishReason')}")
        return "".join(p.get("text", "") for p in candidate["content"]["parts"])


class ClaudeClient:
    def __init__(self, api_key):
        import anthropic

        self.client = anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=120.0)

    def generate(self, model, system, prompt, schema):
        response = self.client.messages.create(
            model=model, max_tokens=8000, system=system,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": prompt}],
        )
        if response.stop_reason in ("refusal", "max_tokens"):
            raise RuntimeError(f"stop_reason={response.stop_reason}")
        return next(b.text for b in response.content if b.type == "text")


def _client():
    if provider() == "gemini":
        return GeminiClient(env("GEMINI_API_KEY"))
    return ClaudeClient(env("ANTHROPIC_API_KEY"))


def _render(batch):
    lines = []
    for n, item in enumerate(batch):
        title, text = (item.get("title") or "").strip(), (item.get("text") or "").strip()
        body = text if not title or text.startswith(title) else f"{title} - {text}"
        lines.append(f"[{n}] ({item.get('platform')}) {body[:MAX_CHARS]}")
    return "\n".join(lines)


def _normalise(result, parties, issues):
    """One validated result dict, or None when the model's answer is unusable."""
    try:
        sentiment = result["sentiment"]
        score = max(-1.0, min(1.0, float(result["score"])))
        if sentiment not in SENTIMENTS:
            return None
        # keep label and sign consistent so the dashboard never shows a positive item with a negative score
        if (sentiment == "positive" and score < 0) or (sentiment == "negative" and score > 0):
            score = -score
        if sentiment == "neutral":
            score = max(-0.15, min(0.15, score))
        return {"relevant": bool(result["relevant"]),
                "parties": [p for p in result["parties"] if p in parties],
                "issues": [i for i in result["issues"] if i in issues],
                "sentiment": sentiment, "score": round(score, 3)}
    except (KeyError, TypeError, ValueError):
        return None


def _classify_batch(client, model, batch, parties, issues):
    prompt = (f"Allowed parties: {', '.join(parties)}\nAllowed issues: {', '.join(issues)}\n\n"
              f"Classify these {len(batch)} items:\n\n{_render(batch)}")
    text = client.generate(model, SYSTEM_PROMPT, prompt, _schema(parties, issues))
    by_index = {r["i"]: r for r in json.loads(text)["results"]}
    return [_normalise(by_index.get(n), parties, issues) if n in by_index else None for n in range(len(batch))]


def classify(items, parties, issues, client=None, model=None):
    """Classify items. Returns a list parallel to `items`; an entry is None where the LLM gave no usable answer."""
    if not items:
        return []
    client = client or _client()
    models = [m.strip() for m in (model or env("LLM_MODEL") or DEFAULT_MODELS[provider() or "claude"]).split(",")
              if m.strip()]
    size = int(env("LLM_BATCH_SIZE", "60"))
    batches = [items[i:i + size] for i in range(0, len(items), size)]
    current = {"n": 0}
    lock = threading.Lock()

    def work(batch):
        while True:
            with lock:
                n = current["n"]
            if n >= len(models):
                return [None] * len(batch)
            try:
                return _classify_batch(client, models[n], batch, parties, issues)
            except QuotaExhausted as exc:
                with lock:
                    if current["n"] == n:
                        current["n"] = n + 1
                        nxt = models[n + 1] if n + 1 < len(models) else None
                        log.warning("%s; %s.", exc, f"switching to {nxt}" if nxt else
                                    "the remaining items use the fallback")
            except Exception as exc:  # one bad batch must not lose the whole run
                log.warning("LLM batch of %d failed (%s: %s); those items use the fallback.", len(batch),
                            type(exc).__name__, str(exc)[:200])
                return [None] * len(batch)

    workers = int(env("LLM_WORKERS") or DEFAULT_WORKERS.get(provider() or "claude", 1))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        out = [r for chunk in pool.map(work, batches) for r in chunk]
    log.info("LLM (%s) classified %d of %d items", ", ".join(models), sum(r is not None for r in out), len(items))
    return out
