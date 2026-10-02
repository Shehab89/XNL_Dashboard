import { useState } from "react";
import { Link } from "react-router-dom";
import { Breadcrumbs, Delta, LayerTag, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { topicById } from "../data/reference";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { fmtInt } from "../utils/format";
import { coverageEntries, rankByRecent } from "../utils/insights";

export default function Topics() {
  const { t } = useLang();
  useTitle(t("Onderwerpen", "Topics"));
  return <WithData>{(d) => <TopicsView data={d} />}</WithData>;
}

function TopicsView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const [sort, setSort] = useState<"recent" | "change" | "year">("recent");
  const rows = rankByRecent(coverageEntries(data.topic), data.partialWeek);
  if (sort === "change") rows.sort((a, b) => (b.change ?? -9) - (a.change ?? -9));
  if (sort === "year") rows.sort((a, b) => data.topic.get(b.id)!.totals.n - data.topic.get(a.id)!.totals.n);
  const max = Math.max(...rows.map((r) => Math.max(...r.weekly)));

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Onderwerpen", "Topics") }]} />
      <header style={{ paddingBottom: 32 }}>
        <h1 className="display h1">{t("Onderwerpen", "Topics")}</h1>
        <p className="lede" style={{ marginTop: 14 }}>
          {t("Vijftien vaste onderwerpen, elk met een vaste afbakening. Alle lijnen op dezelfde schaal, zodat je ze kunt vergelijken.",
            "Fifteen fixed topics, each with a fixed scope. All lines share one scale, so you can compare them.")}
        </p>
      </header>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div role="group" aria-label={t("Sorteren", "Sort")} className="segmented">
          {([["recent", "Nu", "Now"], ["change", "Stijgers", "Rising"], ["year", "Heel jaar", "Full year"]] as const).map(([k, nl, en]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{t(nl, en)}</button>
          ))}
        </div>
        <LayerTag layer="data" />
      </div>
      <ol className="grid-12" style={{ listStyle: "none", padding: 0, margin: 0, rowGap: 0 }}>
        {rows.map((m, i) => {
          const tp = topicById.get(m.id)!;
          const cov = data.topic.get(m.id)!;
          return (
            <li key={m.id} className="span-4" style={{ borderTop: "1px solid var(--rule)", padding: "14px 0 22px" }}>
              <Link to={`/onderwerpen/${m.id}`} style={{ textDecoration: "none", display: "block" }}>
                <div className="split">
                  <span className="mono xs muted">{String(i + 1).padStart(2, "0")}</span>
                  <Delta value={m.change} />
                </div>
                <h2 className="h2" style={{ fontSize: "var(--fs-xl)", margin: "6px 0 2px" }}>{lang === "nl" ? tp.name : tp.nameEn}</h2>
                <p className="small muted" style={{ margin: "0 0 10px", minHeight: "2.8em" }}>{lang === "nl" ? tp.scope.nl : tp.scope.en}</p>
                <SharedScaleLine values={m.weekly} max={max} />
                <div className="split xs mono" style={{ marginTop: 6 }}>
                  <span>{fmtInt(m.recent, lang)} {t("in 4 wk", "in 4 wk")}</span>
                  <span className="muted">{fmtInt(cov.totals.n, lang)} {t("per jaar", "per year")}</span>
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
