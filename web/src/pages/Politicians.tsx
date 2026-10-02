import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkline } from "../components/charts/Sparkline";
import { Breadcrumbs, Delta, EmptyState, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { PARTIES, POLITICIANS, partyById } from "../data/reference";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { fmtInt, fold } from "../utils/format";
import { change, sum, windowSum } from "../utils/series";

export default function Politicians() {
  const { t } = useLang();
  useTitle(t("Politici", "Politicians"));
  return <WithData>{(d) => <PoliticiansView data={d} />}</WithData>;
}

function PoliticiansView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const [q, setQ] = useState("");
  const [party, setParty] = useState("");
  const pw = data.partialWeek;
  const rows = useMemo(() => POLITICIANS
    .filter((p) => (!party || p.partyId === party) && (!q || fold(p.name).includes(fold(q))))
    .map((p) => {
      const w = data.politician.get(p.id)!.weekly;
      return { p, w, recent: windowSum(w, pw, 4), year: sum(w), change: change(w, pw, 4) };
    })
    .sort((a, b) => b.recent - a.recent), [data, pw, q, party]);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Politici", "Politicians") }]} />
      <header style={{ paddingBottom: 32 }}>
        <h1 className="display h1">{t("Politici", "Politicians")}</h1>
        <p className="lede" style={{ marginTop: 14 }}>
          {t("De lijsttrekkers van 2025 en wie het nieuws over hen haalt. Gesorteerd op aandacht in de laatste vier weken.",
            "The 2025 lead candidates and how often they make the news. Sorted by attention in the last four weeks.")}
        </p>
      </header>
      <div className="row" style={{ marginBottom: 16, alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 220px", maxWidth: 320 }}>
          <label htmlFor="polq">{t("Naam", "Name")}</label>
          <input id="polq" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Bijvoorbeeld Bikker", "For example Bikker")} />
        </div>
        <div className="field" style={{ flex: "0 1 220px" }}>
          <label htmlFor="polp">{t("Partij", "Party")}</label>
          <select id="polp" className="input" value={party} onChange={(e) => setParty(e.target.value)}>
            <option value="">{t("Alle partijen", "All parties")}</option>
            {PARTIES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {rows.length ? (
        <ol className="index-list">
          {rows.map(({ p, w, recent, change: ch }, i) => {
            const pt = partyById.get(p.partyId);
            return (
              <li key={p.id}>
                <Link to={`/politici/${p.id}`} className="index-row">
                  <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="name">{p.name}</span>
                    <span className="meta" style={{ display: "block" }}><span className="swatch" style={{ background: pt?.color, marginRight: 6 }} />{pt?.name} · {p.role}</span>
                  </span>
                  <span className="hide-sm"><Sparkline values={w} color={pt?.color} width={110} /></span>
                  <span className="figure hide-sm"><Delta value={ch} /></span>
                  <span className="figure">{fmtInt(recent, lang)} <span className="muted xs">/4 {t("wk", "wk")}</span></span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : <EmptyState title={t("Niemand gevonden.", "Nobody found.")}>{t("De monitor volgt nu de lijsttrekkers van 2025. Meer Kamerleden volgen zodra de Kamerdata gekoppeld is.", "The monitor follows the 2025 lead candidates. More members follow once parliamentary data is connected.")}</EmptyState>}
      <Source sources={[MONITOR_SOURCE]} method={t("Een bericht telt mee als de volledige naam erin staat.", "An item counts when the full name appears in it.")} />
    </div>
  );
}
