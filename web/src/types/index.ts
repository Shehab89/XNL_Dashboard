/**
 * Data models. The UI only talks to these types; services fill them from the bundled snapshot today and from live
 * APIs (Supabase, Tweede Kamer open data) later, without the components changing.
 */

/** How a piece of information was produced. Shown on every block so analysis never looks like fact. */
export type Layer = "fact" | "data" | "analysis" | "interpretation";

/** Verification state of reference data that does not come from a connected live source yet. */
export type Verification = "verified" | "unverified" | "demo";

export interface SourceRef {
  name: string;
  url?: string;
  published?: string; // ISO date
  updated?: string; // ISO date
  verification?: Verification;
  note?: string;
}

export interface WeeklySeries {
  /** Monday of each week, ISO date. */
  weeks: string[];
  /** Items per week. */
  n: number[];
  pos: number[];
  neg: number[];
  /** Items from social media (the rest is news). */
  soc: number[];
}

export interface ToneSummary {
  n: number;
  pos: number;
  neg: number;
}

export interface Headline {
  title: string;
  source: string;
  platform: string;
  date: string;
  url: string;
  sentiment?: "positive" | "neutral" | "negative";
}

export interface Party {
  id: string; // url slug
  name: string; // abbreviation as used in the Kamer
  fullName: string;
  color: string;
  seats: number | null; // current fractie size in the Tweede Kamer
  leader?: string; // fractievoorzitter
  leaderId?: string; // set when the leader is a tracked politician
  coalition: boolean;
  seatsSource: SourceRef;
}

export interface Politician {
  id: string;
  name: string;
  partyId: string;
  role: string; // factual role with its date, e.g. "Lijsttrekker, Tweede Kamerverkiezing 2025"
  roleSource: SourceRef;
}

export interface Topic {
  id: string;
  name: string; // label used by the monitor (Dutch)
  nameEn: string;
  scope: { nl: string; en: string }; // what the label covers
}

export interface Coverage {
  series: WeeklySeries;
  totals: ToneSummary & { social: number };
  headlines: Headline[];
}

export interface TimelineEvent {
  id: string;
  date: string;
  kind: "election" | "government" | "parliament" | "media-peak";
  title: string;
  summary?: string;
  parties: string[];
  topics: string[];
  sources: SourceRef[];
  layer: Layer;
}

export interface PartyTopicLink {
  party: string;
  topic: string;
  n: number;
}

/** Items mentioning both a politician and a topic (or another party), with their tone counts. */
export interface Link { from: string; to: string; n: number; pos: number; neg: number }

export interface Totals {
  items: number;
  firstDay: string;
  lastItem: string;
  ai: number;
  sources: number;
  withParty: number;
  withTopic: number;
  withPolitician: number;
  platforms: { platform: string; n: number }[];
  generated: string;
}

/** Parliamentary records (motions, votes, bills). Typed now, filled once the Tweede Kamer API is connected. */
export interface Motion {
  id: string;
  title: string;
  date: string;
  submitters: string[];
  result?: "aangenomen" | "verworpen" | "aangehouden" | "ingetrokken";
  url: string;
}

export interface ParliamentFeed<T> {
  status: "connected" | "not_connected";
  items: T[];
  source: SourceRef;
}

export type SearchKind = "party" | "politician" | "topic" | "event" | "headline" | "term" | "page";

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  external?: boolean;
  score: number;
}
