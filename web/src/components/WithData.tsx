import type { ReactNode } from "react";
import { useMonitor } from "../hooks/useMonitor";
import type { MonitorData } from "../services/monitor";
import { ErrorState, PageSkeleton } from "./ui";

/** Loading and error states for every page in one place. */
export function WithData({ children }: { children: (data: MonitorData) => ReactNode }) {
  const state = useMonitor();
  if (state.status === "loading") return <PageSkeleton />;
  if (state.status === "error") return <ErrorState error={state.error} />;
  return <>{children(state.data)}</>;
}
