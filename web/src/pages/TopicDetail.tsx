import { Link, useParams } from "react-router-dom";
import { AttentionChart } from "../components/charts/AttentionChart";
import { ParliamentPanel } from "../components/ParliamentPanel";
import { Bars } from "../components/TopicBars";
import { Breadcrumbs, Delta, HeadlineList, LayerTag, SectionHead, Source, Stat, ToneBar } from "../components/ui";
import { WithData } from "../components/WithData";
import { partyById, topicById } from "../data/reference";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { fmtDate, fmtInt } from "../utils/format";
import { argmax, change, windowSum } from "../utils/series";
import NotFound from "./NotFound";

export default function TopicDetail() {
  const { id = "" } = useParams();
  const { lang } = useLang();
  const tp = topicById.get(id);
  useTitle(tp ? (lang === "nl" ? tp.name : tp.nameEn) : "");
  if (!tp) return <NotFound />;
  return <WithData>{(d) => <TopicView data={d} id={id} />}</WithData>;
}

function TopicView({ data, id }: { data: MonitorData; id: string }) {
  const { lang, t } = useLang();
  const tp = topicById.get(id)!;
  const name = lang === "nl" ? tp.name : tp.nameEn;
  const cov = data.topic.get(id)!;
  const pw = data.partialWeek;
  const peak = argmax(cov.series.n.slice(0, pw));
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
          <p className="lede" style={{ marginTop: 12 }}>{lang === "nl" ? tp.scope.nl : tp.scope.en}</p>
        </div>
        <div>
          <div className="split" style={{ marginBottom: 6 }}><span className="kicker">{t("Afbakening", "Scope")}</span><LayerTag layer="data" /></div>
          <dl className="factsheet">
            <div><dt>{t("Label", "Label")}</dt><dd className="mono">{tp.name}</dd></div>
            <div><dt>{t("Toegekend via", "Assigned by")}</dt><dd>{t("Trefwoorden en taalmodel", "Keywords and language model")}</dd></div>
            <div><dt>{t("Beleid", "Policy")}</dt><dd><span className="verify">{t("Wetsvoorstellen en moties: nog niet gekoppeld", "Bills and motions: not connected yet")}</span></dd></div>
          </dl>
        </div>
      </header>

      <section className="section" style={{ borderTop: 0 }}>
        <div className="stats">
          <Stat layer="data" label={t("Berichten, 12 maanden", "Items, 12 months")} value={fmtInt(cov.totals.n, lang)} sub={`${Math.round((100 * cov.totals.social) / Math.max(1, cov.totals.n))}% ${t("sociale media", "social media")}`} />
          <Stat layer="data" label={t("Laatste 4 weken", "Last 4 weeks")} value={fmtInt(windowSum(cov.series.n, pw, 4), lang)} sub={<><Delta value={change(cov.series.n, pw, 4)} /> {t("t.o.v. 4 weken ervoor", "vs. 4 weeks before")}</>} />
          <Stat layer="data" label={t("Drukste week", "Busiest week")} value={fmtDate(data.weeks[peak], lang, "short")} sub={`${fmtInt(cov.series.n[peak], lang)} ${t("berichten", "items")}`} />
          <Stat layer="data" label={t("Meest genoemde partij", "Most mentioned party")} value={links[0] ? partyById.get(links[0].party)?.name : "–"} sub={links[0] ? `${fmtInt(links[0].n, lang)} ${t("berichten", "items")}` : undefined} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-8">
          <SectionHead title={t("Aandacht over het jaar", "Attention over the year")} aside={<LayerTag layer="data" />} />
          <AttentionChart weeks={data.weeks} partialWeek={pw} partialDays={data.partialDays} title={t(`Berichten per week over ${name}`, `Items per week about ${name}`)}
            series={[{ id, label: name, color: "var(--ink)", values: cov.series.n }]}
            markers={data.events.filter((e) => e.kind === "election").map((e) => ({ date: e.date, label: e.id === "tk2025" ? "TK" : "GR" }))} />
          <Source sources={[MONITOR_SOURCE]} />
        </div>
        <div className="span-4">
          <SectionHead title={t("Recente berichten", "Recent coverage")} aside={<LayerTag layer="data" />} />
          <HeadlineList items={cov.headlines} />
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-7">
          <SectionHead title={t("Partijen in dit debat", "Parties in this debate")} aside={<LayerTag layer="data" />}>
            {t("Berichten over dit onderwerp waarin ook de partij genoemd wordt. Meer genoemd is niet hetzelfde als meer gelijk.",
              "Items on this topic that also mention the party. Mentioned more is not the same as being right.")}
          </SectionHead>
          {links.length ? (
            <Bars rows={links.slice(0, 12).map((l) => {
              const p = partyById.get(l.party)!;
              return { id: l.party, label: p.name, to: `/partijen/${l.party}`, value: l.n, color: p.color };
            })} />
          ) : <p className="small muted">{t("Te weinig berichten met partijnamen.", "Too few items naming a party.")}</p>}
          <Source sources={[MONITOR_SOURCE]} />
        </div>
        <div className="span-5">
          <SectionHead title={t("Toon van de berichtgeving", "Tone of coverage")} aside={<LayerTag layer="analysis" />}>
            {t("Klinkt het nieuws over dit onderwerp positief of negatief? Ingeschat door een taalmodel per bericht.",
              "Does coverage of this topic sound positive or negative? Estimated per item by a language model.")}
          </SectionHead>
          <ToneBar n={cov.totals.n} pos={cov.totals.pos} neg={cov.totals.neg} label={name} />
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
