"""Fictional demo data so the dashboard can be explored before the first real collection.

Outlets and posts are invented (outlet names are clearly fake). The generator is seeded, so the
demo always looks the same, and it contains a few "events" (spikes) to show the alert features.
"""

import random
from datetime import datetime, timedelta, timezone

from .common import load_yaml, make_item
from .nlp import label_of

DEMO_OUTLETS = ["Demo Dagblad", "Omroep Voorbeeld", "Het Testnieuws", "Nieuwsblad Fictief", "Regio Demo Courant",
                "Actueel (demo)"]
SOCIAL = {"bluesky": ["Bluesky"], "mastodon": ["mastodon.nl", "mastodon.social"],
          "reddit": ["r/thenetherlands", "r/nederlands"], "telegram": ["t.me/demo_kanaal"]}
PLATFORM_WEIGHTS = {"news": 0.28, "google_news": 0.14, "gdelt": 0.05, "bluesky": 0.23, "mastodon": 0.12,
                    "reddit": 0.14, "telegram": 0.04}

# Base attention (relative volume) and base tone per party in the demo world.
PARTY_PROFILE = {"PVV": (1.0, -0.14), "VVD": (0.75, -0.04), "D66": (0.8, 0.06), "GL-PvdA": (0.7, -0.02),
                 "CDA": (0.55, 0.05), "JA21": (0.35, -0.06), "FvD": (0.25, -0.2), "SP": (0.25, 0.02),
                 "BBB": (0.3, -0.05), "NSC": (0.15, -0.02), "PvdD": (0.15, 0.03), "ChristenUnie": (0.12, 0.05),
                 "SGP": (0.08, 0.0), "DENK": (0.12, -0.08), "Volt": (0.12, 0.08), "50PLUS": (0.04, 0.0)}
ISSUE_WEIGHTS = {"Migratie & asiel": 1.0, "Wonen": 0.8, "Zorg": 0.55, "Economie & koopkracht": 0.6,
                 "Werk & inkomen": 0.35, "Belastingen & toeslagen": 0.35, "Klimaat & energie": 0.45,
                 "Landbouw & stikstof": 0.3, "Onderwijs": 0.3, "Veiligheid & justitie": 0.35,
                 "Defensie & Oekraïne": 0.4, "Midden-Oosten": 0.35, "Europa": 0.25,
                 "Rechtsstaat & discriminatie": 0.2, "Kabinet & formatie": 0.9}
# Where news and social media put different emphasis (the "agenda gap" chart).
SOCIAL_BOOST = {"Migratie & asiel": 1.5, "Midden-Oosten": 1.6, "Belastingen & toeslagen": 1.3,
                "Kabinet & formatie": 0.6, "Europa": 0.6, "Economie & koopkracht": 0.8}
# Demo events: (days ago, party, issue, volume multiplier, tone shift)
EVENTS = [(4, "PVV", "Migratie & asiel", 4.0, -0.2), (2, "D66", "Wonen", 3.0, 0.15),
          (9, "VVD", "Belastingen & toeslagen", 2.5, -0.25), (0, "CDA", "Zorg", 2.5, -0.2)]

ISSUE_PHRASES = {
    "Migratie & asiel": ["de asielinstroom", "de opvang in Ter Apel", "de spreidingswet", "migratie"],
    "Wonen": ["de woningnood", "de huurprijzen", "de woningbouw", "starters op de woningmarkt"],
    "Zorg": ["het eigen risico", "de wachtlijsten in de zorg", "de zorgpremie", "de huisartsenzorg"],
    "Economie & koopkracht": ["de koopkracht", "de inflatie", "de boodschappenprijzen", "de begroting"],
    "Werk & inkomen": ["het minimumloon", "de AOW", "de cao-lonen", "armoede"],
    "Belastingen & toeslagen": ["de toeslagen", "box 3", "de btw-verhoging", "de Belastingdienst"],
    "Klimaat & energie": ["het klimaatbeleid", "de energietransitie", "windparken op zee", "de CO2-heffing"],
    "Landbouw & stikstof": ["de stikstofregels", "de boeren", "de landbouw", "de uitkoopregeling"],
    "Onderwijs": ["het lerarentekort", "de studiefinanciering", "het onderwijs", "het collegegeld"],
    "Veiligheid & justitie": ["de politie", "ondermijning", "criminaliteit", "de explosies bij woningen"],
    "Defensie & Oekraïne": ["steun aan Oekraïne", "de NAVO-norm", "de defensie-uitgaven", "Rusland"],
    "Midden-Oosten": ["de situatie in Gaza", "Israël", "de humanitaire hulp aan Gaza", "Iran"],
    "Europa": ["de Europese Unie", "Brussel", "het EU-migratiepact", "de Europese begroting"],
    "Rechtsstaat & discriminatie": ["discriminatie", "de rechtsstaat", "racisme", "het demonstratierecht"],
    "Kabinet & formatie": ["het kabinet", "de coalitie", "het debat in de Tweede Kamer", "de formatie"],
}
POS = ["goed", "sterk", "terecht", "een verbetering", "hoopvol", "verstandig", "een succes"]
NEG = ["schandalig", "een ramp", "onacceptabel", "zorgelijk", "een grote fout", "chaos", "teleurstellend"]
NEWS_TEMPLATES = [
    "{party} wil ingrijpen bij {issue}: plan ligt op tafel",
    "Kamer debatteert over {issue}, {party} kritisch",
    "{party} presenteert voorstel over {issue}",
    "Analyse: wat {party} precies wil met {issue}",
    "Oppositie en {party} botsen over {issue}",
    "Nieuwe cijfers over {issue} zetten {party} onder druk",
]
SOCIAL_TEMPLATES = [
    "Wat {party} nu doet met {issue} is {tone}.",
    "Eerlijk gezegd vind ik het standpunt van {party} over {issue} {tone}",
    "{party} en {issue}... {tone}. Benieuwd naar het debat vanavond.",
    "Weer een dag met {issue} in het nieuws. {party} vindt het {tone}, ik ook.",
    "Iemand die kan uitleggen waarom {party} dit doet met {issue}? Lijkt me {tone}.",
]


