import { useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { DEFAULT_FILTERS, filterMode, useFilters } from "../hooks/useFilters";
import { useMonitor } from "../hooks/useMonitor";
import { view, type Base, type MonitorData } from "../services/monitor";
import { ErrorState, PageSkeleton } from "./ui";

/** Loading and error states for every page in one place; hands the page the data as the filter bar on that page sees it
 * (pages without a filter bar get everything). */
export function WithData({ children }: { children: (data: MonitorData) => ReactNode }) {
  const state = useMonitor();
  if (state.status === "loading") return <PageSkeleton />;
  if (state.status === "error") return <ErrorState error={state.error} />;
  return <Filtered base={state.data}>{children}</Filtered>;
}

function Filtered({ base, children }: { base: Base; children: (data: MonitorData) => ReactNode }) {
  const f = useFilters();
  const mode = filterMode(useLocation().pathname);
  const data = useMemo(() => (mode === "none" ? view(base, { ...DEFAULT_FILTERS, period: 4 }) : view(base, f, mode === "full")), [base, f, mode]);
  return <>{children(data)}</>;
}
