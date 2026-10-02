import { Link, useParams } from "react-router-dom";
import { AttentionChart } from "../components/charts/AttentionChart";
import { ParliamentPanel } from "../components/ParliamentPanel";
import { Bars } from "../components/TopicBars";
import { Breadcrumbs, Delta, HeadlineList, LayerTag, SectionHead, Source, Stat, ToneBar } from "../components/ui";
import { WithData } from "../components/WithData";
import { POLITICIANS, REF, TOTAL_SEATS, partyById, politicianById, topicById } from "../data/reference";
import { usePeriodLabel } from "../components/FilterBar";
import { useFilters } from "../hooks/useFilters";
import { chartStart, counts, inPeriod, toneIn } from "../utils/filters";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { fmtInt } from "../utils/format";
import NotFound from "./NotFound";

export default function PartyDetail() {
  const { id = "" } = useParams();
  return <WithData>{(d) => partyById.has(id) ? <PartyView data={d} id={id} /> : <NotFound />}</WithData>;
}

function PartyView({ data, id }: { data: MonitorData; id: string }) {
  const { lang, t } = useLang();
  const p = partyById.get(id)!;
  useTitle(p.name);
  const f = useFilters();
  const periodLabel = usePeriodLabel();
  const cov = data.party.get(id)!;
  const pw = data.partialWeek;
  const weekly = counts(cov.series, f.source);
  const now = inPeriod(weekly, pw, f.period);
  const tone = toneIn(cov.series, pw, f.period);
  const from = chartStart(data.weeks.length, f.period);
  const leader = p.leaderId ? politicianById.get(p.leaderId) : undefined;
  const people = POLITICIANS.filter((x) => x.partyId === id);
  const links = data.links.filter((l) => l.party === id).sort((a, b) => b.n - a.n);
  const withTopic = links.reduce((a, l) => a + l.n, 0);
  // Reference: how all parties together divide their attention over topics.
  const allByTopic = new Map<string, number>();
  for (const l of data.links) allByTopic.set(l.topic, (allByTopic.get(l.topic) ?? 0) + l.n);
  const allTotal = [...allByTopic.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Partijen", "Parties"), to: "/partijen" }, { label: p.name }]} />
      <header className="identity">
        <div>
          <div className="party-bar" style={{ background: p.color }} />
          <div className="kicker">{t("Partij", "Party")} · {t("Tweede Kamer", "House of Representatives")}</div>
          <h1 className="display h1" style={{ marginTop: 10 }}>{p.name}</h1>
          <p className="lede" style={{ marginTop: 12 }}>{p.fullName}</p>
        </div>
        <div>
          <div className="split" style={{ marginBottom: 6 }}><span className="kicker">{t("Feiten", "Facts")}</span><LayerTag layer="fact" /></div>
          <dl className="factsheet">
            <div><dt>{t("Zetels", "Seats")}</dt><dd>{p.seats ?? "–"} {t("van", "of")} {TOTAL_SEATS}</dd></div>
            <div><dt>{t("Fractievoorzitter", "Group leader")}</dt><dd>{leader ? <Link to={`/politici/${leader.id}`}>{leader.name}</Link> : p.leader ?? "–"}</dd></div>
            <div><dt>{t("Positie", "Position")}</dt><dd>{p.coalition ? t("Coalitie (kabinet-Jetten)", "Coalition (Jetten cabinet)") : t("Oppositie", "Opposition")}</dd></div>
          </dl>
          <Source sources={[p.seatsSource, REF.cabinetSource]} />
        </div>
      </header>

      <section className="section" style={{ borderTop: 0 }}>
        <div className="stats">
          <Stat layer="data" label={t(`Berichten, ${periodLabel}`, `Items, ${periodLabel}`)} value={fmtInt(now.now, lang)} sub={<Delta value={now.change} />} />
          <Stat layer="data" label={t("Meest samen met", "Most mentioned with")} value={links[0] ? (lang === "nl" ? topicById.get(links[0].topic)?.name : topicById.get(links[0].topic)?.nameEn) : "–"} sub={links[0] ? `${fmtInt(links[0].n, lang)} ${t("berichten", "items")}` : undefined} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-8">
          <SectionHead title={t("Aandacht per week", "Weekly attention")} aside={<LayerTag layer="data" />} />
          <AttentionChart weeks={data.weeks.slice(from)} partialWeek={pw - from} partialDays={data.partialDays} title={t(`Berichten per week over ${p.name}`, `Items per week about ${p.name}`)}
            series={[{ id, label: p.name, color: p.color, values: weekly.slice(from) }]} />
          <Source sources={[MONITOR_SOURCE]} />
        </div>
        <div className="span-4">
          <SectionHead title={t("Recent", "Recent")} aside={<LayerTag layer="data" />} />
          <HeadlineList items={cov.headlines} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-7">
          <SectionHead title={t("Onderwerpen", "Topics")} aside={<LayerTag layer="data" />}>
            {t("Streepje: gemiddelde van alle partijen.", "Tick: average of all parties.")}
          </SectionHead>
          {links.length ? (
            <Bars unit="%" rows={links.slice(0, 10).map((l) => ({
              id: l.topic, label: (lang === "nl" ? topicById.get(l.topic)?.name : topicById.get(l.topic)?.nameEn) ?? l.topic, to: `/onderwerpen/${l.topic}`,
              value: (100 * l.n) / withTopic, ref: (100 * (allByTopic.get(l.topic) ?? 0)) / allTotal, color: p.color,
              title: `${fmtInt(l.n, lang)} ${t("berichten", "items")}`,
            }))} />
          ) : <p className="small muted">{t("Te weinig berichten om onderwerpen te tonen.", "Too few items to show topics.")}</p>}
          <Source sources={[MONITOR_SOURCE]} method={t("Samen genoemd zegt niets over het standpunt van de partij.", "Being mentioned together says nothing about the party's position.")} />
        </div>
        <div className="span-5">
          <SectionHead title={t(`Toon, ${periodLabel}`, `Tone, ${periodLabel}`)} aside={<LayerTag layer="analysis" />} />
          <ToneBar n={tone.n} pos={tone.pos} neg={tone.neg} label={p.name} />
          <Source sources={[MONITOR_SOURCE]} method={t("Toonlabels per bericht; nieuwskoppen klinken vaker negatief dan neutraal. Vergelijk partijen alleen onderling.",
            "Tone labels per item; headlines skew negative. Compare parties only with each other.")} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-6"><ParliamentPanel filter={{ partyId: id }} label={t(`Fractie ${p.name}`, `${p.name} group`)} /></div>
        <div className="span-6">
          <div className="panel">
            <div className="panel-head"><h3>{t("Politici", "Politicians")}</h3><LayerTag layer="fact" /></div>
            {people.length ? (
              <ul className="headlines">
                {people.map((x) => (
                  <li key={x.id}><Link to={`/politici/${x.id}`}><div className="hl-title">{x.name}</div><div className="hl-meta">{x.role}</div></Link></li>
                ))}
              </ul>
            ) : <p className="small muted">{t("Nog geen politici van deze partij in de monitor.", "No politicians from this party in the monitor yet.")}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
