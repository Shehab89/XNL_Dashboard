import { useState } from "react";
import { Link } from "react-router-dom";
import { Breadcrumbs, Delta, LayerTag, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { topicById } from "../data/reference";
import { usePeriodLabel } from "../components/FilterBar";
import { useFilters } from "../hooks/useFilters";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { chartStart } from "../utils/filters";
import { fmtInt } from "../utils/format";
import { rank } from "../utils/insights";

export default function Topics() {
  const { t } = useLang();
  useTitle(t("Onderwerpen", "Topics"));
  return <WithData>{(d) => <TopicsView data={d} />}</WithData>;
}

function TopicsView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const f = useFilters();
  const periodLabel = usePeriodLabel();
  const [sort, setSort] = useState<"recent" | "change">("recent");
  const from = chartStart(data.weeks.length, f.period);
  const rows = rank(data.topic, f, data.partialWeek).filter((m) => topicById.has(m.id));
  if (sort === "change") rows.sort((a, b) => (b.change ?? -9) - (a.change ?? -9));
  const max = Math.max(1, ...rows.map((r) => Math.max(...r.weekly.slice(from, -1))));

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Onderwerpen", "Topics") }]} />
      <h1 className="display h1" style={{ marginBottom: 24 }}>{t("Onderwerpen", "Topics")}</h1>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div role="group" aria-label={t("Sorteren", "Sort")} className="segmented">
          {([["recent", "Nu", "Now"], ["change", "Stijgers", "Rising"]] as const).map(([k, nl, en]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{t(nl, en)}</button>
          ))}
        </div>
        <span className="row xs mono muted" style={{ gap: 10 }}>{t(`Berichten, ${periodLabel}`, `Items, ${periodLabel}`)}<LayerTag layer="data" /></span>
      </div>
      <ol className="grid-12" style={{ listStyle: "none", padding: 0, margin: 0, rowGap: 0 }}>
        {rows.map((m, i) => {
          const tp = topicById.get(m.id)!;
          return (
            <li key={m.id} className="span-4" style={{ borderTop: "1px solid var(--rule)", padding: "14px 0 22px" }}>
              <Link to={`/onderwerpen/${m.id}`} style={{ textDecoration: "none", display: "block" }}>
                <div className="split">
                  <span className="mono xs muted">{String(i + 1).padStart(2, "0")}</span>
                  <Delta value={m.change} />
                </div>
                <h2 className="h2" style={{ fontSize: "var(--fs-xl)", margin: "6px 0 2px" }}>{lang === "nl" ? tp.name : tp.nameEn}</h2>
                <p className="small muted" style={{ margin: "0 0 10px", minHeight: "2.8em" }}>{lang === "nl" ? tp.scope.nl : tp.scope.en}</p>
                <SharedScaleLine values={m.weekly.slice(from)} max={max} />
                <div className="split xs mono" style={{ marginTop: 6 }}>
                  <span>{fmtInt(m.recent, lang)} {t("berichten", "items")}</span>
                  <span className="muted">{periodLabel}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
      <Source sources={[MONITOR_SOURCE]} method={t("Een bericht kan bij meerdere onderwerpen horen. Toewijzing via trefwoorden en, voor een deel, een taalmodel.",
        "An item can belong to several topics. Assigned by keywords and, for a share, a language model.")} />
    </div>
  );
}

/** Same as a sparkline but on a shared vertical scale across all topics, so small topics look small. */
function SharedScaleLine({ values, max }: { values: number[]; max: number }) {
  const w = 360, h = 54;
  const xs = values.slice(0, -1);
  const pts = xs.map((v, i) => `${((i / (xs.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 2)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="var(--ink)" fillOpacity={0.09} />
      <polyline points={pts} fill="none" stroke="var(--ink)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} stroke="var(--rule-soft)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
