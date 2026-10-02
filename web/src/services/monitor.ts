import {
  ELECTION_2025, PARTIES, POLITICIANS, TOPICS, applyReference, partyByName, politicianByName, topicByName,
  type RawReference,
} from "../data/reference";
import type { Filters } from "../hooks/useFilters";
import type { Coverage, Headline, Link, PartyTopicLink, SourceRef, TimelineEvent, Totals, WeeklySeries } from "../types";
import { sum } from "../utils/series";

/**
 * Media-monitor data service. The backend (Supabase function refresh_web_snapshot, run after every collection)
 * publishes one JSON document with all weekly aggregates and the reference facts; this service reads it live and
 * falls back to the copy bundled at build time when the backend cannot be reached.
 */

interface RawHeadline { k: "party" | "issue" | "politician"; name: string; title: string; source: string; platform: string; d: string; url: string; sentiment?: string }
export interface RawSnapshot {
  version: number;
  generated: string;
  weeks: string[];
  /** Sparse counts: all [w, p, s, n], one [w, p, s, e, n], two [w, p, s, e1, e2, n]; s 0 neg, 1 neutral, 2 pos. */
  cube: { ents: [string, string][]; plats: { name: string; social: boolean }[]; all: number[][]; one: number[][]; two: number[][] };
  headlines: RawHeadline[];
  peaks: { wk: string; d: string; title: string; source: string; platform: string; url: string; parties: string[]; issues: string[]; r: number }[];
  platforms: { platform: string; n: number }[];
  totals: { items: number; first_day: string; last_item: string; ai: number; sources: number; with_party: number; with_issue: number; with_politician: number };
  reference: RawReference;
}

type Kind = "party" | "topic" | "politician";
export type TaggedHeadline = Headline & { entity: { kind: Kind; id: string } };

/** Everything that does not depend on the filters, decoded once. */
export interface Base {
  raw: RawSnapshot;
  /** "kind:id" per cube entity (null for a name the reference lists do not know) */
  ents: (string | null)[];
  plats: { name: string; social: boolean }[];
  weeks: string[];
  partialWeek: number;
  partialDays: number;
  totals: Totals;
  events: TimelineEvent[];
  headlines: TaggedHeadline[];
  origin: "live" | "bundled";
  /** the data with no filters applied (search index, header) */
  plain: MonitorData;
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
  /** party → topic co-mentions in the period */
  links: PartyTopicLink[];
  /** politician → topic and politician → party co-mentions in the period, with tone */
  personTopics: Link[];
  personParties: Link[];
  events: TimelineEvent[];
  headlines: TaggedHeadline[];
  /** "live" when read from the backend just now, "bundled" when the built-in copy was used */
  origin: "live" | "bundled";
  /** platforms in the data and whether they count as social media */
  plats: { name: string; social: boolean }[];
}

export const MONITOR_SOURCE: SourceRef = {
  name: "Hofvijver: nieuws en sociale media (Google News, nieuwssites, GDELT, Mastodon, YouTube, Reddit)",
  verification: "verified",
};

const empty = (len: number) => Array.from({ length: len }, () => 0);
const TONE = { neg: 0, neu: 1, pos: 2 } as const;
const SENTIMENT = ["negative", "neutral", "positive"] as const;

