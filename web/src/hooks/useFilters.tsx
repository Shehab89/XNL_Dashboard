import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Site-wide filters. Every count, ranking, chart and headline list follows them.
 * - preset: the last 4, 13 or 52 weeks, or 0 for a custom range (from/to, Mondays as ISO dates)
 * - source: "all", "news", "social" or one platform name (google_news, mastodon, ...)
 * - tone: only items the model read as positive, neutral or negative
 * - focus: only items naming one party, topic or politician ("party:pvv", "topic:wonen", "politician:rob-jetten")
 */
export type Preset = 4 | 13 | 52 | 0;
export type Tone = "all" | "pos" | "neu" | "neg";
export interface FilterState { preset: Preset; from: string | null; to: string | null; source: string; tone: Tone; focus: string | null }
export interface Filters extends FilterState {
  /** Number of weeks in the selected period. */
  period: number;
}

/** Which pages show the filter bar: overview pages get every filter, detail pages all but the focus (the page is the focus). */
export function filterMode(pathname: string): "full" | "detail" | "none" {
  if (/^\/(partijen|politici|onderwerpen)\/[^/]+/.test(pathname)) return "detail";
  return /^\/($|partijen|politici|onderwerpen|tijdlijn)/.test(pathname) ? "full" : "none";
}

export const DEFAULT_FILTERS: FilterState = { preset: 4, from: null, to: null, source: "all", tone: "all", focus: null };

interface Ctx extends Filters { set: (f: Partial<FilterState>) => void; reset: () => void; active: number }
const FilterCtx = createContext<Ctx | null>(null);
const KEY = "filters-v2";

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function initial(): FilterState {
  try {
    const f = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return {
      preset: [4, 13, 52, 0].includes(f.preset) ? f.preset : 4,
      from: isDate(f.from) ? f.from : null,
      to: isDate(f.to) ? f.to : null,
      source: typeof f.source === "string" ? f.source : "all",
      tone: ["all", "pos", "neu", "neg"].includes(f.tone) ? f.tone : "all",
      focus: typeof f.focus === "string" ? f.focus : null,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** Weeks covered by a custom range, inclusive. */
export const weeksBetween = (from: string, to: string) => Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 604_800_000) + 1);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FilterState>(initial);
  const save = (next: FilterState) => {
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage can be blocked */ }
    return next;
  };
  const set = useCallback((f: Partial<FilterState>) => setState((cur) => save({ ...cur, ...f })), []);
  const reset = useCallback(() => setState(save(DEFAULT_FILTERS)), []);
  const value = useMemo(() => {
    const custom = state.preset === 0 && state.from && state.to && state.from <= state.to;
    const period = custom ? weeksBetween(state.from!, state.to!) : state.preset || 4;
    const active = [custom || state.preset !== 4, state.source !== "all", state.tone !== "all", !!state.focus].filter(Boolean).length;
    return { ...state, preset: (custom ? 0 : state.preset || 4) as Preset, period, set, reset, active };
  }, [state, set, reset]);
  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterCtx);
  if (!ctx) throw new Error("useFilters outside FilterProvider");
  return ctx;
}
