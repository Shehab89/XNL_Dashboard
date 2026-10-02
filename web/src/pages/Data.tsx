import { Bars } from "../components/TopicBars";
import { Breadcrumbs, LayerTag, SectionHead, Source, Stat } from "../components/ui";
import { WithData } from "../components/WithData";
import { REF } from "../data/reference";
import { useHashTarget } from "../hooks/useHashTarget";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { TK_OPEN_DATA } from "../services/parliament";
import { LAYER_HELP, PLATFORM_LABEL } from "../i18n/messages";
import { fmtDate, fmtInt } from "../utils/format";

export default function Data() {
  const { t } = useLang();
  useTitle(t("Data en methode", "Data and method"));
  return <WithData>{(d) => <DataView data={d} />}</WithData>;
}

function DataView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  useHashTarget(true);
  const tot = data.totals;
  const steps: [string, string, string, string][] = [
    ["Verzamelen", "Collect", "Elke zes uur: Google News, RSS van nieuwssites, GDELT, Mastodon, YouTube en Reddit.", "Every six hours: Google News, news-site RSS, GDELT, Mastodon, YouTube and Reddit."],
    ["Ontdubbelen", "Deduplicate", "Hetzelfde bericht via twee routes telt één keer.", "The same item arriving by two routes counts once."],
    ["Herkennen", "Recognise", "Partijen, politici en onderwerpen via vaste namen en trefwoorden.", "Parties, politicians and topics via fixed names and keywords."],
    ["Toon inschatten", "Estimate tone", "Een meertalig taalmodel; voor een deel Google Gemini.", "A multilingual language model; for a share, Google Gemini."],
    ["Opslaan", "Store", "Database (Supabase), één rij per bericht met link naar de bron.", "Database (Supabase), one row per item with a link to the source."],
    ["Publiceren", "Publish", `Na elke ronde berekent de database één samenvatting per week, die deze site direct leest. Laatst: ${fmtDate(tot.generated, lang)}.`, `After each run the database computes one weekly summary that this site reads directly. Last: ${fmtDate(tot.generated, lang)}.`],
  ];
  const limits: [string, string][] = [
    [`Google News levert ${Math.round((100 * (tot.platforms.find((p) => p.platform === "google_news")?.n ?? 0)) / tot.items)}% van de berichten. De monitor weerspiegelt dus vooral wat nieuwsmedia publiceren, niet wat mensen denken.`,
      `Google News supplies ${Math.round((100 * (tot.platforms.find((p) => p.platform === "google_news")?.n ?? 0)) / tot.items)}% of items. The monitor mostly reflects what news media publish, not what people think.`],
    ["Aandacht is geen steun. Een partij die veel genoemd wordt, kan om goede of slechte redenen in het nieuws zijn.", "Attention is not support. A party mentioned often can be in the news for good or bad reasons."],
    [`De toon is een modelinschatting. Slechts ${fmtInt(tot.ai, lang)} berichten zijn door Gemini beoordeeld; de rest door een kleiner model dat nieuwskoppen vaker negatief noemt. Vergelijk toon alleen tussen partijen of onderwerpen, niet als absoluut oordeel.`,
      `Tone is a model estimate. Only ${fmtInt(tot.ai, lang)} items were judged by Gemini; the rest by a smaller model that calls headlines negative more often. Compare tone between parties or topics only, not as an absolute verdict.`],
    ["Namen herkennen mist dingen: bijnamen en verwijzingen als 'de premier'. Oude berichten over GL-PvdA tellen mee bij PRO.",
      "Name matching misses things: nicknames and references like 'the prime minister'. Older items on GL-PvdA count towards PRO."],
    [`Zetels, fractievoorzitters en het kabinet komen uit één bestand in de backend (config/entities.yaml), bijgewerkt ${fmtDate(REF.asOf, lang)} uit tweedekamer.nl en parlement.com.`,
      `Seats, group leaders and the cabinet come from one backend file (config/entities.yaml), updated ${fmtDate(REF.asOf, lang)} from tweedekamer.nl and parlement.com.`],
    ["Oudere weken zijn achteraf opgehaald (backfill). Dat vindt minder berichten dan live verzamelen, dus het totaal stijgt naar de recente weken toe deels door de methode. Vergelijk daarom vooral partijen en onderwerpen binnen dezelfde periode.",
      "Older weeks were fetched afterwards (backfill), which finds fewer items than live collection, so totals rise towards recent weeks partly because of the method. Compare parties and topics within the same period first."],
    ["X (Twitter) en Telegram zitten niet of nauwelijks in deze momentopname.", "X (Twitter) and Telegram are absent or nearly absent from this snapshot."],
  ];

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Data en methode", "Data and method") }]} />
      <header style={{ paddingBottom: 12 }}>
        <h1 className="display h1">{t("Data en methode", "Data and method")}</h1>
        <p className="lede" style={{ marginTop: 14 }}>{t("Waar elk getal vandaan komt en wat het wel en niet zegt.", "Where every number comes from and what it does and does not say.")}</p>
      </header>

      <section className="section" style={{ borderTop: 0 }}>
        <div className="stats">
          <Stat label={t("Berichten", "Items")} value={fmtInt(tot.items, lang)} sub={`${fmtDate(tot.firstDay, lang)} – ${fmtDate(tot.lastItem.slice(0, 10), lang)}`} layer="data" />
          <Stat label={t("Verschillende bronnen", "Distinct sources")} value={fmtInt(tot.sources, lang)} sub={t("media, kanalen en accounts", "outlets, channels and accounts")} layer="data" />
          <Stat label={t("Met een partij", "With a party")} value={fmtInt(tot.withParty, lang)} sub={`${Math.round((100 * tot.withParty) / tot.items)}%`} layer="data" />
          <Stat label={t("Met een onderwerp", "With a topic")} value={fmtInt(tot.withTopic, lang)} sub={`${Math.round((100 * tot.withTopic) / tot.items)}%`} layer="data" />
        </div>
      </section>

      <section className="section" id="lagen" tabIndex={-1}>
        <SectionHead kicker="01" title={t("Vier lagen, nooit door elkaar", "Four layers, never mixed")}>
          {t("Elk blok op deze site draagt een van deze vier markeringen. Vorm, rand en kleur verschillen, zodat het ook zonder kleur leesbaar is.",
            "Every block on this site carries one of these four marks. Shape, border and colour differ, so it reads without colour too.")}
        </SectionHead>
        <div className="grid-12">
          {(["fact", "data", "analysis", "interpretation"] as const).map((l) => (
            <div key={l} className="span-3 panel"><LayerTag layer={l} /><p className="small" style={{ marginTop: 10 }}>{LAYER_HELP[lang][l]}</p></div>
          ))}
        </div>
      </section>

      <section className="section grid-12">
        <div className="span-7">
          <SectionHead kicker="02" title={t("Hoe een bericht een getal wordt", "How an item becomes a number")} />
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {steps.map(([nl, en, dnl, den], i) => (
              <li key={nl} style={{ display: "grid", gridTemplateColumns: "2.4rem 1fr", gap: 12, padding: "12px 0", borderTop: "1px solid var(--rule-soft)" }}>
                <span className="mono" style={{ color: "var(--red)" }}>{String(i + 1).padStart(2, "0")}</span>
                <span><strong>{t(nl, en)}</strong><span className="small" style={{ display: "block", color: "var(--ink-2)" }}>{t(dnl, den)}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <div className="span-5">
          <SectionHead kicker="03" title={t("Herkomst van de berichten", "Where items come from")} aside={<LayerTag layer="data" />} />
          <Bars rows={tot.platforms.map((p) => ({ id: p.platform, label: PLATFORM_LABEL[p.platform] ?? p.platform, value: p.n }))} />
          <Source sources={[MONITOR_SOURCE, REF.seatsSource, TK_OPEN_DATA]} />
        </div>
      </section>

      <section className="section" id="beperkingen" tabIndex={-1}>
        <SectionHead kicker="04" title={t("Beperkingen", "Limitations")}>{t("Wat je niet uit deze monitor kunt concluderen.", "What you cannot conclude from this monitor.")}</SectionHead>
        <ol className="prose" style={{ paddingLeft: "1.2em" }}>
          {limits.map(([nl, en]) => <li key={nl} style={{ marginBottom: 10 }}>{t(nl, en)}</li>)}
        </ol>
      </section>

      <section className="section grid-12">
        <div className="span-6">
          <SectionHead kicker="05" title={t("Neutraliteit", "Neutrality")} />
          <div className="prose small">
            <p>{t("Elke partij en elk onderwerp wordt op dezelfde manier gemeten. Partijen staan op zetelaantal, nooit op een links-rechtsas. Partijkleuren verschijnen alleen bij die partij zelf.",
              "Every party and topic is measured the same way. Parties are ordered by seats, never on a left-right axis. Party colours only appear for that party.")}</p>
            <p>{t("De monitor geeft geen stemadvies, voorspelt geen uitslagen en beoordeelt geen standpunten.", "The monitor gives no voting advice, predicts no results and judges no positions.")}</p>
          </div>
        </div>
        <div className="span-6" id="over">
          <SectionHead kicker="06" title={t("Over", "About")} />
          <div className="prose small">
            <p><strong>EinData</strong>. {t("EinData maakt dataproducten die het publieke debat meetbaar maken. De monitor is onafhankelijk en partijneutraal.",
              "EinData builds data products that make public debate measurable. The monitor is independent and non-partisan.")}</p>
            <p><strong>Shehab Al-Masri</strong>. {t("Oprichter van EinData en maker van deze monitor: van het verzamelen van de bronnen tot de analyse en deze site. Vragen en correcties zijn welkom.",
              "Founder of EinData and creator of this monitor, from collecting the sources to the analysis and this site. Questions and corrections are welcome.")}</p>
            <p><a href="https://github.com/Shehab89" target="_blank" rel="noreferrer">GitHub · Shehab89</a></p>
          </div>
        </div>
      </section>
    </div>
  );
}
