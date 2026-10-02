import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { partyById, politicianById, topicById } from "../data/reference";
import { fetchHeadlines, sourceMatch, type MonitorData } from "../services/monitor";
import type { Headline } from "../types";
import { windowOf } from "../utils/filters";
import { filterMode, useFilters } from "./useFilters";

const COLUMN = { party: "parties", topic: "issues", politician: "politicians" } as const;
const nameOf = (kind: keyof typeof COLUMN, id: string) =>
  (kind === "party" ? partyById.get(id)?.name : kind === "topic" ? topicById.get(id)?.name : politicianById.get(id)?.name);

/** Headlines for a block. On the live site they come straight from the backend with every filter applied;
 * otherwise (or while loading, or on failure) the bundled sample filtered the same way is shown. */
export function useHeadlines(data: MonitorData, fallback: Headline[], entity?: { kind: keyof typeof COLUMN; id: string }): Headline[] {
  const f = useFilters();
  const mode = filterMode(useLocation().pathname);
  const [live, setLive] = useState<{ key: string; items: Headline[] } | null>(null);
  const [a, b] = windowOf(data.partialWeek, f.period);
  const tags: [string, string][] = [];
  for (const e of [entity, mode === "full" && f.focus ? { kind: f.focus.split(":")[0] as keyof typeof COLUMN, id: f.focus.split(":")[1] } : undefined]) {
    const name = e && nameOf(e.kind, e.id);
    if (e && name) tags.push([COLUMN[e.kind], name]);
  }
  const query = {
    from: data.weeks[a], to: data.weeks[b], tags,
    platforms: data.plats.filter((p) => sourceMatch(f.source, p)).map((p) => p.name),
    sentiment: f.tone === "all" ? undefined : { pos: "positive", neu: "neutral", neg: "negative" }[f.tone],
  };
  const key = JSON.stringify(query);
  useEffect(() => {
    if (data.origin !== "live" || mode === "none") return;
    let alive = true;
    fetchHeadlines(query).then((items) => alive && setLive({ key, items }), () => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, data.origin, mode]);
  return live?.key === key ? live.items : fallback;
}
