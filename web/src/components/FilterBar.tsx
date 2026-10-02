import { useState } from "react";
import { PARTIES, POLITICIANS, TOPICS } from "../data/reference";
import { useFilters, type Preset, type Tone } from "../hooks/useFilters";
import { useLang } from "../hooks/useLang";
import { useMonitor } from "../hooks/useMonitor";
import { PLATFORM_LABEL } from "../i18n/messages";
import { fmtDate } from "../utils/format";

/** The site-wide filters: period, tone, source and (on overview pages) one party, topic or person to focus on.
 * Every count, ranking, chart and headline list below follows them. On phones the bar folds into one button. */
export function FilterBar({ focus = true }: { focus?: boolean }) {
  const { lang, t } = useLang();
  const f = useFilters();
  const state = useMonitor();
  const [open, setOpen] = useState(false);
  const base = state.status === "ready" ? state.data : null;
  const weeks = base?.weeks ?? [];

  const presets: [Preset, string, string][] = [[4, "4 weken", "4 weeks"], [13, "3 maanden", "3 months"], [52, "12 maanden", "12 months"], [0, "Eigen", "Custom"]];
  const tones: [Tone, string, string][] = [["all", "Alle", "All"], ["pos", "Positief", "Positive"], ["neu", "Neutraal", "Neutral"], ["neg", "Negatief", "Negative"]];
  const pickPreset = (p: Preset) => p === 0
    ? f.set({ preset: 0, from: f.from ?? weeks[Math.max(0, weeks.length - 9)] ?? null, to: f.to ?? weeks[weeks.length - 1] ?? null })
    : f.set({ preset: p });
  const weekOptions = weeks.map((w) => <option key={w} value={w}>{fmtDate(w, lang, "short")}</option>);

  return (
    <div className="filterbar" role="region" aria-label={t("Filters", "Filters")}>
      <div className="page">
        <button type="button" className="filter-toggle" aria-expanded={open} aria-controls="filter-panel" onClick={() => setOpen(!open)}>
          {t("Filters", "Filters")}{f.active > 0 && <span className="filter-count">{f.active}</span>}
        </button>
        <div id="filter-panel" className={`filterbar-inner${open ? " open" : ""}`}>
          <div className="filter-group">
            <span className="filter-label" id="f-period">{t("Periode", "Period")}</span>
            <div role="group" aria-labelledby="f-period" className="segmented small-seg">
              {presets.map(([k, nl, en]) => <button key={k} type="button" aria-pressed={f.preset === k} onClick={() => pickPreset(k)}>{t(nl, en)}</button>)}
            </div>
            {f.preset === 0 && weeks.length > 0 && <>
              <label className="sr-only" htmlFor="f-from">{t("Vanaf week", "From week")}</label>
              <select id="f-from" className="input small-input" value={f.from ?? ""} onChange={(e) => f.set({ from: e.target.value })}>{weekOptions}</select>
              <span className="xs muted">{t("t/m", "to")}</span>
              <label className="sr-only" htmlFor="f-to">{t("Tot en met week", "Through week")}</label>
              <select id="f-to" className="input small-input" value={f.to ?? ""} onChange={(e) => f.set({ to: e.target.value })}>{weekOptions}</select>
            </>}
          </div>
          <div className="filter-group">
            <span className="filter-label" id="f-tone">{t("Toon", "Tone")}</span>
            <div role="group" aria-labelledby="f-tone" className="segmented small-seg">
              {tones.map(([k, nl, en]) => <button key={k} type="button" aria-pressed={f.tone === k} onClick={() => f.set({ tone: k })}>{t(nl, en)}</button>)}
            </div>
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="f-source">{t("Bron", "Source")}</label>
            <select id="f-source" className="input small-input" value={f.source} onChange={(e) => f.set({ source: e.target.value })}>
              <option value="all">{t("Alle bronnen", "All sources")}</option>
              <option value="news">{t("Nieuws", "News")}</option>
              <option value="social">{t("Sociale media", "Social media")}</option>
              {base && <optgroup label={t("Platform", "Platform")}>
                {base.plats.map((p) => <option key={p.name} value={p.name}>{PLATFORM_LABEL[p.name] ?? p.name}</option>)}
              </optgroup>}
            </select>
          </div>
          {focus && base && (
            <div className="filter-group">
              <label className="filter-label" htmlFor="f-focus">{t("Over", "About")}</label>
              <select id="f-focus" className="input small-input" value={f.focus ?? ""} onChange={(e) => f.set({ focus: e.target.value || null })}>
                <option value="">{t("Alles", "Everything")}</option>
                <optgroup label={t("Partij", "Party")}>{PARTIES.map((p) => <option key={p.id} value={`party:${p.id}`}>{p.name}</option>)}</optgroup>
                <optgroup label={t("Persoon", "Person")}>{POLITICIANS.map((p) => <option key={p.id} value={`politician:${p.id}`}>{p.name}</option>)}</optgroup>
                <optgroup label={t("Onderwerp", "Topic")}>{TOPICS.map((x) => <option key={x.id} value={`topic:${x.id}`}>{lang === "nl" ? x.name : x.nameEn}</option>)}</optgroup>
              </select>
            </div>
          )}
          {f.active > 0 && <button type="button" className="btn small-btn" onClick={f.reset}>{t("Wissen", "Reset")}</button>}
        </div>
      </div>
    </div>
  );
}

/** "the last 4 weeks" style phrase for headings. */
export function usePeriodLabel() {
  const { lang, t } = useLang();
  const { preset, period, from, to } = useFilters();
  if (preset === 0 && from && to) return `${fmtDate(from, lang, "short")} – ${fmtDate(to, lang, "short")}`;
  return period === 4 ? t("afgelopen 4 weken", "last 4 weeks") : period === 13 ? t("afgelopen 3 maanden", "last 3 months") : t("afgelopen 12 maanden", "last 12 months");
}