export function build(raw: RawSnapshot, origin: Base["origin"]): Base {
  applyReference(raw.reference);
  const weeks = raw.weeks;
  const idOf = { party: (n: string) => partyByName.get(n)?.id, topic: (n: string) => topicByName.get(n)?.id, politician: (n: string) => politicianByName.get(n)?.id };
  const kindOf = (k: string): Kind => (k === "issue" ? "topic" : k as Kind);
  const ents = raw.cube.ents.map(([k, name]) => { const id = idOf[kindOf(k)](name); return id ? `${kindOf(k)}:${id}` : null; });
  const headlines = raw.headlines.flatMap((h) => {
    const kind = kindOf(h.k), id = idOf[kind](h.name);
    return id ? [{ title: h.title, source: h.source, platform: h.platform, date: h.d, url: h.url, sentiment: h.sentiment as Headline["sentiment"], entity: { kind, id } }] : [];
  });
  const generated = new Date(raw.generated);
  const elapsed = (generated.getTime() - new Date(weeks[weeks.length - 1]).getTime()) / 86_400_000;
  const base = {
    raw, ents, plats: raw.cube.plats, weeks, origin, headlines, events: buildEvents(raw),
    partialWeek: elapsed < 7 ? weeks.length - 1 : weeks.length,
    partialDays: Math.min(7, Math.max(1, Math.floor(elapsed) + 1)),
    totals: {
      items: raw.totals.items, firstDay: raw.totals.first_day, lastItem: raw.totals.last_item, ai: raw.totals.ai,
      sources: raw.totals.sources, withParty: raw.totals.with_party, withTopic: raw.totals.with_issue,
      withPolitician: raw.totals.with_politician, platforms: raw.platforms, generated: raw.generated,
    },
  } as Base;
  base.plain = view(base, { preset: 4, from: null, to: null, source: "all", tone: "all", focus: null, period: 4 });
  return base;
}

/** Does a platform pass the source filter? */
export const sourceMatch = (source: string, p: { name: string; social: boolean }) =>
  source === "all" || (source === "social" ? p.social : source === "news" ? !p.social : p.name === source);

/**
 * The data as the filters see it: series, rankings, co-mentions and headlines recomputed from the cube.
 * With a focus entity every count is limited to items naming it (the cube's pairs make that exact).
 * A custom period ending before this week cuts the weeks there, so "the period" is always the last weeks shown.
 */
