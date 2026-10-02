import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../../hooks/useLang";
import { useWidth } from "../../hooks/useWidth";
import { MAJORITY, TOTAL_SEATS } from "../../data/reference";
import type { Party } from "../../types";

interface Seat { x: number; y: number; angle: number; row: number }

/** Seat positions for a 150-seat half circle: rows of increasing radius, seats spread proportionally to row length,
 * then read in angular order so each party fills a wedge. */
function layout(total: number, rows: number) {
  const r0 = 0.42, r1 = 1;
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1));
  const sumR = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.round((total * r) / sumR));
  counts[rows - 1] += total - counts.reduce((a, b) => a + b, 0);
  const seats: Seat[] = [];
  radii.forEach((r, row) => {
    const c = counts[row];
    for (let k = 0; k < c; k++) {
      const angle = Math.PI - (Math.PI * k) / (c - 1);
      seats.push({ x: Math.cos(angle) * r, y: -Math.sin(angle) * r, angle, row });
    }
  });
  seats.sort((a, b) => b.angle - a.angle || a.row - b.row);
  return { seats, seatR: (r1 - r0) / (rows - 1) / 2.35 };
}

export function Hemicycle({ parties, selected, onSelect }: {
  parties: Party[]; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const { lang, t } = useLang();
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<string | null>(null);
  const rows = width < 480 ? 7 : 8;
  const { seats, seatR } = useMemo(() => layout(TOTAL_SEATS, rows), [rows]);
  const seated = parties.filter((p) => (p.seats ?? 0) > 0);

  const groups = useMemo(() => {
    let i = 0;
    return seated.map((p) => {
      const mine = seats.slice(i, i + (p.seats ?? 0));
      i += p.seats ?? 0;
      return { party: p, seats: mine };
    });
  }, [seated, seats]);

  const W = width, R = (W / 2 - 4) / (1 + seatR), H = R + 28;
  const cx = W / 2, cy = R + 8;
  const active = hover ?? selected;
  const activeParty = active ? parties.find((p) => p.id === active) : null;
  const tip = activeParty && groups.find((g) => g.party.id === active);
  const mid = tip ? tip.seats[Math.floor(tip.seats.length / 2)] : null;

  return (
    <div className="hemicycle-wrap" ref={ref}>
      <svg width={W} height={H} className={`hemicycle${active ? " dim" : ""}`} role="group"
        aria-label={t(`Zetelverdeling Tweede Kamer, ${TOTAL_SEATS} zetels`, `Seats in the House of Representatives, ${TOTAL_SEATS} seats`)}>
        {groups.map(({ party, seats: ss }) => (
          <g key={party.id} className={`party-group${active === party.id ? " active" : ""}`} tabIndex={0} role="button"
            aria-pressed={selected === party.id}
            aria-label={`${party.name}, ${party.seats} ${t("zetels", "seats")}, ${Math.round((100 * (party.seats ?? 0)) / TOTAL_SEATS)}%`}
            onMouseEnter={() => setHover(party.id)} onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(party.id)} onBlur={() => setHover(null)}
            onClick={() => onSelect(selected === party.id ? null : party.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(selected === party.id ? null : party.id); } }}>
            {ss.map((s, k) => (
              <circle key={k} className="seat" cx={cx + s.x * R} cy={cy + s.y * R} r={seatR * R} fill={party.color} />
            ))}
          </g>
        ))}
        <line x1={cx} x2={cx} y1={cy - R - 4} y2={cy - R * 0.36} stroke="var(--ink)" strokeDasharray="2 3" aria-hidden="true" />
        <text x={cx} y={cy - 2} textAnchor="middle" className="num-xl" style={{ font: `400 ${Math.max(28, R / 6)}px var(--font-display)`, fill: "var(--ink)" }}>
          {activeParty ? activeParty.seats : TOTAL_SEATS}
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" style={{ font: "500 11px var(--font-mono)", fill: "var(--ink-3)", letterSpacing: ".06em" }}>
          {activeParty ? activeParty.name.toUpperCase() : t(`ZETELS · MEERDERHEID ${MAJORITY}`, `SEATS · MAJORITY ${MAJORITY}`)}
        </text>
      </svg>
      {activeParty && mid && hover && (
        <div className="tooltip" style={{ left: cx + mid.x * R, top: cy + mid.y * R - 6 }} role="status">
          <div className="t-title">{activeParty.fullName}</div>
          <div className="t-mono">{activeParty.seats} {t("zetels", "seats")} · {((100 * (activeParty.seats ?? 0)) / TOTAL_SEATS).toLocaleString(lang === "nl" ? "nl-NL" : "en-GB", { maximumFractionDigits: 1 })}%</div>
          {activeParty.leader && <div className="t-mono">{t("Fractievoorzitter", "Group leader")}: {activeParty.leader}</div>}
          <div className="t-mono">{activeParty.coalition ? t("Coalitie (kabinet-Jetten)", "Coalition (Jetten cabinet)") : t("Oppositie", "Opposition")}</div>
        </div>
      )}
      <div className="legend" aria-label={t("Partijen", "Parties")}>
        {seated.map((p) => (
          <button key={p.id} type="button" aria-pressed={selected === p.id} onClick={() => onSelect(selected === p.id ? null : p.id)}
            onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}>
            <span className="swatch" style={{ background: p.color }} />{p.name} <span className="mono muted">{p.seats}</span>
          </button>
        ))}
      </div>
      {activeParty && selected && (
        <p className="small" style={{ marginTop: 12 }}>
          <Link to={`/partijen/${activeParty.id}`}>{t(`Naar het profiel van ${activeParty.name}`, `Open the ${activeParty.name} profile`)} →</Link>
        </p>
      )}
    </div>
  );
}
