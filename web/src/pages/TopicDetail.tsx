import { Link, useParams } from "react-router-dom";
import { AttentionChart } from "../components/charts/AttentionChart";
import { ParliamentPanel } from "../components/ParliamentPanel";
import { Bars } from "../components/TopicBars";
import { Breadcrumbs, Delta, HeadlineList, LayerTag, SectionHead, Source, Stat, ToneBar } from "../components/ui";
import { WithData } from "../components/WithData";
import { usePeriodLabel } from "../components/FilterBar";
import { partyById, politicianById, topicById } from "../data/reference";
import { useFilters } from "../hooks/useFilters";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { chartStart, counts, inPeriod, toneIn } from "../utils/filters";
import { fmtDate, fmtInt } from "../utils/format";
import { argmax } from "../utils/series";
import NotFound from "./NotFound";

export default function TopicDetail() {
  const { id = "" } = useParams();
  const { lang } = useLang();
  const tp = topicById.get(id);
  useTitle(tp ? (lang === "nl" ? tp.name : tp.nameEn) : "");
  return <WithData>{(d) => (d.topic.has(id) && tp ? <TopicView data={d} id={id} /> : <NotFound />)}</WithData>;
}

function TopicView({ data, id }: { data: MonitorData; id: string }) {
  const { lang, t } = useLang();
  const tp = topicById.get(id)!;
  const name = lang === "nl" ? tp.name : tp.nameEn;
  const cov = data.topic.get(id)!;
  const f = useFilters();
  const periodLabel = usePeriodLabel();
  const pw = data.partialWeek;
  const weekly = counts(cov.series, f.source);
  const now = inPeriod(weekly, pw, f.period);
  const tone = toneIn(cov.series, pw, f.period);
  const from = chartStart(data.weeks.length, f.period);
  const peak = from + argmax(weekly.slice(from, pw));
  const people = data.personTopics.filter((l) => l.to === id && politicianById.has(l.from)).sort((a, b) => b.n - a.n);
  const links = data.links.filter((l) => l.topic === id).sort((a, b) => b.n - a.n);
  const events = data.events.filter((e) => e.topics.includes(id)).slice(-5).reverse();

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Onderwerpen", "Topics"), to: "/onderwerpen" }, { label: name }]} />
      <header className="identity">
        <div>
          <div className="party-bar" style={{ background: "var(--ink)" }} />
          <div className="kicker">{t("Onderwerp", "Topic")}</div>
          <h1 className="display h1" style={{ marginTop: 10 }}>{name}</h1>
          <p className="small muted" style={{ marginTop: 12 }}>{lang === "nl" ? tp.scope.nl : tp.scope.en}</p>
        </div>
        <div className="stats" style={{ alignContent: "start" }}>
          <Stat layer="data" label={t(`Berichten, ${periodLabel}`, `Items, ${periodLabel}`)} value={fmtInt(now.now, lang)} sub={<Delta value={now.change} />} />
          <Stat layer="data" label={t("Drukste week", "Busiest week")} value={fmtDate(data.weeks[peak], lang, "short")} sub={`${fmtInt(weekly[peak], lang)} ${t("berichten", "items")}`} />
          <Stat layer="data" label={t("Meest genoemde partij", "Most mentioned party")} value={links[0] ? partyById.get(links[0].party)?.name : "–"} />
          <Stat layer="data" label={t("Meest genoemde politicus", "Most mentioned politician")} value={people[0] ? politicianById.get(people[0].from)?.name : "–"} />
        </div>
      </header>

      <section className="section grid-12">
        <div className="span-8">
          <SectionHead title={t("Aandacht per week", "Weekly attention")} aside={<LayerTag layer="data" />} />
          <AttentionChart weeks={data.weeks.slice(from)} partialWeek={pw - from} partialDays={data.partialDays} title={t(`Berichten per week over ${name}`, `Items per week about ${name}`)}
            series={[{ id, label: name, color: "var(--ink)", values: weekly.slice(from) }]}
            markers={data.events.filter((e) => e.kind === "election").map((e) => ({ date: e.date, label: e.id === "tk2025" ? "TK" : "GR" }))} />
          <Source sources={[MONITOR_SOURCE]} />
        </div>
        <div className="span-4">
          <SectionHead title={t("Recent", "Recent")} aside={<LayerTag layer="data" />} />
          <HeadlineList items={cov.headlines} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-7">
          <SectionHead title={t("Partijen in dit debat", "Parties in this debate")} aside={<LayerTag layer="data" />} />
          {links.length ? (
            <Bars rows={links.slice(0, 12).map((l) => {
              const p = partyById.get(l.party)!;
              return { id: l.party, label: p.name, to: `/partijen/${l.party}`, value: l.n, color: p.color };
            })} />
          ) : <p className="small muted">{t("Te weinig berichten met partijnamen.", "Too few items naming a party.")}</p>}
          <Source sources={[MONITOR_SOURCE]} method={t("12 maanden; berichten over dit onderwerp die de partij noemen.", "12 months; items on this topic naming the party.")} />
        </div>
        <div className="span-5">
          <SectionHead title={t("Politici in dit debat", "Politicians in this debate")} aside={<LayerTag layer="data" />} />
          {people.length ? (
            <Bars rows={people.slice(0, 8).map((l) => {
              const pol = politicianById.get(l.from)!;
              return { id: l.from, label: pol.name, to: `/politici/${l.from}`, value: l.n, color: partyById.get(pol.partyId)?.color ?? "var(--ink)" };
            })} />
          ) : <p className="small muted">{t("Te weinig berichten met namen.", "Too few items naming a politician.")}</p>}
          <SectionHead title={t("Toon", "Tone")} aside={<LayerTag layer="analysis" />} />
          <ToneBar n={tone.n} pos={tone.pos} neg={tone.neg} label={name} />
          <Source sources={[MONITOR_SOURCE]} method={t("Negatieve toon betekent vaak een probleem in het nieuws, geen oordeel over beleid.",
            "Negative tone often means a problem in the news, not a verdict on policy.")} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-6"><ParliamentPanel filter={{ topicId: id }} label={t(`Moties over ${name}`, `Motions on ${name}`)} /></div>
        <div className="span-6">
          <div className="panel">
            <div className="panel-head"><h3>{t("Op de tijdlijn", "On the timeline")}</h3><LayerTag layer="data" /></div>
            {events.length ? (
              <ul className="headlines">
                {events.map((e) => (
                  <li key={e.id}><Link to={`/tijdlijn#${e.id}`}><div className="hl-title">{e.title}</div><div className="hl-meta">{fmtWeek(e.date, lang)}</div></Link></li>
                ))}
              </ul>
            ) : <p className="small muted">{t("Dit onderwerp stond niet centraal in een van de drukste weken.", "This topic did not lead any of the busiest weeks.")}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

const fmtWeek = (iso: string, lang: "nl" | "en") => (lang === "nl" ? "week van " : "week of ") + fmtDate(iso, lang);
