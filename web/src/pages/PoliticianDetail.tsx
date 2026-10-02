import { Link, useParams } from "react-router-dom";
import { AttentionChart } from "../components/charts/AttentionChart";
import { usePeriodLabel } from "../components/FilterBar";
import { Bars } from "../components/TopicBars";
import { Breadcrumbs, Delta, HeadlineList, LayerTag, SectionHead, Source, Stat, ToneBar } from "../components/ui";
import { WithData } from "../components/WithData";
import { partyById, politicianById, topicById } from "../data/reference";
import { useFilters } from "../hooks/useFilters";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { chartStart, counts, inPeriod, toneIn } from "../utils/filters";
import { fmtInt } from "../utils/format";
import NotFound from "./NotFound";

export default function PoliticianDetail() {
  const { id = "" } = useParams();
  return <WithData>{(d) => politicianById.has(id) ? <PoliticianView data={d} id={id} /> : <NotFound />}</WithData>;
}

function PoliticianView({ data, id }: { data: MonitorData; id: string }) {
  const { lang, t } = useLang();
  const f = useFilters();
  const periodLabel = usePeriodLabel();
  const pol = politicianById.get(id)!;
  useTitle(pol.name);
  const party = partyById.get(pol.partyId)!;
  const cov = data.politician.get(id)!;
  const pw = data.partialWeek;
  const weekly = counts(cov.series, f.source);
  const partyWeekly = counts(data.party.get(party.id)!.series, f.source);
  const now = inPeriod(weekly, pw, f.period);
  const tone = toneIn(cov.series, pw, f.period);
  const from = chartStart(data.weeks.length, f.period);
  const topics = data.personTopics.filter((l) => l.from === id).sort((a, b) => b.n - a.n);
  const withTopic = topics.reduce((a, l) => a + l.n, 0);
  const parties = data.personParties.filter((l) => l.from === id && l.to !== party.id).sort((a, b) => b.n - a.n);
  const topicName = (tid: string) => (lang === "nl" ? topicById.get(tid)?.name : topicById.get(tid)?.nameEn) ?? tid;

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Politici", "Politicians"), to: "/politici" }, { label: pol.name }]} />
      <header className="identity">
        <div>
          <div className="party-bar" style={{ background: party.color }} />
          <div className="kicker"><Link to={`/partijen/${party.id}`}>{party.name}</Link> · {party.coalition ? t("coalitie", "coalition") : t("oppositie", "opposition")}</div>
          <h1 className="display h1" style={{ marginTop: 10 }}>{pol.name}</h1>
          <p className="lede" style={{ marginTop: 12 }}>{pol.role}</p>
        </div>
        <div className="stats" style={{ alignContent: "start" }}>
          <Stat layer="data" label={t(`Berichten, ${periodLabel}`, `Items, ${periodLabel}`)} value={fmtInt(now.now, lang)} sub={<Delta value={now.change} />} />
          <Stat layer="data" label={t("Vooral over", "Mostly on")} value={topics[0] ? topicName(topics[0].to) : "–"}
            sub={topics[0] ? `${Math.round((100 * topics[0].n) / withTopic)}% ${t("van de onderwerpen", "of topics")}` : undefined} />
        </div>
      </header>

      <section className="section grid-12" style={{ borderTop: 0 }}>
        <div className="span-7">
          <SectionHead title={t("Onderwerpen", "Topics")} aside={<LayerTag layer="data" />} />
          {topics.length ? (
            <Bars unit="%" rows={topics.slice(0, 8).map((l) => ({ id: l.to, label: topicName(l.to), to: `/onderwerpen/${l.to}`,
              value: (100 * l.n) / withTopic, color: party.color, title: `${fmtInt(l.n, lang)} ${t("berichten", "items")}` }))} />
          ) : <p className="small muted">{t("Te weinig berichten.", "Too few items.")}</p>}
          <Source sources={[MONITOR_SOURCE]} method={t("12 maanden; aandeel van berichten met deze persoon én een onderwerp.", "12 months; share of items naming this person and a topic.")} />
        </div>
        <div className="span-5">
          <SectionHead title={t("Toon", "Tone")} aside={<LayerTag layer="analysis" />} />
          <ToneBar n={tone.n} pos={tone.pos} neg={tone.neg} label={pol.name} />
          {topics.length > 0 && (
            <table className="table" style={{ marginTop: 16 }}>
              <caption className="sr-only">{t("Toon per onderwerp", "Tone per topic")}</caption>
              <thead><tr><th scope="col">{t("Onderwerp", "Topic")}</th><th scope="col" className="num">{t("pos.", "pos.")}</th><th scope="col" className="num">{t("neg.", "neg.")}</th></tr></thead>
              <tbody>
                {topics.slice(0, 5).map((l) => (
                  <tr key={l.to}><th scope="row" style={{ fontWeight: 400 }}>{topicName(l.to)}</th>
                    <td className="num">{Math.round((100 * l.pos) / l.n)}%</td>
                    <td className="num">{Math.round((100 * l.neg) / l.n)}%</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <Source sources={[MONITOR_SOURCE]} method={t("Toon van het bericht, ingeschat door een taalmodel. Beschrijft het nieuws, niet de persoon.", "Tone of the item, estimated by a language model. Describes the news, not the person.")} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-8">
          <SectionHead title={t("Aandacht per week", "Weekly attention")} aside={<LayerTag layer="data" />} />
          <AttentionChart weeks={data.weeks.slice(from)} partialWeek={pw - from} partialDays={data.partialDays} title={t(`Berichten per week over ${pol.name}`, `Items per week about ${pol.name}`)}
            series={[{ id, label: pol.name, color: "var(--ink)", values: weekly.slice(from) }, { id: party.id, label: party.name, color: party.color, values: partyWeekly.slice(from) }]} />
          <Source sources={[MONITOR_SOURCE]} />
        </div>
        <div className="span-4">
          <SectionHead title={t("Recent", "Recent")} aside={<LayerTag layer="data" />} />
          <HeadlineList items={cov.headlines} empty={t("Geen berichten in de laatste 30 dagen.", "No items in the last 30 days.")} />
        </div>
      </section>

      {parties.length > 0 && (
        <section className="section">
          <SectionHead title={t("Vaak genoemd met", "Often mentioned with")} aside={<LayerTag layer="data" />} />
          <div className="row" style={{ gap: 6 }}>
            {parties.slice(0, 8).map((l) => {
              const p = partyById.get(l.to)!;
              return <Link key={l.to} className="chip" to={`/partijen/${l.to}`}><span className="swatch" style={{ background: p.color }} />{p.name} <span className="mono xs">{fmtInt(l.n, lang)}</span></Link>;
            })}
          </div>
        </section>
      )}
    </div>
  );
}
