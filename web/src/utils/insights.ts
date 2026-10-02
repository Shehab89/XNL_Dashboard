import type { Coverage } from "../types";
import { inPeriod } from "./filters";

export interface Mover { id: string; recent: number; change: number | null; weekly: number[] }

/** Attention in the selected period, with the change against the period before, busiest first.
 * Only complete weeks count, so a half-finished week never looks like a collapse. */
export function rank(map: Map<string, Coverage>, f: { period: number }, partialWeek: number): Mover[] {
  return [...map.entries()]
    .map(([id, c]) => {
      const { now, change } = inPeriod(c.series.n, partialWeek, f.period);
      return { id, weekly: c.series.n, recent: now, change };
    })
    .sort((a, b) => b.recent - a.recent);
}
