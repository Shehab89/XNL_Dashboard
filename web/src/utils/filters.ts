import type { Filters } from "../hooks/useFilters";
import { sum } from "./series";

/** Weekly counts for the chosen kind of source. */
export function counts(s: { n: number[]; soc: number[] }, source: Filters["source"]): number[] {
  if (source === "social") return s.soc;
  if (source === "news") return s.n.map((v, i) => v - s.soc[i]);
  return s.n;
}

/** [start, end) of the selected period: the last `period` complete weeks. */
export const windowOf = (partialWeek: number, period: number): [number, number] => [Math.max(0, partialWeek - period), partialWeek];

/** Total in the period, and the change against the period before (null when there is no or too small a base). */
export function inPeriod(xs: number[], partialWeek: number, period: number, minBase = 20) {
  const [a, b] = windowOf(partialWeek, period);
  const now = sum(xs.slice(a, b));
  const before = a - period >= 0 ? sum(xs.slice(a - period, a)) : null;
  return { now, change: before != null && before >= minBase ? now / before - 1 : null };
}

/** Tone counts inside the period (tone covers all sources). */
export function toneIn(s: { n: number[]; pos: number[]; neg: number[] }, partialWeek: number, period: number) {
  const [a, b] = windowOf(partialWeek, period);
  return { n: sum(s.n.slice(a, b)), pos: sum(s.pos.slice(a, b)), neg: sum(s.neg.slice(a, b)) };
}

/** Weeks to draw for a period: at least a quarter, so short periods still show a trend. */
export const chartStart = (len: number, period: number) => Math.max(0, len - Math.max(period, 13) - 1);
