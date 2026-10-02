import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkline } from "../components/charts/Sparkline";
import { usePeriodLabel } from "../components/FilterBar";
import { Breadcrumbs, Delta, EmptyState, LayerTag, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { PARTIES, REF } from "../data/reference";
import { useFilters } from "../hooks/useFilters";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { chartStart } from "../utils/filters";
import { fmtInt, fold } from "../utils/format";
import { rank } from "../utils/insights";

export default function Parties() {
  const { t } = useLang();
  useTitle(t("Partijen", "Parties"));
  return <WithData>{(d) => <PartiesView data={d} />}</WithData>;
}

function PartiesView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const f = useFilters();
  const periodLabel = usePeriodLabel();
  const [sort, setSort] = useState<"seats" | "attention" | "name">("seats");
  const [side, setSide] = useState<"all" | "coalition" | "opposition">("all");
  const [q, setQ] = useState("");
  const from = chartStart(data.weeks.length, f.period);
  const rows = useMemo(() => {
    const att = new Map(rank(data.party, f, data.partialWeek).map((m) => [m.id, m]));
    const list = PARTIES.filter((p) => (p.seats ?? 0) > 0 || att.get(p.id)!.recent > 0)
      .filter((p) => side === "all" || (side === "coalition") === p.coalition)
      .filter((p) => !q || fold(`${p.name} ${p.fullName} ${p.leader ?? ""}`).includes(fold(q)))
      .map((p) => ({ p, m: att.get(p.id)! }));
    if (sort === "attention") list.sort((a, b) => b.m.recent - a.m.recent);
    if (sort === "name") list.sort((a, b) => a.p.name.localeCompare(b.p.name, "nl"));
    return list;
  }, [data, f, q, sort, side]);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Partijen", "Parties") }]} />
      <h1 className="display h1" style={{ marginBottom: 24 }}>{t("Partijen", "Parties")}</h1>
      <div className="row" style={{ marginBottom: 16, alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 200px", maxWidth: 280 }}>
          <label htmlFor="pq">{t("Zoek", "Search")}</label>
          <input id="pq" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Partij of leider", "Party or leader")} />
        </div>
        <div role="group" aria-label={t("Kabinet", "Cabinet")} className="segmented">
          {([["all", "Alle", "All"], ["coalition", "Coalitie", "Coalition"], ["opposition", "Oppositie", "Opposition"]] as const).map(([k, nl, en]) => (
            <button key={k} type="button" aria-pressed={side === k} onClick={() => setSide(k)}>{t(nl, en)}</button>
          ))}
        </div>
        <div role="group" aria-label={t("Sorteren", "Sort")} className="segmented">
          {([["seats", "Zetels", "Seats"], ["attention", "Aandacht", "Attention"], ["name", "A–Z", "A–Z"]] as const).map(([k, nl, en]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{t(nl, en)}</button>
          ))}
        </div>
      </div>
      <div className="row xs mono muted" style={{ justifyContent: "flex-end", gap: 10, marginBottom: 6 }}>
        <span>{t(`Berichten, ${periodLabel}`, `Items, ${periodLabel}`)}</span><LayerTag layer="data" /><span>{t("Zetels", "Seats")}</span><LayerTag layer="fact" />
      </div>
      {rows.length ? (
        <ol className="index-list" aria-label={t("Partijen", "Parties")}>
          {rows.map(({ p, m }, i) => (
            <li key={p.id}>
              <Link to={`/partijen/${p.id}`} className="index-row">
                <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="name"><span className="swatch" style={{ background: p.color, marginRight: 10, verticalAlign: 3 }} />{p.name}</span>
                  <span className="meta" style={{ display: "block" }}>{p.coalition ? t("Coalitie", "Coalition") : t("Oppositie", "Opposition")}{p.leader ? ` · ${p.leader}` : ""}</span>
                </span>
                <span className="hide-sm row" style={{ gap: 10 }}>
                  <Sparkline values={m.weekly.slice(from)} color={p.color} width={110} />
                  <span className="mono xs">{fmtInt(m.recent, lang)}</span>
                </span>
                <span className="figure hide-sm"><Delta value={m.change} /></span>
                <span className="figure"><span style={{ fontSize: "1.2rem" }}>{p.seats ?? "–"}</span> <span className="muted xs">{t("zetels", "seats")}</span></span>
              </Link>
            </li>
          ))}
        </ol>
      ) : <EmptyState title={t("Geen partij gevonden.", "No party found.")} />}
      <Source sources={[REF.seatsSource, MONITOR_SOURCE]} />
    </div>
  );
}
