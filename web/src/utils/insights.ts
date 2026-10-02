import type { Filters } from "../hooks/useFilters";
import type { Coverage } from "../types";
import { counts, inPeriod } from "./filters";

export interface Mover { id: string; recent: number; change: number | null; weekly: number[] }

/** Attention in the selected period and source, with the change against the period before, busiest first.
 * Only complete weeks count, so a half-finished week never looks like a collapse. */
export function rank(map: Map<string, Coverage>, f: Pick<Filters, "period" | "source">, partialWeek: number): Mover[] {
  return [...map.entries()]
    .map(([id, c]) => {
      const weekly = counts(c.series, f.source);
      const { now, change } = inPeriod(weekly, partialWeek, f.period);
      return { id, weekly, recent: now, change };
    })
    .sort((a, b) => b.recent - a.recent);
}