def make_demo_items(days=30, per_day=140, seed=11):
    rng = random.Random(seed)
    entities = load_yaml("entities.yaml")
    parties = [p for p in PARTY_PROFILE if p in entities["parties"]]
    issues = list(ISSUE_WEIGHTS)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    items = []
    for day in range(days, -1, -1):
        date = now - timedelta(days=day)
        day_events = [e for e in EVENTS if e[0] == day]
        n = int(per_day * rng.uniform(0.8, 1.2) * (0.7 if date.weekday() >= 5 else 1.0))
        n += sum(int(per_day * 0.25 * (e[3] - 1)) for e in day_events)
        for _ in range(n):
            platform = rng.choices(list(PLATFORM_WEIGHTS), weights=list(PLATFORM_WEIGHTS.values()))[0]
            social = platform not in ("news", "google_news", "gdelt")
            event = rng.choice(day_events) if day_events and rng.random() < 0.45 else None
            if event:
                party, issue, shift = event[1], event[2], event[4]
            else:
                party = rng.choices(parties, weights=[PARTY_PROFILE[p][0] for p in parties])[0]
                w = [ISSUE_WEIGHTS[i] * (SOCIAL_BOOST.get(i, 1.0) if social else 1.0) for i in issues]
                issue, shift = rng.choices(issues, weights=w)[0], 0.0
            with_party = rng.random() < 0.85
            tone = PARTY_PROFILE[party][1] + shift + (-0.06 if social else 0.03) + rng.gauss(0, 0.4 if social else 0.25)
            tone = max(-1.0, min(1.0, tone))
            if not with_party:
                tone *= 0.5
            phrase = rng.choice(ISSUE_PHRASES[issue])
            tone_word = rng.choice(POS if tone > 0.15 else NEG if tone < -0.15 else ["opvallend", "interessant"])
            template = rng.choice(SOCIAL_TEMPLATES if social else NEWS_TEMPLATES)
            text = template.format(party=party if with_party else "het kabinet", issue=phrase, tone=tone_word)
            if social:
                source = rng.choice(SOCIAL.get(platform, [platform]))
            else:
                source = rng.choice(DEMO_OUTLETS)
            published = date - timedelta(hours=rng.randint(0, 23), minutes=rng.randint(0, 59))
            if published > datetime.now(timezone.utc):
                published = datetime.now(timezone.utc) - timedelta(minutes=rng.randint(1, 300))
            reach = int(rng.paretovariate(1.3) * 3) if social else 0
            item = make_item(platform, source, text, uid=f"demo-{len(items)}", title=None if social else text,
                             author=f"demo_user_{rng.randint(1, 400)}" if social else None,
                             published_at=published, lang="nl", likes=reach * rng.randint(1, 6),
                             shares=reach, replies=int(reach * rng.random() * 2))
            item["url"] = None
            item["parties"] = [party] if with_party else []
            extra = rng.random()
            if with_party and extra < 0.15:  # sometimes a second party is mentioned
                other = rng.choice([p for p in parties if p != party])
                item["parties"].append(other)
            item["issues"] = [issue]
            item["sentiment_score"] = round(tone, 3)
            item["sentiment"] = label_of(tone)
            items.append(item)
    return items
