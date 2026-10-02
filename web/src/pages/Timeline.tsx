import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Breadcrumbs, EmptyState, LayerTag, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { HISTORY, partyById, topicById } from "../data/reference";
import { useHashTarget } from "../hooks/useHashTarget";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import type { Headline, TimelineEvent } from "../types";
import { fmtDate, fmtInt } from "../utils/format";
import { PLATFORM_LABEL } from "../i18n/messages";

type Mode = "today" | "month" | "year" | "history";
interface Column { key: string; label: string; sub?: string; bars?: { v: number; peak: boolean; label: string }[]; events: TimelineEvent[]; headlines?: Headline[] }

export default function Timeline() {
  const { t } = useLang();
  useTitle(t("Tijdlijn", "Timeline"));
  return <WithData>{(d) => <TimelineView data={d} />}</WithData>;
}

function TimelineView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const { hash } = useLocation();
  const [mode, setMode] = useState<Mode>(hash.startsWith("#hist-") ? "history" : "year");
  const months = useMemo(() => [...new Set(data.weeks.map((w) => w.slice(0, 7)))], [data]);
  const [month, setMonth] = useState(months[months.length - 1]);
  const target = useHashTarget(true);
  const wallRef = useRef<HTMLDivElement>(null);
  // Open on the most recent period; a linked event scrolls itself into view instead.
  useEffect(() => {
    if (!target && wallRef.current && (mode === "year" || mode === "history")) wallRef.current.scrollLeft = wallRef.current.scrollWidth;
  }, [mode, target]);

  const allHeadlines = useMemo(() => {
    const seen = new Set<string>();
    return [...data.headlines, ...[...data.politician.values()].flatMap((p) => p.headlines)]
      .filter((h) => !seen.has(h.url) && seen.add(h.url)).sort((a, b) => b.date.localeCompare(a.date));
  }, [data]);

  const columns: Column[] = useMemo(() => {
    if (mode === "year") {
      const peakWeeks = new Set(data.events.filter((e) => e.kind === "media-peak").map((e) => e.date));
      return months.map((m) => {
        const idx = data.weeks.map((w, i) => [w, i] as const).filter(([w]) => w.startsWith(m));
        const total = idx.reduce((a, [, i]) => a + data.total[i], 0);
        return {
          key: m, label: fmtDate(m + "-15", lang, "month"), sub: `${fmtInt(total, lang)}`,
          bars: idx.map(([w, i]) => ({ v: data.total[i], peak: peakWeeks.has(w), label: `${fmtDate(w, lang, "short")}: ${fmtInt(data.total[i], lang)}` })),
          events: data.events.filter((e) => e.date.startsWith(m)),
        };
      });
    }
    if (mode === "month") {
      return data.weeks.filter((w) => w.startsWith(month)).map((w) => {
        const end = new Date(new Date(w).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
        const i = data.weeks.indexOf(w);
        return {
          key: w, label: `${fmtDate(w, lang, "short")}`, sub: `${fmtInt(data.total[i], lang)}`,
          events: data.events.filter((e) => e.date >= w && e.date <= end),
          headlines: allHeadlines.filter((h) => h.date >= w && h.date <= end).slice(0, 6),
        };
      });
    }
    if (mode === "today") {
      const days = [...new Set(allHeadlines.map((h) => h.date))].slice(0, 5);
      return days.map((d) => ({ key: d, label: fmtDate(d, lang, "short"), sub: new Date(d + "T12:00:00").toLocaleDateString(lang === "nl" ? "nl-NL" : "en-GB", { weekday: "long" }), events: [], headlines: allHeadlines.filter((h) => h.date === d).slice(0, 8) }));
    }
    const years = [...new Set(HISTORY.map((e) => e.date.slice(0, 4)))];
    return years.map((y) => ({ key: y, label: y, events: HISTORY.filter((e) => e.date.startsWith(y)) }));
  }, [mode, month, months, data, lang, allHeadlines]);

  const maxBar = Math.max(1, ...data.total);
  const modes: [Mode, string, string][] = [["today", "Vandaag", "Today"], ["month", "Maand", "Month"], ["year", "Jaar", "Year"], ["history", "Historisch", "Historical"]];

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Tijdlijn", "Timeline") }]} />
      <header style={{ paddingBottom: 28 }}>
        <h1 className="display h1">{t("Tijdlijn", "Timeline")}</h1>
        <p className="lede" style={{ marginTop: 14 }}>
          {t("Verkiezingen en kabinetten naast de weken waarin het meest over politiek werd gepubliceerd. Scroll opzij door de tijd.",
            "Elections and cabinets next to the weeks with the most political coverage. Scroll sideways through time.")}
        </p>
      </header>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div role="group" aria-label={t("Periode", "Period")} className="segmented">
          {modes.map(([k, nl, en]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{t(nl, en)}</button>)}
        </div>
        {mode === "month" && (
          <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <label htmlFor="tm">{t("Maand", "Month")}</label>
            <select id="tm" className="input" style={{ width: "auto" }} value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{fmtDate(m + "-15", lang, "month")}</option>)}
            </select>
          </div>
        )}
        <div className="row xs" style={{ gap: 14 }}>
          <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: "var(--red)" }} />{t("Verkiezing", "Election")}</span>
          <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: "var(--ink)" }} />{t("Kabinet", "Cabinet")}</span>
          <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: "var(--blue)" }} />{t("Drukste week in het nieuws", "Busiest week in the news")}</span>
        </div>
      </div>
      {mode === "today" && (
        <p className="small muted" style={{ marginTop: 0 }}>
          {t(`Dit is een momentopname: de laatste dagen tot ${fmtDate(data.totals.lastItem.slice(0, 10), lang)}, niet live.`,
            `This is a snapshot: the last days up to ${fmtDate(data.totals.lastItem.slice(0, 10), lang)}, not live.`)}
        </p>
      )}
      <div className="wall" ref={wallRef} tabIndex={0} role="region" aria-label={t("Tijdlijn, horizontaal scrollbaar", "Timeline, scrolls horizontally")}>
        <div className="wall-inner" style={{ gridAutoColumns: mode === "history" || mode === "month" ? "minmax(250px, 1fr)" : undefined }}>
          {columns.map((c) => (
            <section key={c.key} className="wall-col" aria-label={c.label}>
              <div className="wall-month"><b>{c.label}</b>{c.sub && <span className="mono xs muted">{c.sub}</span>}</div>
              {c.bars && (
                <div className="wall-bars" role="img" aria-label={t("Berichten per week: ", "Items per week: ") + c.bars.map((b) => b.label).join(", ")}>
                  {c.bars.map((b, i) => <span key={i} className={b.peak ? "peak" : ""} style={{ height: `${(100 * b.v) / maxBar}%` }} title={b.label} />)}
                </div>
              )}
              {c.events.map((e) => <EventTile key={e.id} e={e} target={target === e.id} />)}
              {c.headlines?.map((h) => (
                <article key={h.url} className="tile" style={{ borderTopColor: "var(--rule-soft)", borderTopWidth: 1 }}>
                  <div className="tile-date">{h.source} · {PLATFORM_LABEL[h.platform] ?? h.platform}</div>
                  <h3><a href={h.url} target="_blank" rel="noreferrer">{h.title}</a></h3>
                </article>
              ))}
              {!c.events.length && !c.headlines?.length && <p className="xs muted" style={{ padding: "12px" }}>{t("Geen markeringen.", "No markers.")}</p>}
            </section>
          ))}
        </div>
      </div>
      {!columns.length && <EmptyState title={t("Niets in deze periode.", "Nothing in this period.")} />}
      <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
        <span className="row xs" style={{ gap: 8 }}><LayerTag layer="fact" /> {t("verkiezingen en kabinetten", "elections and cabinets")} <LayerTag layer="data" /> {t("drukste weken en berichten", "busiest weeks and coverage")}</span>
      </div>
      <Source sources={[MONITOR_SOURCE, ...(mode === "history" ? HISTORY[0].sources : [])]} method={t("Drukste weken: de 14 weken met de meeste berichten, met de drie meest gedeelde koppen. Geen redactionele selectie.",
        "Busiest weeks: the 14 weeks with the most items, with their three most shared headlines. No editorial selection.")} />
    </div>
  );
}