export function view(base: Base, f: Filters, allowFocus = true): MonitorData {
  const { cube } = base.raw;
  const focus = allowFocus && f.focus ? base.ents.indexOf(f.focus) : -1;
  const focused = allowFocus && !!f.focus;

  let len = base.weeks.length, partialWeek = base.partialWeek;
  if (f.preset === 0 && f.to) {
    const end = base.weeks.filter((w) => w <= f.to!).length - 1;
    if (end >= 0 && end < len - 1) { len = end + 1; partialWeek = len; }
  }
  const weeks = base.weeks.slice(0, len);
  const platOk = base.plats.map((p) => sourceMatch(f.source, p));
  const toneOk = [0, 1, 2].map((s) => f.tone === "all" || TONE[f.tone] === s);
  const ok = (w: number, p: number, s: number) => w < len && platOk[p] && toneOk[s];

  const series = new Map<number, WeeklySeries>();
  const add = (e: number, w: number, p: number, s: number, n: number) => {
    let x = series.get(e);
    if (!x) series.set(e, x = { weeks, n: empty(len), pos: empty(len), neg: empty(len), soc: empty(len) });
    x.n[w] += n;
    if (s === 2) x.pos[w] += n; else if (s === 0) x.neg[w] += n;
    if (base.plats[p].social) x.soc[w] += n;
  };
  const total = { n: empty(len), soc: empty(len) };
  const addTotal = (w: number, p: number, n: number) => { total.n[w] += n; if (base.plats[p].social) total.soc[w] += n; };

  if (!focused) {
    for (const [w, p, s, n] of cube.all) if (ok(w, p, s)) addTotal(w, p, n);
    for (const [w, p, s, e, n] of cube.one) if (ok(w, p, s)) add(e, w, p, s, n);
  } else if (focus >= 0) {
    for (const [w, p, s, e, n] of cube.one) if (e === focus && ok(w, p, s)) { addTotal(w, p, n); add(e, w, p, s, n); }
    for (const [w, p, s, a, b, n] of cube.two) if ((a === focus || b === focus) && ok(w, p, s)) add(a === focus ? b : a, w, p, s, n);
  }

  // co-mentions inside the selected period
  const a0 = Math.max(0, partialWeek - f.period);
  const pairs = new Map<string, { n: number; pos: number; neg: number }>();
  for (const [w, p, s, a, b, n] of cube.two) {
    if (w < a0 || w >= partialWeek || !ok(w, p, s)) continue;
    if (focused && a !== focus && b !== focus) continue;
    const key = `${a}|${b}`, x = pairs.get(key) ?? { n: 0, pos: 0, neg: 0 };
    x.n += n; if (s === 2) x.pos += n; else if (s === 0) x.neg += n;
    pairs.set(key, x);
  }
  const links: PartyTopicLink[] = [], personTopics: Link[] = [], personParties: Link[] = [];
  for (const [key, x] of pairs) {
    const [ea, eb] = key.split("|").map((i) => base.ents[+i]);
    if (!ea || !eb) continue;
    const [ka, ia] = ea.split(":"), [kb, ib] = eb.split(":");
    const by: Record<string, string> = { [ka]: ia, [kb]: ib };
    if (by.party && by.topic) links.push({ party: by.party, topic: by.topic, n: x.n });
    else if (by.politician && by.topic) personTopics.push({ from: by.politician, to: by.topic, ...x });
    else if (by.politician && by.party) personParties.push({ from: by.politician, to: by.party, ...x });
  }

  // headlines: the bundled ones that pass every filter
  const start = weeks[a0] ?? weeks[0], endDay = partialWeek < base.weeks.length ? base.weeks[partialWeek] : "9999";
  const platOkByName = new Map(base.plats.map((p, i) => [p.name, platOk[i]]));
  const hlOk = (h: TaggedHeadline) => (platOkByName.get(h.platform) ?? sourceMatch(f.source, { name: h.platform, social: false }))
    && toneOk[SENTIMENT.indexOf(h.sentiment ?? "neutral")] && h.date >= start && h.date < endDay;
  const headlines = base.headlines.filter((h) => hlOk(h) && (!focused || `${h.entity.kind}:${h.entity.id}` === f.focus));

  const coverageOf = (kind: Kind, id: string): Coverage => {
    const s = series.get(base.ents.indexOf(`${kind}:${id}`)) ?? { weeks, n: empty(len), pos: empty(len), neg: empty(len), soc: empty(len) };
    return {
      series: s, totals: { n: sum(s.n), pos: sum(s.pos), neg: sum(s.neg), social: sum(s.soc) },
      headlines: base.headlines.filter((h) => h.entity.kind === kind && h.entity.id === id && hlOk(h)),
    };
  };
  return {
    totals: base.totals, weeks, partialWeek, partialDays: base.partialDays, total,
    party: new Map(PARTIES.map((p) => [p.id, coverageOf("party", p.id)])),
    topic: new Map(TOPICS.map((t) => [t.id, coverageOf("topic", t.id)])),
    politician: new Map(POLITICIANS.map((p) => [p.id, coverageOf("politician", p.id)])),
    links, personTopics, personParties, events: base.events, headlines, origin: base.origin, plats: base.plats,
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

/** Newest items that pass every filter, read straight from the items table (public, read-only). Used on the live site,
 * where it replaces the bundled headline sample with exact results. */
export async function fetchHeadlines(q: { from: string; to?: string; platforms: string[]; sentiment?: string; tags: [string, string][] }): Promise<Headline[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const p = new URLSearchParams({ select: "title,source,platform,published_at,url,sentiment", order: "published_at.desc", limit: "30" });
  p.append("published_at", `gte.${q.from}`);
  if (q.to) p.append("published_at", `lt.${q.to}`);
  p.append("platform", `in.(${q.platforms.join(",")})`);
  if (q.sentiment) p.append("sentiment", `eq.${q.sentiment}`);
  p.append("title", "not.is.null");
  for (const [col, name] of q.tags) p.append(col, `cs.{"${name.replace(/"/g, "")}"}`);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/items?${p}`, { headers: { apikey: SUPABASE_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as { title: string; source: string; platform: string; published_at: string; url: string; sentiment?: string }[];
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.title) && seen.add(r.title)).slice(0, 10)
    .map((r) => ({ title: r.title, source: r.source, platform: r.platform, date: r.published_at.slice(0, 10), url: r.url, sentiment: r.sentiment as Headline["sentiment"] }));
}

let cache: Promise<Base> | null = null;

/** Live data from the backend, or the bundled copy when the backend is unreachable (offline, blocked, preview). */
export function loadMonitor(): Promise<Base> {
  cache ??= fetchLive()
    .then((raw) => build(raw, "live"))
    .catch(() => import("../data/snapshot.json").then((m) => build(m.default as unknown as RawSnapshot, "bundled")));
  return cache;
}
