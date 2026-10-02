import {
  ELECTION_2025, PARTIES, POLITICIANS, TOPICS, applyReference, partyByName, politicianByName, topicByName,
  type RawReference,
} from "../data/reference";
import type { Coverage, Headline, Link, PartyTopicLink, SourceRef, TimelineEvent, Totals, WeeklySeries } from "../types";
import { sum } from "../utils/series";

/**
 * Media-monitor data service. The backend (Supabase function refresh_web_snapshot, run after every collection)
 * publishes one JSON document with all weekly aggregates and the reference facts; this service reads it live and
 * falls back to the copy bundled at build time when the backend cannot be reached.
 */

interface RawSeries { n: number[]; pos: number[]; neg: number[]; soc: number[] }
interface RawHeadline { k: "party" | "issue" | "politician"; name: string; title: string; source: string; platform: string; d: string; url: string; sentiment?: string }
export interface RawSnapshot {
  version: number;
  generated: string;
  weeks: string[];
  total: { n: number[]; soc: number[] };
  party: Record<string, RawSeries>;
  issue: Record<string, RawSeries>;
  politician: Record<string, RawSeries>;
  links: { k: "party" | "politician" | "politician-party"; a: string; b: string; n: number; pos: number; neg: number }[];
  headlines: RawHeadline[];
  peaks: { wk: string; d: string; title: string; source: string; platform: string; url: string; parties: string[]; issues: string[]; r: number }[];
  platforms: { platform: string; n: number }[];
  totals: { items: number; first_day: string; last_item: string; ai: number; sources: number; with_party: number; with_issue: number; with_politician: number };
  reference: RawReference;
}

export interface MonitorData {
  totals: Totals;
  weeks: string[];
  /** Index of the first week that is not complete yet (the running week), or weeks.length. */
  partialWeek: number;
  /** Days of the running week covered by the data (1 to 7). */
  partialDays: number;
  total: { n: number[]; soc: number[] };
  party: Map<string, Coverage>;
  topic: Map<string, Coverage>;
  politician: Map<string, Coverage>;
  /** party → topic co-mentions */
  links: PartyTopicLink[];
  /** politician → topic and politician → party co-mentions, with tone */
  personTopics: Link[];
  personParties: Link[];
  events: TimelineEvent[];
  headlines: (Headline & { entity: { kind: "party" | "topic" | "politician"; id: string } })[];
  /** "live" when read from the backend just now, "bundled" when the built-in copy was used */
  origin: "live" | "bundled";
}

export const MONITOR_SOURCE: SourceRef = {
  name: "Haagse Lens: nieuws en sociale media (Google News, nieuwssites, GDELT, Mastodon, YouTube, Reddit)",
  verification: "verified",
};

const empty = (len: number) => Array.from({ length: len }, () => 0);

const toHeadline = (h: { title: string; source: string; platform: string; d: string; url: string; sentiment?: string }): Headline =>
  ({ title: h.title, source: h.source, platform: h.platform, date: h.d, url: h.url, sentiment: h.sentiment as Headline["sentiment"] });

function coverage(weeks: string[], raw: RawSeries | undefined, headlines: Headline[]): Coverage {
  const len = weeks.length;
  const series: WeeklySeries = { weeks, n: raw?.n ?? empty(len), pos: raw?.pos ?? empty(len), neg: raw?.neg ?? empty(len), soc: raw?.soc ?? empty(len) };
  return { series, totals: { n: sum(series.n), pos: sum(series.pos), neg: sum(series.neg), social: sum(series.soc) }, headlines };
}

export function build(raw: RawSnapshot, origin: MonitorData["origin"]): MonitorData {
  applyReference(raw.reference);
  const weeks = raw.weeks;
  const idOf = { party: (n: string) => partyByName.get(n)?.id, topic: (n: string) => topicByName.get(n)?.id, politician: (n: string) => politicianByName.get(n)?.id };

  const headlines = raw.headlines.flatMap((h) => {
    const kind = h.k === "issue" ? "topic" as const : h.k;
    const id = idOf[kind](h.name);
    return id ? [{ ...toHeadline(h), entity: { kind, id } }] : [];
  });
  const hl = (kind: string, id: string) => headlines.filter((h) => h.entity.kind === kind && h.entity.id === id);

  const party = new Map(PARTIES.map((p) => [p.id, coverage(weeks, raw.party[p.name], hl("party", p.id))]));
  const topic = new Map(TOPICS.map((t) => [t.id, coverage(weeks, raw.issue[t.name], hl("topic", t.id))]));
  const politician = new Map(POLITICIANS.map((p) => [p.id, coverage(weeks, raw.politician[p.name], hl("politician", p.id))]));

  const links: PartyTopicLink[] = [], personTopics: Link[] = [], personParties: Link[] = [];
  for (const l of raw.links) {
    if (l.k === "party") {
      const p = idOf.party(l.a), t = idOf.topic(l.b);
      if (p && t) links.push({ party: p, topic: t, n: l.n });
    } else {
      const from = idOf.politician(l.a), to = l.k === "politician" ? idOf.topic(l.b) : idOf.party(l.b);
      if (from && to) (l.k === "politician" ? personTopics : personParties).push({ from, to, n: l.n, pos: l.pos, neg: l.neg });
    }
  }

  const generated = new Date(raw.generated);
  const elapsed = (generated.getTime() - new Date(weeks[weeks.length - 1]).getTime()) / 86_400_000;
  const partialWeek = elapsed < 7 ? weeks.length - 1 : weeks.length;

  return {
    totals: {
      items: raw.totals.items, firstDay: raw.totals.first_day, lastItem: raw.totals.last_item, ai: raw.totals.ai,
      sources: raw.totals.sources, withParty: raw.totals.with_party, withTopic: raw.totals.with_issue,
      withPolitician: raw.totals.with_politician, platforms: raw.platforms, generated: raw.generated,
    },
    weeks, partialWeek, partialDays: Math.min(7, Math.max(1, Math.floor(elapsed) + 1)), total: raw.total,
    party, topic, politician, links, personTopics, personParties, events: buildEvents(raw), headlines, origin,
  };
}

