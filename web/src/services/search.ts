import { GLOSSARY, PARTIES, POLITICIANS, TOPICS, partyById } from "../data/reference";
import type { Lang } from "../i18n/messages";
import type { SearchKind, SearchResult } from "../types";
import { fold, slug } from "../utils/format";
import type { MonitorData } from "./monitor";

/** English and everyday words that should lead to a monitor topic. */
const SYNONYMS: Record<string, string> = {
  migration: "migratie-asiel", asylum: "migratie-asiel", immigratie: "migratie-asiel", vluchtelingen: "migratie-asiel",
  housing: "wonen", huur: "wonen", huizen: "wonen", woningnood: "wonen", woningmarkt: "wonen",
  climate: "klimaat-energie", energy: "klimaat-energie", energie: "klimaat-energie",
  healthcare: "zorg", health: "zorg", ziekenhuis: "zorg", eigen: "zorg",
  economy: "economie-koopkracht", inflatie: "economie-koopkracht", inflation: "economie-koopkracht",
  education: "onderwijs", school: "onderwijs", studenten: "onderwijs",
  defence: "defensie-oekraine", defense: "defensie-oekraine", navo: "defensie-oekraine", nato: "defensie-oekraine", ukraine: "defensie-oekraine",
  farming: "landbouw-stikstof", agriculture: "landbouw-stikstof", boeren: "landbouw-stikstof", nitrogen: "landbouw-stikstof",
  eu: "europa", europe: "europa", brussel: "europa", gaza: "midden-oosten", israel: "midden-oosten",
  cabinet: "kabinet-formatie", coalition: "kabinet-formatie", coalitie: "kabinet-formatie", regering: "kabinet-formatie",
  crime: "veiligheid-justitie", politie: "veiligheid-justitie", police: "veiligheid-justitie",
  taxes: "belastingen-toeslagen", tax: "belastingen-toeslagen", toeslagenaffaire: "belastingen-toeslagen",
  jobs: "werk-inkomen", pensioen: "werk-inkomen", pension: "werk-inkomen", discrimination: "rechtsstaat-discriminatie",
};

interface Doc { kind: SearchKind; id: string; title: string; subtitle?: string; href: string; external?: boolean; text: string; weight: number }

export function buildIndex(data: MonitorData | null, lang: Lang): Doc[] {
  const docs: Doc[] = [];
  for (const p of PARTIES) {
    docs.push({ kind: "party", id: p.id, title: p.name, subtitle: p.fullName, href: `/partijen/${p.id}`,
      text: fold(`${p.name} ${p.fullName}`), weight: 5 });
  }
  for (const pol of POLITICIANS) {
    docs.push({ kind: "politician", id: pol.id, title: pol.name, subtitle: partyById.get(pol.partyId)?.name,
      href: `/politici/${pol.id}`, text: fold(pol.name), weight: 5 });
  }
  for (const t of TOPICS) {
    docs.push({ kind: "topic", id: t.id, title: lang === "nl" ? t.name : t.nameEn, subtitle: lang === "nl" ? t.scope.nl : t.scope.en,
      href: `/onderwerpen/${t.id}`, text: fold(`${t.name} ${t.nameEn} ${t.scope.nl} ${t.scope.en}`), weight: 4 });
  }
  for (const g of GLOSSARY) {
    docs.push({ kind: "term", id: slug(g.term), title: g.term, subtitle: lang === "nl" ? g.nl : g.enText,
      href: `/politiek#${slug(g.term)}`, text: fold(`${g.term} ${g.en}`), weight: 3 });
  }
  const pages: [string, string, string][] = [
    ["/parlement", "Tweede Kamer: zetelverdeling", "House of Representatives: seats"],
    ["/tijdlijn", "Tijdlijn", "Timeline"], ["/data", "Data en methode", "Data and method"],
  ];
  for (const [href, nl, en] of pages) {
    docs.push({ kind: "page", id: href, title: lang === "nl" ? nl : en, href, text: fold(`${nl} ${en}`), weight: 2 });
  }
  if (data) {
    for (const e of data.events) {
      docs.push({ kind: "event", id: e.id, title: e.title, subtitle: e.date, href: `/tijdlijn#${e.id}`, text: fold(e.title), weight: 2 });
    }
    const seen = new Set<string>();
    for (const h of [...data.headlines, ...[...data.politician.values()].flatMap((p) => p.headlines)]) {
      if (seen.has(h.url)) continue;
      seen.add(h.url);
      docs.push({ kind: "headline", id: h.url, title: h.title, subtitle: `${h.source} · ${h.date}`, href: h.url,
        external: true, text: fold(h.title), weight: 1 });
    }
  }
  return docs;
}

/** Ranked search: whole-word and prefix matches on names beat matches inside long texts. */
export function search(index: Doc[], query: string, limit = 40): SearchResult[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const topicHint = terms.map((w) => SYNONYMS[w]).find(Boolean);
  const scored: SearchResult[] = [];
  for (const d of index) {
    let score = 0;
    const title = fold(d.title);
    if (title === q) score += 100;
    else if (title.startsWith(q)) score += 60;
    else if (new RegExp(`\\b${escape(q)}`).test(title)) score += 40;
    for (const w of terms) {
      if (new RegExp(`\\b${escape(w)}`).test(d.text)) score += 12;
      else if (d.text.includes(w)) score += 4;
      else { score = topicHint && d.kind === "topic" && d.id === topicHint ? score : -1; if (score < 0) break; }
    }
    if (topicHint && d.kind === "topic" && d.id === topicHint) score = Math.max(score, 80);
    if (score > 0) {
      scored.push({ kind: d.kind, id: d.id, title: d.title, subtitle: d.subtitle, href: d.href, external: d.external,
        score: score * d.weight });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
