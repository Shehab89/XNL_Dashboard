import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLang } from "../../hooks/useLang";
import { useWidth } from "../../hooks/useWidth";
import { partyById, topicById } from "../../data/reference";
import type { PartyTopicLink } from "../../types";
import { fmtInt } from "../../utils/format";

/**
 * "Verbanden": which parties appear in the same items as which topics. Parties on the left, topics on the right,
 * each ribbon as wide as the number of shared items. Hover or focus a name to isolate its connections.
 * Co-occurrence is data, not position: a party linked to a topic is talked about with it, not necessarily for it.
 */
export function Arcs({ links, focus, height }: { links: PartyTopicLink[]; focus?: { kind: "party" | "topic"; id: string }; height?: number }) {
  const { lang, t } = useLang();
  const navigate = useNavigate();
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<{ kind: "party" | "topic"; id: string } | null>(null);
  const active = hover ?? focus ?? null;

  const { parties, topics, max } = useMemo(() => {
    const pt = new Map<string, number>(), tt = new Map<string, number>();
    for (const l of links) { pt.set(l.party, (pt.get(l.party) ?? 0) + l.n); tt.set(l.topic, (tt.get(l.topic) ?? 0) + l.n); }
    const order = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n }));
    return { parties: order(pt), topics: order(tt), max: Math.max(1, ...links.map((l) => l.n)) };
  }, [links]);

  const narrow = width < 560;
  const rowH = narrow ? 26 : 30;
  const H = height ?? Math.max(parties.length, topics.length) * rowH + 24;
  const leftX = narrow ? 64 : 120, rightX = width - (narrow ? 120 : 190);
  const py = (i: number) => 16 + (i + 0.5) * ((H - 24) / parties.length);
  const ty = (i: number) => 16 + (i + 0.5) * ((H - 24) / topics.length);
  const pIndex = new Map(parties.map((p, i) => [p.id, i]));
  const tIndex = new Map(topics.map((p, i) => [p.id, i]));
  const isOn = (l: PartyTopicLink) => !active || (active.kind === "party" ? l.party === active.id : l.topic === active.id);
  const linked = new Set(active ? links.filter(isOn).flatMap((l) => [`p:${l.party}`, `t:${l.topic}`]) : []);

  const label = (kind: "party" | "topic", id: string) =>
    kind === "party" ? partyById.get(id)?.name ?? id : (lang === "nl" ? topicById.get(id)?.name : topicById.get(id)?.nameEn) ?? id;

  const nodeProps = (kind: "party" | "topic", id: string) => ({
    tabIndex: 0, role: "link" as const,
    onMouseEnter: () => setHover({ kind, id }), onMouseLeave: () => setHover(null),
    onFocus: () => setHover({ kind, id }), onBlur: () => setHover(null),
    onClick: () => navigate(kind === "party" ? `/partijen/${id}` : `/onderwerpen/${id}`),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") navigate(kind === "party" ? `/partijen/${id}` : `/onderwerpen/${id}`); },
  });

  const sorted = [...links].sort((a, b) => Number(isOn(a)) - Number(isOn(b)) || a.n - b.n);

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={H} className="arcs" role="group"
        aria-label={t("Verbanden tussen partijen en onderwerpen", "Connections between parties and topics")}>
        {sorted.map((l) => {
          const a = pIndex.get(l.party), b = tIndex.get(l.topic);
          if (a == null || b == null) return null;
          const y1 = py(a), y2 = ty(b), x1 = leftX + 8, x2 = rightX - 8, mx = (x1 + x2) / 2;
          const on = isOn(l);
          const color = active?.kind === "party" ? partyById.get(l.party)?.color ?? "var(--ink)" : "var(--ink)";
          return (
            <path key={l.party + l.topic} className="link" d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              stroke={on && active ? color : "var(--ink)"} strokeOpacity={on ? (active ? 0.6 : 0.16) : 0.04}
              strokeWidth={Math.max(1, Math.sqrt(l.n / max) * (narrow ? 10 : 16))}>
              <title>{`${label("party", l.party)} · ${label("topic", l.topic)}: ${fmtInt(l.n, lang)} ${t("gedeelde berichten", "shared items")}`}</title>
            </path>
          );
        })}
        {parties.map((p, i) => {
          const dim = active && !linked.has(`p:${p.id}`);
          return (
            <g key={p.id} {...nodeProps("party", p.id)} aria-label={`${label("party", p.id)}: ${fmtInt(p.n, lang)}`}>
              <rect x={leftX} y={py(i) - 7} width={6} height={14} fill={partyById.get(p.id)?.color} opacity={dim ? 0.3 : 1} />
              <text x={leftX - 8} y={py(i) + 4} textAnchor="end" className={`node-label${dim ? " dim" : ""}`}>{label("party", p.id)}</text>
            </g>
          );
        })}
        {topics.map((tp, i) => {
          const dim = active && !linked.has(`t:${tp.id}`);
          return (
            <g key={tp.id} {...nodeProps("topic", tp.id)} aria-label={`${label("topic", tp.id)}: ${fmtInt(tp.n, lang)}`}>
              <rect x={rightX - 6} y={ty(i) - 7} width={6} height={14} fill="var(--ink)" opacity={dim ? 0.3 : 1} />
              <text x={rightX + 8} y={ty(i) + 4} className={`node-label topic${dim ? " dim" : ""}`}>{label("topic", tp.id)}</text>
            </g>
          );
        })}
      </svg>
      <p className="chart-caption">
        {t("Lijndikte: aantal berichten waarin partij en onderwerp samen voorkomen (minimaal 8). Samen genoemd zegt niets over standpunt.",
          "Line width: number of items mentioning both party and topic (at least 8). Being mentioned together says nothing about position.")}
      </p>
    </div>
  );
}
