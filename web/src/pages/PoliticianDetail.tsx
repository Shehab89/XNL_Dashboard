import { Link, useParams } from "react-router-dom";
import { AttentionChart } from "../components/charts/AttentionChart";
import { ParliamentPanel } from "../components/ParliamentPanel";
import { Breadcrumbs, Delta, HeadlineList, LayerTag, SectionHead, Source, Stat } from "../components/ui";
import { WithData } from "../components/WithData";
import { partyById, politicianById } from "../data/reference";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { fmtDate, fmtInt } from "../utils/format";
import { argmax, change, sum, windowSum } from "../utils/series";
import NotFound from "./NotFound";

export default function PoliticianDetail() {
  const { id = "" } = useParams();
  const pol = politicianById.get(id);
  useTitle(pol?.name ?? "");
  if (!pol) return <NotFound />;
  return <WithData>{(d) => <PoliticianView data={d} id={id} />}</WithData>;
}

function PoliticianView({ data, id }: { data: MonitorData; id: string }) {
  const { lang, t } = useLang();
  const pol = politicianById.get(id)!;
  const party = partyById.get(pol.partyId)!;
  const { weekly, headlines } = data.politician.get(id)!;
  const pw = data.partialWeek;
  const peak = argmax(weekly.slice(0, pw));
  const partyN = data.party.get(party.id)!.series.n;
  const share = windowSum(partyN, pw, 4) ? windowSum(weekly, pw, 4) / windowSum(partyN, pw, 4) : null;

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Politici", "Politicians"), to: "/politici" }, { label: pol.name }]} />
      <header className="identity">
        <div>
          <div className="party-bar" style={{ background: party.color }} />
          <div className="kicker">{t("Politicus", "Politician")} · <Link to={`/partijen/${party.id}`}>{party.name}</Link></div>
          <h1 className="display h1" style={{ marginTop: 10 }}>{pol.name}</h1>
          <p className="lede" style={{ marginTop: 12 }}>{pol.role}</p>
        </div>
        <div>
          <div className="split" style={{ marginBottom: 6 }}><span className="kicker">{t("Feiten", "Facts")}</span><LayerTag layer="fact" /></div>
          <dl className="factsheet">
            <div><dt>{t("Partij", "Party")}</dt><dd><Link to={`/partijen/${party.id}`}>{party.fullName}</Link></dd></div>
            <div><dt>{t("Rol", "Role")}</dt><dd>{pol.role}</dd></div>
            <div><dt>{t("Kamerwerk", "Parliamentary work")}</dt><dd><span className="verify">{t("Nog niet gekoppeld", "Not connected yet")}</span></dd></div>
          </dl>
          <Source sources={[pol.roleSource]} />
        </div>
      </header>

      <section className="section" style={{ borderTop: 0 }}>
        <div className="stats">
          <Stat layer="data" label={t("Berichten, 12 maanden", "Items, 12 months")} value={fmtInt(sum(weekly), lang)} />
          <Stat layer="data" label={t("Laatste 4 weken", "Last 4 weeks")} value={fmtInt(windowSum(weekly, pw, 4), lang)}
            sub={<><Delta value={change(weekly, pw, 4)} /> {t("t.o.v. 4 weken ervoor", "vs. 4 weeks before")}</>} />
          <Stat layer="data" label={t("Drukste week", "Busiest week")} value={fmtDate(data.weeks[peak], lang, "short")} sub={`${fmtInt(weekly[peak], lang)} ${t("berichten", "items")}`} />
          <Stat layer="data" label={t(`Ten opzichte van ${party.name}`, `Relative to ${party.name}`)} value={share == null ? "–" : `${Math.round(share * 100)}%`}
            sub={t("van het aantal berichten over de partij, 4 weken", "of the number of party items, 4 weeks")} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-8">
          <SectionHead title={t("Aandacht over het jaar", "Attention over the year")} aside={<LayerTag layer="data" />}>
            {t(`Vergeleken met ${party.name} als geheel (lichte lijn).`, `Compared with ${party.name} as a whole (light line).`)}
          </SectionHead>
          <AttentionChart weeks={data.weeks} partialWeek={pw} partialDays={data.partialDays} title={t(`Berichten per week over ${pol.name}`, `Items per week about ${pol.name}`)}
            series={[{ id, label: pol.name, color: "var(--ink)", values: weekly }, { id: party.id, label: party.name, color: party.color, values: partyN }]}
            markers={data.events.filter((e) => e.kind === "election").map((e) => ({ date: e.date, label: e.id === "tk2025" ? "TK" : "GR" }))} />
          <Source sources={[MONITOR_SOURCE]} />
        </div>
        <div className="span-4">
          <SectionHead title={t("Recente berichten", "Recent coverage")} aside={<LayerTag layer="data" />} />
          <HeadlineList items={headlines} empty={t("Geen berichten in de laatste 30 dagen.", "No items in the last 30 days.")} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-6"><ParliamentPanel filter={{ personId: id }} label={t(`Ingediend door ${pol.name}`, `Submitted by ${pol.name}`)} /></div>
        <div className="span-6">
          <div className="panel">
            <div className="panel-head"><h3>{t("Stemgedrag", "Voting record")}</h3><LayerTag layer="fact" /></div>
            <p className="small">{t("In de Tweede Kamer stemt de fractie meestal als geheel. Stemgedrag staat daarom bij de partij, zodra de Kamerdata gekoppeld is.",
              "In the House, groups usually vote as a whole. Voting records therefore appear on the party page once parliamentary data is connected.")}</p>
            <Link className="btn" to={`/partijen/${party.id}`}>{party.name} →</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
