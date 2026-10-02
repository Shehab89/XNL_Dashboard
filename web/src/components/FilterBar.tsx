import { useFilters, type Period, type SourceFilter } from "../hooks/useFilters";
import { useLang } from "../hooks/useLang";

/** The two site-wide filters. Every count, ranking and chart on the page follows them. */
export function FilterBar() {
  const { t } = useLang();
  const { period, source, set } = useFilters();
  const periods: [Period, string, string][] = [[4, "4 weken", "4 weeks"], [13, "3 maanden", "3 months"], [52, "12 maanden", "12 months"]];
  const sources: [SourceFilter, string, string][] = [["all", "Alles", "All"], ["news", "Nieuws", "News"], ["social", "Sociale media", "Social media"]];
  return (
    <div className="filterbar" role="region" aria-label={t("Filters", "Filters")}>
      <div className="page filterbar-inner">
        <div className="row" style={{ gap: 8 }}>
          <span className="filter-label" id="f-period">{t("Periode", "Period")}</span>
          <div role="group" aria-labelledby="f-period" className="segmented small-seg">
            {periods.map(([k, nl, en]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => set({ period: k })}>{t(nl, en)}</button>)}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="filter-label" id="f-source">{t("Bron", "Source")}</span>
          <div role="group" aria-labelledby="f-source" className="segmented small-seg">
            {sources.map(([k, nl, en]) => <button key={k} type="button" aria-pressed={source === k} onClick={() => set({ source: k })}>{t(nl, en)}</button>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "the last 4 weeks" style phrase for headings. */
export function usePeriodLabel() {
  const { t } = useLang();
  const { period } = useFilters();
  return period === 4 ? t("afgelopen 4 weken", "last 4 weeks") : period === 13 ? t("afgelopen 3 maanden", "last 3 months") : t("afgelopen 12 maanden", "last 12 months");
}
