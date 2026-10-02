import { useState } from "react";
import { Link } from "react-router-dom";
import { Hemicycle } from "../components/charts/Hemicycle";
import { ParliamentPanel } from "../components/ParliamentPanel";
import { Breadcrumbs, LayerTag, SectionHead, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { GLOSSARY, MAJORITY, PARTIES, REF, TOTAL_SEATS, politicianById } from "../data/reference";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { slug } from "../utils/format";

export default function Parliament() {
  const { t } = useLang();
  useTitle(t("Parlement", "Parliament"));
  return <WithData>{() => <ParliamentView />}</WithData>;
}

function ParliamentView() {
  const { lang, t } = useLang();
  const [selected, setSelected] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const seated = PARTIES.filter((p) => (p.seats ?? 0) > 0);
  const total = seated.filter((p) => pick.has(p.id)).reduce((a, p) => a + (p.seats ?? 0), 0);
  const toggle = (id: string) => setPick((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Parlement", "Parliament") }]} />
      <header style={{ paddingBottom: 12 }}>
        <div className="kicker">{t("Tweede Kamer der Staten-Generaal", "House of Representatives")}</div>
        <h1 className="display h1" style={{ marginTop: 10 }}>{t("150 zetels, 76 voor een meerderheid", "150 seats, 76 for a majority")}</h1>
      </header>

      <section className="section grid-12" style={{ borderTop: 0 }}>
        <div className="span-8">
          <div className="split" style={{ marginBottom: 6 }}>
            <span className="kicker">{t("Huidige zetelverdeling per fractie", "Current seats per group")}</span>
            <LayerTag layer="fact" />
          </div>
          <Hemicycle parties={PARTIES} selected={selected} onSelect={setSelected} />
          <Source sources={[REF.seatsSource, REF.cabinetSource]} method={t("Geordend naar zetels, niet op een links-rechtsas.", "Ordered by seats, not on a left-right axis.")} />
        </div>
        <div className="span-4">
          <div className="panel">
            <div className="panel-head"><h2>{t("Rekenhulp: meerderheid", "Majority calculator")}</h2><LayerTag layer="data" /></div>
            <button type="button" className="btn" style={{ marginBottom: 10 }} onClick={() => setPick(new Set(seated.filter((p) => p.coalition).map((p) => p.id)))}>
              {t("Kabinet-Jetten", "Jetten cabinet")}
            </button>
            <div className="row" style={{ gap: 6 }} role="group" aria-label={t("Partijen kiezen", "Pick parties")}>
              {seated.map((p) => (
                <button key={p.id} type="button" className="chip" aria-pressed={pick.has(p.id)} onClick={() => toggle(p.id)}>
                  <span className="swatch" style={{ background: p.color }} />{p.name} <span className="mono xs">{p.seats}</span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 16 }} aria-live="polite">
              <div className="tonebar" style={{ height: 14, position: "relative" }} role="img"
                aria-label={t(`${total} van ${TOTAL_SEATS} zetels`, `${total} of ${TOTAL_SEATS} seats`)}>
                {seated.filter((p) => pick.has(p.id)).map((p) => <span key={p.id} style={{ width: `${(100 * (p.seats ?? 0)) / TOTAL_SEATS}%`, background: p.color }} />)}
                <span style={{ position: "absolute", left: `${(100 * MAJORITY) / TOTAL_SEATS}%`, top: -4, bottom: -4, width: 2, background: "var(--ink)" }} />
              </div>
              <div className="split" style={{ marginTop: 8 }}>
                <span className="num-xl">{total}</span>
                <span className={total >= MAJORITY ? "" : "muted"} style={{ fontWeight: 600 }}>
                  {pick.size === 0 ? t("Kies partijen", "Pick parties") : total >= MAJORITY ? t(`Meerderheid, ${total - MAJORITY} over`, `Majority, ${total - MAJORITY} to spare`) : t(`Nog ${MAJORITY - total} tekort`, `${MAJORITY - total} short`)}
                </span>
              </div>
              {pick.size > 0 && <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setPick(new Set())}>{t("Wissen", "Clear")}</button>}
            </div>
            <p className="xs muted" style={{ marginTop: 12 }}>{t("Voor wetten is ook een meerderheid in de Eerste Kamer nodig (38 van 75). Die zetels staan hier niet.",
              "Laws also need a majority in the Senate (38 of 75). Those seats are not shown here.")}</p>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHead title={t("Fracties", "Parliamentary groups")} aside={<LayerTag layer="fact" />} />
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">{t("Zetels per partij", "Seats per party")}</caption>
            <thead><tr><th scope="col">{t("Partij", "Party")}</th><th scope="col" className="num">{t("Zetels", "Seats")}</th><th scope="col" className="num">%</th><th scope="col">{t("Fractievoorzitter", "Group leader")}</th><th scope="col">{t("Positie", "Position")}</th></tr></thead>
            <tbody>
              {seated.map((p) => (
                <tr key={p.id}>
                  <th scope="row"><Link to={`/partijen/${p.id}`}><span className="swatch" style={{ background: p.color, marginRight: 8 }} />{p.name}</Link> <span className="muted small">{p.fullName !== p.name ? p.fullName : ""}</span></th>
                  <td className="num">{p.seats ?? "–"}</td>
                  <td className="num">{(((p.seats ?? 0) * 100) / TOTAL_SEATS).toLocaleString(lang === "nl" ? "nl-NL" : "en-GB", { maximumFractionDigits: 1 })}</td>
                  <td>{p.leaderId ? <Link to={`/politici/${p.leaderId}`}>{politicianById.get(p.leaderId)?.name}</Link> : p.leader ?? "–"}</td>
                  <td>{p.coalition ? <span className="tag-coalition">{t("Coalitie", "Coalition")}</span> : <span className="muted small">{t("Oppositie", "Opposition")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Source sources={[REF.seatsSource, REF.cabinetSource]} />
      </section>

      <section className="section grid-12">
        <div className="span-6"><ParliamentPanel filter={{}} label={t("Laatste stemmingen in de Tweede Kamer", "Latest votes in the House")} /></div>
        <div className="span-6">
          <div className="panel">
            <div className="panel-head"><h2>{t("Zo werkt de Kamer", "How the House works")}</h2><LayerTag layer="fact" /></div>
            <dl className="factsheet">
              {GLOSSARY.filter((g) => ["Fractie", "Motie", "Amendement", "Stemming", "Wetsvoorstel"].includes(g.term)).map((g) => (
                <div key={g.term}><dt><Link to={`/politiek#${slug(g.term)}`}>{g.term}</Link></dt><dd>{lang === "nl" ? g.nl : g.enText}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
