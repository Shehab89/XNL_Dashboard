import { useEffect, useState } from "react";
import { useLang } from "../hooks/useLang";
import { fetchMotions } from "../services/parliament";
import type { Motion, ParliamentFeed } from "../types";
import { fmtDate } from "../utils/format";
import { EmptyState, LayerTag, Source } from "./ui";

/** Motions and votes for a party, person or topic. Shows the real records once the Tweede Kamer feed is connected and
 * says so plainly until then, instead of showing invented examples. */
export function ParliamentPanel({ filter, label }: { filter: { partyId?: string; topicId?: string; personId?: string }; label: string }) {
  const { lang, t } = useLang();
  const [feed, setFeed] = useState<ParliamentFeed<Motion> | null>(null);
  const key = JSON.stringify(filter);
  useEffect(() => {
    let alive = true;
    fetchMotions(JSON.parse(key)).then((f) => alive && setFeed(f));
    return () => { alive = false; };
  }, [key]);

  return (
    <div className="panel">
      <div className="panel-head">
        <div><h3>{t("Moties en stemmingen", "Motions and votes")}</h3><p>{label}</p></div>
        <LayerTag layer="fact" />
      </div>
      {!feed && <div className="skeleton" style={{ height: 80 }} aria-hidden="true" />}
      {feed?.status === "not_connected" && (
        <EmptyState title={t("Nog niet gekoppeld", "Not connected yet")}>
          {t("Moties, amendementen en stemuitslagen komen uit het Gegevensmagazijn van de Tweede Kamer. Die koppeling is voorbereid maar nog niet actief, dus hier staan bewust geen voorbeelden.",
            "Motions, amendments and vote results come from the House of Representatives' open data. The connection is prepared but not active yet, so this panel deliberately shows no examples.")}
        </EmptyState>
      )}
      {feed?.status === "connected" && (feed.items.length ? (
        <ul className="headlines">
          {feed.items.map((m) => (
            <li key={m.id}><a href={m.url} target="_blank" rel="noreferrer">
              <div className="hl-title">{m.title}</div>
              <div className="hl-meta"><span>{fmtDate(m.date, lang)}</span>{m.result && <span>{m.result}</span>}</div>
            </a></li>
          ))}
        </ul>
      ) : <EmptyState title={t("Geen moties in deze periode.", "No motions in this period.")} />)}
      {feed && <Source sources={[feed.source]} />}
    </div>
  );
}