/** Timeline: key political moments plus the busiest weeks in the monitor, each with the headlines that defined it.
 * The busiest weeks are data, not editorial judgement: they are ranked by item count. */
function buildEvents(raw: RawSnapshot): TimelineEvent[] {
  const reference: TimelineEvent[] = [
    { id: "tk2025", date: "2025-10-29", kind: "election", title: "Tweede Kamerverkiezing",
      summary: "Verkiezing van de 150 leden van de Tweede Kamer.", parties: [], topics: ["kabinet-formatie"], sources: [ELECTION_2025], layer: "fact" },
    { id: "kabinet-jetten", date: "2026-02-23", kind: "government", title: "Kabinet-Jetten beëdigd",
      summary: "Minderheidskabinet van D66, VVD en CDA (66 zetels).", parties: ["d66", "vvd", "cda"], topics: ["kabinet-formatie"],
      sources: [{ name: "Parlement.com, Kabinetsformatie 2025-2026", url: "https://parlement.com/kabinetsformatie-2025-2026", verification: "verified" }], layer: "fact" },
    { id: "gr2026", date: "2026-03-18", kind: "election", title: "Gemeenteraadsverkiezingen",
      summary: "Verkiezing van de gemeenteraden in heel Nederland.", parties: [], topics: [],
      sources: [{ name: "Kiesraad: gemeenteraadsverkiezingen 2026", url: "https://www.kiesraad.nl/verkiezingen/gemeenteraden", verification: "verified" }], layer: "fact" },
    { id: "pro", date: "2026-06-09", kind: "parliament", title: "GroenLinks-PvdA heet voortaan PRO",
      parties: ["pro"], topics: [], sources: [{ name: "Parlement.com, 9 juni 2026", url: "https://www.parlement.com/nieuws/202606/fractie-groenlinks-pvda-heet-voortaan-pro", verification: "verified" }], layer: "fact" },
  ];
  const byWeek = new Map<string, RawSnapshot["peaks"]>();
  for (const p of raw.peaks) byWeek.set(p.wk, [...(byWeek.get(p.wk) ?? []), p]);
  const peaks: TimelineEvent[] = [...byWeek.entries()].map(([wk, items]) => {
    items.sort((a, b) => a.r - b.r);
    return {
      id: `peak-${wk}`, date: wk, kind: "media-peak", title: items[0].title,
      parties: [...new Set(items.flatMap((i) => i.parties))].map((n) => partyByName.get(n)?.id).filter(Boolean) as string[],
      topics: [...new Set(items.flatMap((i) => i.issues))].map((n) => topicByName.get(n)?.id).filter(Boolean) as string[],
      sources: items.map((i) => ({ name: i.source, url: i.url, published: i.d, verification: "verified" as const, note: i.title })),
      layer: "data",
    };
  });
  return [...reference, ...peaks].sort((a, b) => a.date.localeCompare(b.date));
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

async function fetchLive(): Promise<RawSnapshot> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("no backend configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/web_snapshot?select=data&id=eq.1`, { headers: { apikey: SUPABASE_KEY }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as { data: RawSnapshot }[];
    if (!rows[0]?.data?.weeks) throw new Error("empty snapshot");
    return rows[0].data;
  } finally {
    clearTimeout(timer);
  }
}

let cache: Promise<MonitorData> | null = null;

/** Live data from the backend, or the bundled copy when the backend is unreachable (offline, blocked, preview). */
export function loadMonitor(): Promise<MonitorData> {
  cache ??= fetchLive()
    .then((raw) => build(raw, "live"))
    .catch(() => import("../data/snapshot.json").then((m) => build(m.default as unknown as RawSnapshot, "bundled")));
  return cache;
}
