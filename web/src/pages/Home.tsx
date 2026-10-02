import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AttentionChart } from "../components/charts/AttentionChart";
import { Arcs } from "../components/charts/Arcs";
import { Hemicycle } from "../components/charts/Hemicycle";
import { Sparkline } from "../components/charts/Sparkline";
import { Delta, HeadlineList, LayerTag, SectionHead, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { ELECTION_2025, PARTIES, partyById, politicianById, topicById } from "../data/reference";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { fmtDate, fmtInt, fmtWeek } from "../utils/format";
import { coverageEntries, rankByRecent } from "../utils/insights";

export const SERIES_PALETTE = ["#1b1a17", "#a6352b", "#2e5a87", "#b85c17", "#3d7a5a"];

export default function Home() {
  useTitle("");
  return <WithData>{(d) => <HomeView data={d} />}</WithData>;
}

function HomeView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [seat, setSeat] = useState<string | null>(null);
  const pw = data.partialWeek;
  const from = data.weeks[pw - 4], to = data.weeks[pw - 1];

  const parties = rankByRecent(coverageEntries(data.party), pw).slice(0, 6);
  const topics = rankByRecent(coverageEntries(data.topic), pw);
  const rising = [...topics].filter((m) => m.change != null && m.recent >= 60).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 6);
  const people = rankByRecent([...data.politician.entries()].map(([id, p]) => [id, p.weekly]), pw).slice(0, 6);
  const topFive = topics.slice(0, 5);
  const latest = [...data.headlines].sort((a, b) => b.date.localeCompare(a.date)).filter((h, i, all) => all.findIndex((x) => x.url === h.url) === i).slice(0, 6);
  const period = `${fmtDate(from, lang, "short")} – ${fmtDate(new Date(new Date(to).getTime() + 6 * 86_400_000).toISOString().slice(0, 10), lang, "short")}`;

  const submit = (e: React.FormEvent) => { e.preventDefault(); if (q.trim()) navigate(`/zoeken?q=${encodeURIComponent(q.trim())}`); };

  return (
    <div className="page">
      <section className="hero" aria-labelledby="hero-title">
        <div>
          <div className="kicker"><span className="num">№ {data.weeks.length}</span> {t("weken gevolgd", "weeks monitored")} · {fmtWeek(data.weeks[pw - 1], lang)}</div>
          <h1 id="hero-title" className="display h1" style={{ marginTop: 16 }}>
            {t("Wat speelt er in de ", "What is happening in ")}<em>{t("Nederlandse politiek", "Dutch politics")}</em>?
          </h1>
          <p className="lede" style={{ marginTop: 18 }}>
            {t("Partijen, Kamerleden en onderwerpen, gemeten aan wat er wordt gepubliceerd. Met bron bij elk getal.",
              "Parties, members and topics, measured by what is published. With a source for every number.")}
          </p>
          <form className="hero-search" role="search" onSubmit={submit}>
            <label htmlFor="hero-q" className="sr-only">{t("Zoek in de monitor", "Search the monitor")}</label>
            <input id="hero-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Zoek: wonen, Bontenbal, motie…", "Search: housing, Bontenbal, motion…")} />
            <button type="submit">{t("Zoek", "Search")}</button>
          </form>
          <div className="suggest">
            <span className="muted">{t("Of begin bij", "Or start with")}</span>
            {["wonen", "migratie-asiel", "zorg", "klimaat-energie"].map((id) => (
              <Link key={id} className="chip" to={`/onderwerpen/${id}`}>{lang === "nl" ? topicById.get(id)?.name : topicById.get(id)?.nameEn}</Link>
            ))}
          </div>
        </div>
        <div>
          <div className="split" style={{ marginBottom: 6 }}>
            <span className="kicker">{t("Tweede Kamer · 150 zetels", "House of Representatives · 150 seats")}</span>
            <LayerTag layer="fact" />
          </div>
          <Hemicycle parties={PARTIES} selected={seat} onSelect={setSeat} />
          <Source sources={[ELECTION_2025]} method={t("Volgorde naar zetelaantal, niet naar links of rechts.", "Ordered by seats, not by left or right.")} />
        </div>
      </section>

      <section className="section" aria-labelledby="pulse">
        <SectionHead kicker={t("01 · Politieke pols", "01 · Political pulse")} title={t("Waar het de afgelopen vier weken over ging", "What the last four weeks were about")}
          aside={<LayerTag layer="data" />}>
          {t(`Aantal berichten van ${period}, vergeleken met de vier weken daarvoor. Alleen volledige weken. Let op: de monitor verzamelt pas sinds kort live; oudere weken zijn achteraf opgehaald en daardoor dunner, dus een deel van de recente stijging komt door het verzamelen zelf.`,
            `Number of items from ${period}, compared with the four weeks before. Complete weeks only. Note: live collection started only recently; older weeks were fetched afterwards and are thinner, so part of the recent rise comes from the collection itself.`)}
        </SectionHead>
        <div className="pulse">
          <div>
            <h3 className="h3">{t("Meest genoemde partijen", "Most mentioned parties")}</h3>
            {parties.map((m) => {
              const p = partyById.get(m.id)!;
              return (
                <Link key={m.id} to={`/partijen/${m.id}`} className="mover">
                  <span className="mover-name"><span className="swatch" style={{ background: p.color, marginRight: 8 }} />{p.name}</span>
                  <Sparkline values={m.weekly} color={p.color} />
                  <Delta value={m.change} />
                </Link>
              );
            })}
          </div>
          <div>
            <h3 className="h3">{t("Onderwerpen in opkomst", "Rising topics")}</h3>
            {rising.map((m) => (
              <Link key={m.id} to={`/onderwerpen/${m.id}`} className="mover">
                <span className="mover-name">{lang === "nl" ? topicById.get(m.id)?.name : topicById.get(m.id)?.nameEn}</span>
                <Sparkline values={m.weekly} />
                <Delta value={m.change} />
              </Link>
            ))}
          </div>
          <div>
            <h3 className="h3">{t("Politici in het nieuws", "Politicians in the news")}</h3>
            {people.map((m) => {
              const pol = politicianById.get(m.id)!;
              const p = partyById.get(pol.partyId);
              return (
                <Link key={m.id} to={`/politici/${m.id}`} className="mover">
                  <span className="mover-name">{pol.name} <span className="xs mono muted">{p?.name}</span></span>
                  <Sparkline values={m.weekly} color={p?.color} />
                  <Delta value={m.change} />
                </Link>
              );
            })}
          </div>
        </div>
        <Source sources={[MONITOR_SOURCE]} method={t("Een bericht telt mee als de naam van de partij, persoon of een trefwoord van het onderwerp erin staat.",
          "An item counts when the name of the party or person, or a topic keyword, appears in it.")} />
      </section>

      <section className="section grid-12" aria-labelledby="attention">
        <div className="span-8">
          <SectionHead kicker={t("02 · Aandacht", "02 · Attention")} title={t("Een jaar aandacht voor de vijf grootste onderwerpen", "A year of attention for the five biggest topics")} aside={<LayerTag layer="data" />} />
          <AttentionChart weeks={data.weeks} partialWeek={pw} partialDays={data.partialDays}
            title={t("Berichten per week per onderwerp", "Items per week per topic")}
            markers={data.events.filter((e) => e.kind === "election").map((e) => ({ date: e.date, label: e.id === "tk2025" ? "TK" : "GR" }))}
            series={topFive.map((m, i) => ({ id: m.id, label: (lang === "nl" ? topicById.get(m.id)?.name : topicById.get(m.id)?.nameEn) ?? m.id,
              color: SERIES_PALETTE[i], values: data.topic.get(m.id)!.series.n }))} />
          <div className="legend" aria-hidden="true">
            {topFive.map((m, i) => <span key={m.id} className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: SERIES_PALETTE[i] }} />{lang === "nl" ? topicById.get(m.id)?.name : topicById.get(m.id)?.nameEn}</span>)}
          </div>
          <Source sources={[MONITOR_SOURCE]} method={t("TK = Tweede Kamerverkiezing 29 okt. 2025, GR = gemeenteraadsverkiezingen 18 mrt. 2026.",
            "TK = general election 29 Oct 2025, GR = municipal elections 18 Mar 2026.")} />
        </div>
        <div className="span-4">
          <SectionHead kicker={t("03 · Recent", "03 · Recent")} title={t("Laatste berichten", "Latest coverage")} aside={<LayerTag layer="data" />} />
          <HeadlineList items={latest} />
          <p className="small" style={{ marginTop: 12 }}><Link to="/tijdlijn">{t("Naar de tijdlijn", "Go to the timeline")} →</Link></p>
        </div>
      </section>

      <section className="section" aria-labelledby="links">
        <SectionHead kicker={t("04 · Verbanden", "04 · Connections")} title={t("Welke partijen worden met welke onderwerpen genoemd?", "Which parties are mentioned with which topics?")} aside={<LayerTag layer="data" />}>
          {t("Een jaar berichtgeving. Beweeg over een naam om alleen die verbanden te zien; klik om verder te lezen.",
            "One year of coverage. Hover a name to isolate its connections; click to read on.")}
        </SectionHead>
        <Arcs links={data.links.filter((l) => l.n >= 40)} />
        <Source sources={[MONITOR_SOURCE]} />
      </section>

      <section className="section" aria-labelledby="howto">
        <SectionHead kicker={t("05 · Leeswijzer", "05 · How to read")} title={t("Vier soorten informatie, altijd gemarkeerd", "Four kinds of information, always marked")} />
        <div className="grid-12">
          {(["fact", "data", "analysis", "interpretation"] as const).map((l) => (
            <div key={l} className="span-3 panel">
              <LayerTag layer={l} />
              <p className="small" style={{ marginTop: 10 }}>{{
                fact: t("Vastgesteld door een officiële bron, zoals de Kiesraad. Bijvoorbeeld: de zetelverdeling.", "Established by an official source such as the Electoral Council. For example: the seat distribution."),
                data: t(`Geteld uit ${fmtInt(data.totals.items, lang)} openbare berichten. Exact herleidbaar, maar het meet aandacht, geen steun.`, `Counted from ${fmtInt(data.totals.items, lang)} public items. Fully traceable, but it measures attention, not support.`),
                analysis: t("Ingeschat door een model, zoals de toon van berichten. Bruikbaar als richting, niet als oordeel.", "Estimated by a model, such as the tone of coverage. Useful as a direction, not as a verdict."),
                interpretation: t("Een redactionele lezing. Deze site geeft die spaarzaam en altijd met deze markering.", "An editorial reading. This site gives it sparingly and always with this mark."),
              }[l]}</p>
            </div>
          ))}
        </div>
        <p className="small" style={{ marginTop: 16 }}><Link to="/data">{t("Hoe de monitor werkt", "How the monitor works")} →</Link></p>
      </section>
    </div>
  );
}
