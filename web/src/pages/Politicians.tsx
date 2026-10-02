import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkline } from "../components/charts/Sparkline";
import { usePeriodLabel } from "../components/FilterBar";
import { Breadcrumbs, Delta, EmptyState, LayerTag, Source } from "../components/ui";
import { WithData } from "../components/WithData";
import { PARTIES, POLITICIANS, partyById, topicById } from "../data/reference";
import { useFilters } from "../hooks/useFilters";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";
import { MONITOR_SOURCE, type MonitorData } from "../services/monitor";
import { chartStart } from "../utils/filters";
import { fmtInt, fold } from "../utils/format";
import { rank } from "../utils/insights";

export default function Politicians() {
  const { t } = useLang();
  useTitle(t("Politici", "Politicians"));
  return <WithData>{(d) => <PoliticiansView data={d} />}</WithData>;
}

function PoliticiansView({ data }: { data: MonitorData }) {
  const { lang, t } = useLang();
  const f = useFilters();
  const periodLabel = usePeriodLabel();
  const [q, setQ] = useState("");
  const [party, setParty] = useState("");
  const [role, setRole] = useState<"all" | "cabinet" | "leaders">("all");
  const from = chartStart(data.weeks.length, f.period);
  const rows = useMemo(() => {
    const att = new Map(rank(data.politician, f, data.partialWeek).map((m) => [m.id, m]));
    return POLITICIANS
      .filter((p) => (!party || p.partyId === party) && (!q || fold(p.name).includes(fold(q))))
      .filter((p) => role === "all" || (role === "cabinet" ? /premier|minister/i.test(p.role) : /fractievoorzitter/i.test(p.role)))
      .map((p) => {
        const top = data.personTopics.filter((l) => l.from === p.id).sort((a, b) => b.n - a.n)[0];
        return { p, m: att.get(p.id)!, top };
      })
      .sort((a, b) => b.m.recent - a.m.recent);
  }, [data, f, q, party, role]);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: t("Overzicht", "Overview"), to: "/" }, { label: t("Politici", "Politicians") }]} />
      <h1 className="display h1" style={{ marginBottom: 24 }}>{t("Politici", "Politicians")}</h1>
      <div className="row" style={{ marginBottom: 16, alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 200px", maxWidth: 280 }}>
          <label htmlFor="polq">{t("Naam", "Name")}</label>
          <input id="polq" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Bijvoorbeeld Bikker", "For example Bikker")} />
        </div>
        <div className="field" style={{ flex: "0 1 200px" }}>
          <label htmlFor="polp">{t("Partij", "Party")}</label>
          <select id="polp" className="input" value={party} onChange={(e) => setParty(e.target.value)}>
            <option value="">{t("Alle partijen", "All parties")}</option>
            {PARTIES.filter((p) => POLITICIANS.some((x) => x.partyId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div role="group" aria-label={t("Rol", "Role")} className="segmented">
          {([["all", "Iedereen", "Everyone"], ["cabinet", "Kabinet", "Cabinet"], ["leaders", "Fractievoorzitters", "Group leaders"]] as const).map(([k, nl, en]) => (
            <button key={k} type="button" aria-pressed={role === k} onClick={() => setRole(k)}>{t(nl, en)}</button>
          ))}
        </div>
      </div>
      <div className="row xs mono muted" style={{ justifyContent: "flex-end", gap: 10, marginBottom: 6 }}>
        <span>{t(`Berichten, ${periodLabel}`, `Items, ${periodLabel}`)}</span><LayerTag layer="data" />
      </div>
      {rows.length ? (
        <ol className="index-list">
          {rows.map(({ p, m, top }, i) => {
            const pt = partyById.get(p.partyId);
            return (
              <li key={p.id}>
                <Link to={`/politici/${p.id}`} className="index-row">
                  <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="name">{p.name}</span>
                    <span className="meta" style={{ display: "block" }}><span className="swatch" style={{ background: pt?.color, marginRight: 6 }} />{pt?.name} · {p.role}</span>
                  </span>
                  <span className="hide-sm small">
                    {top ? <>{t("Vooral over", "Mostly on")} <strong>{lang === "nl" ? topicById.get(top.to)?.name : topicById.get(top.to)?.nameEn}</strong></> : <span className="muted">–</span>}
                    <Sparkline values={m.weekly.slice(from)} color={pt?.color} width={110} />
                  </span>
                  <span className="figure hide-sm"><Delta value={m.change} /></span>
                  <span className="figure">{fmtInt(m.recent, lang)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : <EmptyState title={t("Niemand gevonden.", "Nobody found.")} />}
      <Source sources={[MONITOR_SOURCE]} method={t("Een bericht telt mee als de naam erin staat (regels in config/entities.yaml).", "An item counts when the name appears in it (rules in config/entities.yaml).")} />
    </div>
  );
}