function EventTile({ e, target }: { e: TimelineEvent; target: boolean }) {
  const { lang, t } = useLang();
  const kindLabel = { election: t("Verkiezing", "Election"), government: t("Kabinet", "Cabinet"), parliament: t("Parlement", "Parliament"), "media-peak": t("Drukste week", "Busiest week") }[e.kind];
  const [lead, ...rest] = e.sources;
  return (
    <article id={e.id} className={`tile kind-${e.kind}`} data-target={target} tabIndex={-1}>
      <div className="split">
        <span className="tile-date">{kindLabel} · {e.kind === "media-peak" ? (lang === "nl" ? "wk " : "wk ") + fmtDate(e.date, lang, "short") : fmtDate(e.date, lang)}</span>
        <LayerTag layer={e.layer} />
      </div>
      <h3>{e.kind === "media-peak" && lead?.url ? <a href={lead.url} target="_blank" rel="noreferrer">{e.title}</a> : e.title}</h3>
      {e.summary && <p className="small" style={{ margin: "0 0 6px" }}>{e.summary}</p>}
      {(e.parties.length > 0 || e.topics.length > 0) && (
        <div className="row" style={{ gap: 4 }}>
          {e.parties.slice(0, 4).map((p) => <Link key={p} className="chip xs" to={`/partijen/${p}`}><span className="swatch" style={{ background: partyById.get(p)?.color }} />{partyById.get(p)?.name}</Link>)}
          {e.topics.slice(0, 2).map((tp) => <Link key={tp} className="chip xs" to={`/onderwerpen/${tp}`}>{lang === "nl" ? topicById.get(tp)?.name : topicById.get(tp)?.nameEn}</Link>)}
        </div>
      )}
      {e.kind === "media-peak" ? (
        <>
          <div className="xs mono muted" style={{ marginTop: 6 }}>{lead?.name}</div>
          {rest.length > 0 && (
            <details className="data-table" style={{ marginTop: 6 }}>
              <summary>{t(`Nog ${rest.length} koppen`, `${rest.length} more headlines`)}</summary>
              <ul className="headlines">
                {rest.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer"><span className="small">{s.note}</span><div className="hl-meta">{s.name}</div></a></li>)}
              </ul>
            </details>
          )}
        </>
      ) : <Source sources={e.sources} />}
    </article>
  );
}
