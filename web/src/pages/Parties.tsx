import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkline } from "../components/charts/Sparkline";
import { Breadcrumbs, Delta, EmptyState, LayerTag, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { ELECTION_2025, PARTIES, politicianById } from "../data/reference";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { fmtInt, fold } from "../utils/format";
import { change, windowSum } from "../utils/series";

export default function Parties() {
  const { t } = useLang();
  useTitle(t("Partijen", "Parties"));
  return <WithData>{(d) => <PartiesView data={d} />}</WithData>;
}

function PartiesView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const [sort, setSort] = useState<"seats" | "attention" | "name">("seats");
  const [q, setQ] = useState("");
  const pw = data.partialWeek;
  const rows = useMemo(() => {
    const list = PARTIES.map((p) => {
      const n = data.party.get(p.id)!.series.n;
      return { p, n, recent: windowSum(n, pw, 4), change: change(n, pw, 4), year: data.party.get(p.id)!.totals.n };
    }).filter(({ p }) => !q || fold(`${p.name} ${p.fullName}`).includes(fold(q)));
    if (sort === "attention") list.sort((a, b) => b.recent - a.recent);
    if (sort === "name") list.sort((a, b) => a.p.name.localeCompare(b.p.name, "nl"));
    return list;
  }, [data, pw, q, sort]);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Partijen", "Parties") }]} />
      <header style={{ paddingBottom: 32 }}>
        <h1 className="display h1">{t("Partijen", "Parties")}</h1>
        <p className="lede" style={{ marginTop: 14 }}>
          {t("Alle partijen die in 2025 een lijst indienden en in de Kamer zitten of zaten. Zetels volgens de verkiezingsuitslag, aandacht volgens de monitor.",
            "Every party in or recently in the House. Seats according to the election result, attention according to the monitor.")}
        </p>
      </header>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div className="field" style={{ maxWidth: 320, flex: "1 1 220px" }}>
          <label htmlFor="pq">{t("Filter", "Filter")}</label>
          <input id="pq" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Naam of afkorting", "Name or abbreviation")} />
        </div>
        <div role="group" aria-label={t("Sorteren", "Sort")} className="segmented">
          {([["seats", "Zetels", "Seats"], ["attention", "Aandacht", "Attention"], ["name", "A–Z", "A–Z"]] as const).map(([k, nl, en]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{t(nl, en)}</button>
          ))}
        </div>
      </div>
      <div className="row xs mono muted" style={{ justifyContent: "flex-end", gap: 10, marginBottom: 6 }}>
        <span>{t("Zetels", "Seats")}</span><LayerTag layer="fact" /><span>{t("Aandacht", "Attention")}</span><LayerTag layer="data" />
      </div>
      {rows.length ? (
        <ol className="index-list" aria-label={t("Partijen", "Parties")}>
          {rows.map(({ p, n, recent, change: ch }, i) => (
            <li key={p.id}>
              <Link to={`/partijen/${p.id}`} className="index-row">
                <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="name"><span className="swatch" style={{ background: p.color, marginRight: 10, verticalAlign: 3 }} />{p.name}</span>
                  <span className="meta" style={{ display: "block" }}>{p.fullName}{p.leaderId ? ` · ${politicianById.get(p.leaderId)?.name}` : ""}</span>
                </span>
                <span className="hide-sm row" style={{ gap: 10 }}>
                  <Sparkline values={n} color={p.color} width={110} />
                  <span className="mono xs">{fmtInt(recent, lang)}<span className="muted"> /4 {t("wk", "wk")}</span></span>
                </span>
                <span className="figure hide-sm"><Delta value={ch} /></span>
                <span className="figure"><span style={{ fontSize: "1.2rem" }}>{p.seats ?? "–"}</span> <span className="muted xs">{t("zetels", "seats")}</span></span>
              </Link>
            </li>
          ))}
        </ol>
      ) : <EmptyState title={t("Geen partij gevonden.", "No party found.")}>{t("Probeer een afkorting, zoals VVD of PvdD.", "Try an abbreviation, such as VVD or PvdD.")}</EmptyState>}
      <Source sources={[ELECTION_2025, MONITOR_SOURCE]} method={t("Aandacht: berichten in de laatste vier volledige weken; verandering ten opzichte van de vier weken daarvoor.",
        "Attention: items in the last four complete weeks; change against the four weeks before.")} />
    </div>
  );
}
