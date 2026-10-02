import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AttentionChart } from "../components/charts/AttentionChart";
import { Arcs } from "../components/charts/Arcs";
import { Hemicycle } from "../components/charts/Hemicycle";
import { Sparkline } from "../components/charts/Sparkline";
import { usePeriodLabel } from "../components/FilterBar";
import { Delta, HeadlineList, LayerTag, SectionHead, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { PARTIES, REF, partyById, politicianById, topicById } from "../data/reference";
import { useFilters } from "../hooks/useFilters";
import { useHeadlines } from "../hooks/useHeadlines";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { chartStart } from "../utils/filters";
import { rank } from "../utils/insights";

export const SERIES_PALETTE = ["#1b1a17", "#a6352b", "#2e5a87", "#b85c17", "#3d7a5a"];

export default function Home() {
  useTitle("");
  return <WithData>{(d) => <HomeView data={d} />}</WithData>;
}

function HomeView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const f = useFilters();
  const periodLabel = usePeriodLabel();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [seat, setSeat] = useState<string | null>(null);
  const pw = data.partialWeek;
  const topicName = (id: string) => (lang === "nl" ? topicById.get(id)?.name : topicById.get(id)?.nameEn) ?? id;

  const parties = rank(data.party, f, pw).slice(0, 6);
  const topics = rank(data.topic, f, pw);
  const people = rank(data.politician, f, pw).slice(0, 6);
  const topFive = topics.slice(0, 5);
  const latest = [...data.headlines].sort((a, b) => b.date.localeCompare(a.date))
    .filter((h, i, all) => all.findIndex((x) => x.url === h.url) === i).slice(0, 6);
  const liveLatest = useHeadlines(data, latest).slice(0, 6);
  const from = chartStart(data.weeks.length, f.period);

  const submit = (e: React.FormEvent) => { e.preventDefault(); if (q.trim()) navigate(`/zoeken?q=${encodeURIComponent(q.trim())}`); };

  return (
    <div className="page">
      <section className="hero" aria-labelledby="hero-title">
        <div>
          <h1 id="hero-title" className="display h1">
            {t("Wie en wat ", "Who and what ")}<em>{t("domineert", "dominates")}</em>{t(" het politieke nieuws?", " the political news?")}
          </h1>
          <form className="hero-search" role="search" onSubmit={submit}>
            <label htmlFor="hero-q" className="sr-only">{t("Zoek", "Search")}</label>
            <input id="hero-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Partij, politicus of onderwerp", "Party, politician or topic")} />
            <button type="submit">{t("Zoek", "Search")}</button>
          </form>
          <div className="suggest">
            {["wonen", "migratie-asiel", "zorg", "klimaat-energie"].map((id) => (
              <Link key={id} className="chip" to={`/onderwerpen/${id}`}>{topicName(id)}</Link>
            ))}
          </div>
        </div>
        <div>
          <div className="split" style={{ marginBottom: 6 }}>
            <span className="kicker">{t("Tweede Kamer nu", "House of Representatives now")}</span>
            <LayerTag layer="fact" />
          </div>
          <Hemicycle parties={PARTIES} selected={seat} onSelect={setSeat} />
          <Source sources={[REF.seatsSource, REF.cabinetSource]} method={REF.cabinet} />
        </div>
      </section>

      <section className="section" aria-labelledby="pulse">
        <SectionHead title={t(`Meest in het nieuws, ${periodLabel}`, `Most in the news, ${periodLabel}`)} aside={<LayerTag layer="data" />} />
        <div className="pulse">
          <div>
            <h3 className="h3" id="pulse">{t("Partijen", "Parties")}</h3>
            {parties.map((m) => {
              const p = partyById.get(m.id)!;
              return (
                <Link key={m.id} to={`/partijen/${m.id}`} className="mover">
                  <span className="mover-name"><span className="swatch" style={{ background: p.color, marginRight: 8 }} />{p.name}</span>
                  <Sparkline values={m.weekly.slice(from)} color={p.color} />
                  <Delta value={m.change} />
                </Link>
              );
            })}
          </div>
          <div>
            <h3 className="h3">{t("Politici", "Politicians")}</h3>
            {people.map((m) => {
              const pol = politicianById.get(m.id)!;
              const p = partyById.get(pol.partyId);
              return (
                <Link key={m.id} to={`/politici/${m.id}`} className="mover">
                  <span className="mover-name">{pol.name} <span className="xs mono muted">{p?.name}</span></span>
                  <Sparkline values={m.weekly.slice(from)} color={p?.color} />
                  <Delta value={m.change} />
                </Link>
              );
            })}
          </div>
          <div>
            <h3 className="h3">{t("Onderwerpen", "Topics")}</h3>
            {topics.slice(0, 6).map((m) => (
              <Link key={m.id} to={`/onderwerpen/${m.id}`} className="mover">
                <span className="mover-name">{topicName(m.id)}</span>
                <Sparkline values={m.weekly.slice(from)} />
                <Delta value={m.change} />
              </Link>
            ))}
          </div>
        </div>
        <Source sources={[MONITOR_SOURCE]} method={t("Percentage: verandering ten opzichte van de periode ervoor. Oudere weken zijn achteraf verzameld en dunner, dus recente stijgingen zijn deels methode.",
          "Percentage: change against the period before. Older weeks were collected afterwards and are thinner, so recent rises are partly method.")} />
      </section>

      <section className="section grid-12">
        <div className="span-8">
          <SectionHead title={t("Aandacht per week, top 5 onderwerpen", "Weekly attention, top 5 topics")} aside={<LayerTag layer="data" />} />
          <AttentionChart weeks={data.weeks.slice(from)} partialWeek={pw - from} partialDays={data.partialDays}
            title={t("Berichten per week per onderwerp", "Items per week per topic")}
            markers={data.events.filter((e) => e.kind === "election" || e.kind === "government").map((e) => ({ date: e.date, label: e.id === "tk2025" ? "TK" : e.id === "gr2026" ? "GR" : t("Kabinet", "Cabinet") }))}
            series={topFive.map((m, i) => ({ id: m.id, label: topicName(m.id), color: SERIES_PALETTE[i], values: m.weekly.slice(from) }))} />
          <div className="legend" aria-hidden="true">
            {topFive.map((m, i) => <span key={m.id} className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: SERIES_PALETTE[i] }} />{topicName(m.id)}</span>)}
          </div>
          <Source sources={[MONITOR_SOURCE]} />
        </div>
        <div className="span-4">
          <SectionHead title={t("Laatste berichten", "Latest coverage")} aside={<LayerTag layer="data" />} />
          <HeadlineList items={liveLatest} />
        </div>
      </section>

      <section className="section">
        <SectionHead title={t("Welke partij hoort bij welk onderwerp?", "Which party goes with which topic?")} aside={<LayerTag layer="data" />}>
          {t("In de gekozen periode. Beweeg over een naam.", "In the selected period. Hover a name.")}
        </SectionHead>
        <Arcs links={data.links.filter((l) => l.n >= 40)} />
        <Source sources={[MONITOR_SOURCE]} method={t("Lijndikte: berichten waarin beide genoemd worden. Samen genoemd zegt niets over standpunt.",
          "Line width: items naming both. Being mentioned together says nothing about position.")} />
      </section>
    </div>
  );
}
