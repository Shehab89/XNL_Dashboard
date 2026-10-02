import { Link } from "react-router-dom";
import { useLang } from "../hooks/useLang";
import { fmtInt } from "../utils/format";

/** Horizontal bars with an optional reference mark (for example the average across all parties). */
export function Bars({ rows, unit, max }: {
  rows: { id: string; label: string; to?: string; value: number; ref?: number; color?: string; title?: string }[]; unit?: string; max?: number;
}) {
  const { lang } = useLang();
  const top = max ?? Math.max(1, ...rows.map((r) => Math.max(r.value, r.ref ?? 0)));
  return (
    <div role="list">
      {rows.map((r) => (
        <div key={r.id} className="hbar" role="listitem" title={r.title}>
          {r.to ? <Link to={r.to}>{r.label}</Link> : <span>{r.label}</span>}
          <div className="track" aria-hidden="true">
            <div className="fill" style={{ width: `${(100 * r.value) / top}%`, background: r.color }} />
            {r.ref != null && <div className="ref" style={{ left: `${(100 * r.ref) / top}%` }} />}
          </div>
          <span className="val">{unit === "%" ? `${Math.round(r.value)}%` : fmtInt(r.value, lang)}</span>
        </div>
      ))}
    </div>
  );
}
