import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** Site-wide filters: how many weeks to look at and which kind of source to count. */
export type Period = 4 | 13 | 52;
export type SourceFilter = "all" | "news" | "social";
export interface Filters { period: Period; source: SourceFilter }

interface Ctx extends Filters { set: (f: Partial<Filters>) => void }
const FilterCtx = createContext<Ctx | null>(null);
const KEY = "filters";

function initial(): Filters {
  try {
    const f = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return { period: [4, 13, 52].includes(f.period) ? f.period : 4, source: ["all", "news", "social"].includes(f.source) ? f.source : "all" };
  } catch {
    return { period: 4, source: "all" };
  }
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filters>(initial);
  const set = useCallback((f: Partial<Filters>) => setFilters((cur) => {
    const next = { ...cur, ...f };
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage can be blocked */ }
    return next;
  }), []);
  const value = useMemo(() => ({ ...filters, set }), [filters, set]);
  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterCtx);
  if (!ctx) throw new Error("useFilters outside FilterProvider");
  return ctx;
}
