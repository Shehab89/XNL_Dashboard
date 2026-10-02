import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { useLang } from "../../hooks/useLang";
import { useWidth } from "../../hooks/useWidth";
import { fmtDate, fmtInt, fmtWeek } from "../../utils/format";
import { smooth } from "../../utils/series";

export interface ChartSeries { id: string; label: string; color: string; values: number[] }

/**
 * Weekly attention lines. Lines are lightly smoothed to read as trends; the tooltip and the data table show the raw
 * weekly counts. The last week is drawn dashed when it is still running, so a half week never looks like a drop.
 * Keyboard: focus the chart and use ←/→ (Home/End) to move through the weeks.
 */
export function AttentionChart({ weeks, series, partialWeek, partialDays = 7, height = 260, title, markers = [], valueLabel }: {
  weeks: string[]; series: ChartSeries[]; partialWeek: number; partialDays?: number; height?: number; title: string;
  markers?: { date: string; label: string }[]; valueLabel?: string;
}) {
  const { lang, t } = useLang();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const descId = useId();
  const unit = valueLabel ?? t("berichten", "items");

  const m = { top: 14, right: 12, bottom: 26, left: 40 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const n = weeks.length;
  const max = useMemo(() => niceMax(Math.max(1, ...series.flatMap((s) => smooth(s.values, 1).slice(0, partialWeek)),
    ...series.flatMap((s) => s.values.slice(0, partialWeek)).map((v) => v * 0.85))), [series, partialWeek]);
  const x = (i: number) => m.left + (n > 1 ? (i / (n - 1)) * w : 0);
  const y = (v: number) => m.top + h - (v / max) * h;
  const ticks = [0, max / 2, max];
  const months = weeks.map((wk, i) => ({ wk, i })).filter(({ wk }, i) => i === 0 || wk.slice(5, 7) !== weeks[i - 1].slice(5, 7));
  const monthStep = width < 520 ? 3 : width < 800 ? 2 : 1;

  const path = (vals: number[], from: number, to: number) =>
    vals.slice(from, to + 1).map((v, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const onMove = (clientX: number, rect: DOMRect) => {
    const i = Math.round(((clientX - rect.left - m.left) / w) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent) => {
    const cur = hover ?? n - 1;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next == null) return;
    e.preventDefault();
    setHover(Math.max(0, Math.min(n - 1, next)));
  };

  const smoothed = series.map((s) => {
    const sm = smooth(s.values.slice(0, partialWeek), 1);
    return { ...s, sm: partialWeek < n ? [...sm, s.values[n - 1] * (7 / Math.max(1, partialDays))] : sm };
  });

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={width} height={height} role="img" aria-labelledby={descId} tabIndex={0} onKeyDown={onKey}
          onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setHover(null)}
          onBlur={() => setHover(null)} style={{ touchAction: "pan-y" }}
          onTouchStart={(e) => onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}>
          <title id={descId}>{title}. {t("Gebruik pijltjestoetsen om per week te lezen.", "Use the arrow keys to read week by week.")}</title>
          <g className="axis">
            {ticks.map((v) => (
              <g key={v}>
                <line x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} strokeDasharray={v ? "2 4" : undefined} />
                <text x={m.left - 6} y={y(v) + 4} textAnchor="end">{fmtInt(Math.round(v), lang)}</text>
              </g>
            ))}
            {months.filter((_, k) => k % monthStep === 0).map(({ wk, i }) => (
              <text key={wk} x={x(i)} y={height - 6} textAnchor="start">{fmtDate(wk, lang, "month")}</text>
            ))}
          </g>
          {markers.map((mk) => {
            const i = weeks.findIndex((wk, k) => mk.date >= wk && (k === n - 1 || mk.date < weeks[k + 1]));
            if (i < 0) return null;
            return (
              <g key={mk.date}>
                <line x1={x(i)} x2={x(i)} y1={m.top} y2={m.top + h} stroke="var(--red)" strokeDasharray="1 3" />
                <text x={x(i) + 4} y={m.top + 10} style={{ fill: "var(--red)" }}>{mk.label}</text>
              </g>
            );
          })}
          {smoothed.map((s) => (
            <g key={s.id}>
              <path d={path(s.sm, 0, Math.min(partialWeek, n) - 1)} fill="none" stroke={s.color} strokeWidth={series.length > 1 ? 1.75 : 2} strokeLinejoin="round" />
              {partialWeek < n && <path d={path(s.sm, partialWeek - 1, n - 1)} fill="none" stroke={s.color} strokeWidth={1.5} strokeDasharray="3 3" />}
            </g>
          ))}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + h} stroke="var(--ink)" />
              {series.map((s) => <circle key={s.id} cx={x(hover)} cy={y(s.values[hover])} r={3.5} fill={s.color} stroke="var(--paper)" />)}
            </g>
          )}
        </svg>
        {hover != null && (
          <div className="tooltip" style={{ left: Math.min(Math.max(x(hover), 80), width - 80), top: m.top + 8 }} aria-live="polite">
            <div className="t-title">{fmtWeek(weeks[hover], lang)}{hover >= partialWeek ? t(" (loopt nog)", " (in progress)") : ""}</div>
            {[...series].sort((a, b) => b.values[hover] - a.values[hover]).slice(0, 6).map((s) => (
              <div key={s.id} className="split"><span><span className="swatch" style={{ background: s.color }} /> {s.label}</span>
                <span className="t-mono">{fmtInt(s.values[hover], lang)}</span></div>
            ))}
          </div>
        )}
      </div>
      <figcaption className="chart-caption">
        {t(`Berichten per week (lijn licht afgevlakt). Gestippeld: de lopende week, doorgetrokken naar een hele week.`,
          `Items per week (line lightly smoothed). Dotted: the current week, projected to a full week.`)}
      </figcaption>
      <details className="data-table">
        <summary>{t("Toon als tabel", "Show as table")}</summary>
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">{title}</caption>
            <thead><tr><th scope="col">{t("Week", "Week")}</th>{series.map((s) => <th key={s.id} scope="col" className="num">{s.label}</th>)}</tr></thead>
            <tbody>
              {weeks.map((wk, i) => (
                <tr key={wk}><th scope="row" className="mono">{wk}</th>{series.map((s) => <td key={s.id} className="num">{s.values[i]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="xs muted">{unit}</p>
      </details>
    </figure>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((c) => c >= v) ?? v;
}

