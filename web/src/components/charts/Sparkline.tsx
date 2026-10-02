import { smooth } from "../../utils/series";

/** Tiny trend line. Decorative next to a number that already carries the information, so it is hidden from
 * screen readers unless a label is given. */
export function Sparkline({ values, width = 84, height = 24, color = "var(--ink)", label, partialLast = true }: {
  values: number[]; width?: number; height?: number; color?: string; label?: string; partialLast?: boolean;
}) {
  const xs = smooth(partialLast ? values.slice(0, -1) : values, 1);
  const max = Math.max(1, ...xs);
  const step = xs.length > 1 ? width / (xs.length - 1) : width;
  const pts = xs.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1]?.split(",").map(Number);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? "img" : undefined}
      aria-label={label} aria-hidden={label ? undefined : true}>
      <polyline points={`0,${height} ${pts.join(" ")} ${width},${height}`} fill={color} fillOpacity={0.08} stroke="none" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" />
      {last && <circle cx={last[0]} cy={last[1]} r={2.2} fill={color} />}
    </svg>
  );
}
