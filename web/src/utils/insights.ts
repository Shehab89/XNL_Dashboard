import type { Coverage } from "../types";
import { change, windowSum } from "./series";

export interface Mover { id: string; recent: number; change: number | null; weekly: number[] }

/** Attention over the last `size` complete weeks, with the change against the `size` weeks before. Counting only
 * complete weeks keeps a half-finished week from looking like a collapse. */
export function rankByRecent(entries: [string, number[]][], partialWeek: number, size = 4): Mover[] {
  return entries
    .map(([id, weekly]) => ({ id, weekly, recent: windowSum(weekly, partialWeek, size), change: change(weekly, partialWeek, size) }))
    .sort((a, b) => b.recent - a.recent);
}

export const coverageEntries = (m: Map<string, Coverage>): [string, number[]][] => [...m.entries()].map(([id, c]) => [id, c.series.n]);

/** Share of the items that carry a tone label, per direction. */
export function toneShare(c: { n: number; pos: number; neg: number }) {
  return c.n ? { pos: c.pos / c.n, neg: c.neg / c.n } : { pos: 0, neg: 0 };
}
