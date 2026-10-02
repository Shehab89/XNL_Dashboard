import { Link } from "react-router-dom";
import { Breadcrumbs, LayerTag, SectionHead, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { GLOSSARY, TOPICS } from "../data/reference";
import { useHashTarget } from "../hooks/useHashTarget";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { fmtDate, fmtInt, slug } from "../utils/format";

/** Heat steps chosen so every cell keeps 4.5:1 text contrast: ink text up to 0.5, paper text from 0.66. */
const STEPS = [0.04, 0.12, 0.22, 0.34, 0.5, 0.66, 0.8, 0.94];

export default function Politics() {
  const { t } = useLang();
  useTitle(t("Politiek", "Politics"));
  return <WithData>{(d) => <PoliticsView data={d} />}</WithData>;
}

function PoliticsView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const target = useHashTarget(true);
  const months = [...new Set(data.weeks.map((w) => w.slice(0, 7)))];
  const grid = TOPICS.map((tp) => {
    const n = data.topic.get(tp.id)!.series.n;
    return { tp, cells: months.map((m) => data.weeks.reduce((a, w, i) => (w.startsWith(m) ? a + n[i] : a), 0)) };
  }).sort((a, b) => b.cells.reduce((x, y) => x + y, 0) - a.cells.reduce((x, y) => x + y, 0));
  const max = Math.max(...grid.flatMap((g) => g.cells));

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Politiek", "Politics") }]} />
      <header style={{ paddingBottom: 12 }}>
        <h1 className="display h1">{t("Hoe de Nederlandse politiek werkt", "How Dutch politics works")}</h1>
        <p className="lede" style={{ marginTop: 14 }}>{t("Wie kiest wie, wie controleert wie, en waar het afgelopen jaar over ging.", "Who elects whom, who checks whom, and what the past year was about.")}</p>
      </header>

      <section className="section" style={{ borderTop: 0 }}>
        <SectionHead kicker="01" title={t("De machtsverhoudingen in één beeld", "The balance of power in one picture")} aside={<LayerTag layer="fact" />} />
        <Structure />
      </section>

      <section className="section">
        <SectionHead kicker="02" title={t("Het jaar in onderwerpen", "The year in topics")} aside={<LayerTag layer="data" />}>
          {t("Berichten per onderwerp per maand. Hoe donkerder, hoe meer aandacht. Elke rij heeft dezelfde schaal.",
            "Items per topic per month. The darker, the more attention. Every row uses the same scale.")}
        </SectionHead>
        <div className="table-scroll">
          <table className="table" style={{ minWidth: 760, borderCollapse: "separate", borderSpacing: 2 }}>
            <caption className="sr-only">{t("Berichten per onderwerp per maand", "Items per topic per month")}</caption>
            <thead>
              <tr><th scope="col">{t("Onderwerp", "Topic")}</th>{months.map((m) => <th key={m} scope="col" className="num" style={{ padding: "4px 2px", textAlign: "center" }}>{fmtDate(m + "-15", lang, "month")}</th>)}</tr>
            </thead>
            <tbody>
              {grid.map(({ tp, cells }) => (
                <tr key={tp.id}>
                  <th scope="row" style={{ whiteSpace: "nowrap", fontWeight: 500, fontFamily: "var(--font-ui)", textTransform: "none", letterSpacing: 0, fontSize: "var(--fs-s)", color: "var(--ink)" }}>
                    <Link to={`/onderwerpen/${tp.id}`}>{lang === "nl" ? tp.name : tp.nameEn}</Link>
                  </th>
                  {cells.map((v, i) => {
                    const level = Math.min(STEPS.length - 1, Math.floor(Math.sqrt(v / max) * STEPS.length));
                    return (
                      <td key={months[i]} title={`${fmtInt(v, lang)}`} style={{ background: `rgba(27,26,23,${STEPS[level]})`, color: STEPS[level] > 0.6 ? "var(--paper)" : "var(--ink)", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, padding: "6px 2px", borderBottom: 0 }}>
                        {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Source sources={[MONITOR_SOURCE]} method={t("De laatste maand loopt nog. Kleurschaal: acht stappen op de wortel van het aantal, zodat kleine onderwerpen zichtbaar blijven.",
          "The last month is still running. Colour scale: eight steps on the square root of the count, so small topics stay visible.")} />
      </section>

      <section className="section" aria-labelledby="begrippen">
        <SectionHead kicker="03" title={t("Begrippen", "Glossary")} aside={<LayerTag layer="fact" />}>
          {t("De woorden die in het nieuws over de Kamer steeds terugkomen.", "The words that keep returning in news about parliament.")}
        </SectionHead>
        <dl className="grid-12" style={{ margin: 0 }}>
          {GLOSSARY.map((g) => (
            <div key={g.term} id={slug(g.term)} tabIndex={-1} className="span-4 panel" style={target === slug(g.term) ? { outline: "2px solid var(--orange)", outlineOffset: 4 } : undefined}>
              <dt className="h3" style={{ fontFamily: "var(--font-display)", fontWeight: 450, fontSize: "var(--fs-xl)" }}>{g.term} <span className="xs mono muted">{lang === "nl" ? "" : g.en}</span></dt>
              <dd className="small" style={{ margin: "6px 0 0" }}>{lang === "nl" ? g.nl : g.enText}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/** Voters elect the House (and, through the provinces, the Senate); a majority in the House supports the cabinet;
 * the House scrutinises the cabinet with motions, questions and votes. Drawn as an accessible list, styled as a diagram. */
function Structure() {
  const { t } = useLang();
  const node = (title: string, sub: string, accent = false) => (
    <div style={{ border: "1px solid var(--rule)", background: accent ? "var(--ink)" : "var(--card)", color: accent ? "var(--paper)" : undefined, padding: "12px 14px" }}>
      <div style={{ font: "450 var(--fs-xl)/1.15 var(--font-display)" }}>{title}</div>
      <div className="small" style={{ opacity: 0.8, marginTop: 4 }}>{sub}</div>
    </div>
  );
  const arrow = (label: string) => (
    <div className="mono xs muted" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0 6px 18px", borderLeft: "1px dashed var(--ink-3)", marginLeft: 18 }}>
      <span aria-hidden="true">↓</span>{label}
    </div>
  );
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0 }} className="grid-12">
      <li className="span-6">
        {node(t("Kiezers", "Voters"), t("Iedere Nederlander vanaf 18 jaar.", "Every Dutch citizen aged 18 or over."))}
        {arrow(t("kiezen elke vier jaar (of eerder)", "elect every four years (or sooner)"))}
        {node(t("Tweede Kamer · 150", "House of Representatives · 150"), t("Maakt en wijzigt wetten, controleert het kabinet met moties en vragen.", "Makes and amends laws, scrutinises the cabinet with motions and questions."), true)}
        {arrow(t("een meerderheid steunt", "a majority supports"))}
        {node(t("Kabinet", "Cabinet"), t("Premier, ministers en staatssecretarissen. Regeert zolang de Kamer het vertrouwen heeft.", "Prime minister, ministers and state secretaries. Governs while it keeps the House's confidence."))}
      </li>
      <li className="span-6">
        {node(t("Provinciale Staten", "Provincial councils"), t("Ook direct gekozen door de kiezers.", "Also directly elected by voters."))}
        {arrow(t("kiezen", "elect"))}
        {node(t("Eerste Kamer · 75", "Senate · 75"), t("Stemt als laatste over wetten; kan ze verwerpen, niet wijzigen.", "Has the final vote on laws; can reject them, not amend them."))}
        <p className="small" style={{ marginTop: 16 }}>
          {t("Een wet komt er dus pas als het kabinet (of een Kamerlid) een voorstel doet, de Tweede Kamer instemt en daarna ook de Eerste Kamer.",
            "So a law only passes when the cabinet (or a member) proposes it, the House agrees, and then the Senate agrees as well.")}
        </p>
        <Source sources={[{ name: "Rijksoverheid · Tweede Kamer · Eerste Kamer", url: "https://www.tweedekamer.nl/zo-werkt-de-kamer", verification: "verified" }]} />
      </li>
    </ol>
  );
}
