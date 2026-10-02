import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { groupResults, KIND_LABEL } from "../components/SearchPalette";
import { Breadcrumbs, EmptyState } from "../components/ui";
import { WithData } from "../components/WithData";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { buildIndex, search } from "../services/search";
import type { MonitorData } from "../services/monitor";
import type { SearchKind } from "../types";

export default function Search() {
  const { t } = useLang();
  useTitle(t("Zoeken", "Search"));
  return <WithData>{(d) => <SearchView data={d} />}</WithData>;
}

function SearchView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const [kind, setKind] = useState<SearchKind | "all">("all");
  useEffect(() => { setDraft(q); setKind("all"); }, [q]);
  const index = useMemo(() => buildIndex(data, lang), [data, lang]);
  const results = useMemo(() => search(index, q, 200), [index, q]);
  const groups = groupResults(results);
  const shown = kind === "all" ? groups : groups.filter((g) => g.kind === kind);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Zoeken", "Search") }]} />
      <h1 className="display h1">{t("Zoeken", "Search")}</h1>
      <form className="hero-search" role="search" style={{ maxWidth: 720 }} onSubmit={(e) => { e.preventDefault(); setParams(draft.trim() ? { q: draft.trim() } : {}); }}>
        <label htmlFor="sq" className="sr-only">{t("Zoekterm", "Search term")}</label>
        <input id="sq" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("Partij, politicus, onderwerp, begrip of kop", "Party, politician, topic, term or headline")} />
        <button type="submit">{t("Zoek", "Search")}</button>
      </form>
      <p className="small muted" style={{ maxWidth: "62ch" }}>
        {t("Zoekt in partijen, politici, onderwerpen, begrippen en de tijdlijn, en in de recente koppen die de monitor bewaart. Engelse en alledaagse woorden (housing, asiel, boeren) leiden naar het juiste onderwerp.",
          "Searches parties, politicians, topics, terms and the timeline, plus the recent headlines the monitor keeps. English and everyday words (housing, asylum, farmers) lead to the right topic.")}
      </p>

      {q && (
        <div aria-live="polite">
          <div className="row" style={{ margin: "24px 0 8px" }} role="group" aria-label={t("Soort resultaat", "Result type")}>
            <button type="button" className="chip" aria-pressed={kind === "all"} onClick={() => setKind("all")}>{t("Alles", "All")} <span className="mono xs">{results.length}</span></button>
            {groups.map((g) => (
              <button key={g.kind} type="button" className="chip" aria-pressed={kind === g.kind} onClick={() => setKind(g.kind)}>
                {KIND_LABEL[g.kind][lang === "nl" ? 0 : 1]} <span className="mono xs">{g.items.length}</span>
              </button>
            ))}
          </div>
          {!results.length && (
            <EmptyState title={t(`Niets gevonden voor "${q}".`, `Nothing found for "${q}".`)}>
              {t("Probeer een partijnaam, een achternaam of een breder woord, zoals ", "Try a party name, a surname or a broader word, such as ")}
              <Link to="/zoeken?q=wonen">wonen</Link>, <Link to="/zoeken?q=Kamer">Kamer</Link>, <Link to="/zoeken?q=motie">motie</Link>.
            </EmptyState>
          )}
          {shown.map((g) => (
            <section key={g.kind} className="section" style={{ padding: "20px 0" }}>
              <h2 className="kicker" style={{ marginBottom: 8 }}>{KIND_LABEL[g.kind][lang === "nl" ? 0 : 1]}</h2>
              <ul className="headlines">
                {g.items.slice(0, kind === "all" ? 8 : 100).map((r) => (
                  <li key={r.kind + r.id}>
                    {r.external
                      ? <a href={r.href} target="_blank" rel="noreferrer"><div className="hl-title">{r.title}</div>{r.subtitle && <div className="hl-meta">{r.subtitle} ↗</div>}</a>
                      : <Link to={r.href}><div className="hl-title">{r.title}</div>{r.subtitle && <div className="hl-meta">{r.subtitle}</div>}</Link>}
                  </li>
                ))}
              </ul>
              {kind === "all" && g.items.length > 8 && (
                <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setKind(g.kind)}>{t(`Alle ${g.items.length} tonen`, `Show all ${g.items.length}`)}</button>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
