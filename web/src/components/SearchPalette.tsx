import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLang } from "../hooks/useLang";
import { useMonitor } from "../hooks/useMonitor";
import { buildIndex, search } from "../services/search";
import type { SearchKind, SearchResult } from "../types";

export const KIND_LABEL: Record<SearchKind, [string, string]> = {
  party: ["Partijen", "Parties"], politician: ["Politici", "Politicians"], topic: ["Onderwerpen", "Topics"],
  term: ["Begrippen", "Terms"], page: ["Pagina's", "Pages"], event: ["Tijdlijn", "Timeline"], headline: ["Berichten", "Coverage"],
};
const KIND_ORDER: SearchKind[] = ["party", "politician", "topic", "term", "event", "page", "headline"];
const KIND_GLYPH: Record<SearchKind, string> = { party: "◼", politician: "●", topic: "◆", term: "§", page: "↗", event: "◷", headline: "¶" };

/** Groups results by kind (people, parties, topics first) while keeping the ranking inside each group. */
export function groupResults(results: SearchResult[]) {
  return KIND_ORDER.map((k) => ({ kind: k, items: results.filter((r) => r.kind === k) })).filter((g) => g.items.length);
}

/** Command palette: ⌘K / Ctrl+K or "/" opens it, arrows move, Enter opens, Esc closes. */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang, t } = useLang();
  const state = useMonitor();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const index = useMemo(() => buildIndex(state.status === "ready" ? state.data : null, lang), [state, lang]);
  const results = useMemo(() => search(index, q, 30), [index, q]);
  const groups = groupResults(results.filter((r) => r.kind !== "headline").slice(0, 14).concat(results.filter((r) => r.kind === "headline").slice(0, 5)));
  const flat = groups.flatMap((g) => g.items);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    setQ(""); setSel(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => { window.clearTimeout(id); restoreRef.current?.focus?.(); };
  }, [open]);
  useEffect(() => setSel(0), [q]);

  if (!open) return null;

  const go = (r: SearchResult) => {
    onClose();
    if (r.external) window.open(r.href, "_blank", "noreferrer");
    else navigate(r.href);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[sel]) go(flat[sel]);
      else if (q.trim()) { onClose(); navigate(`/zoeken?q=${encodeURIComponent(q.trim())}`); }
    } else if (e.key === "Tab") {
      // Keep focus inside the dialog: the input is the only tab stop, results are reached with the arrows.
      e.preventDefault();
    }
  };

  let k = -1;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t("Zoeken", "Search")} onKeyDown={onKey}>
        <div className="palette-input">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="2" /></svg>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} role="combobox" aria-expanded={flat.length > 0}
            aria-controls="palette-list" aria-activedescendant={flat[sel] ? `pr-${sel}` : undefined} aria-autocomplete="list"
            placeholder={t("Partij, politicus, onderwerp of begrip…", "Party, politician, topic or term…")} />
          <kbd className="mono xs muted">esc</kbd>
        </div>
        <div className="palette-results" id="palette-list" role="listbox" aria-label={t("Resultaten", "Results")}>
          {q.trim().length < 2 && (
            <div className="palette-group">{t("Probeer: wonen, Wilders, motie, stikstof, asylum", "Try: housing, Wilders, motie, nitrogen, asylum")}</div>
          )}
          {q.trim().length >= 2 && !flat.length && (
            <div style={{ padding: "14px 16px" }} className="small">
              {t("Niets gevonden. Druk op Enter om in alle berichten te zoeken.", "Nothing found. Press Enter to search all coverage.")}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.kind} role="group" aria-label={KIND_LABEL[g.kind][lang === "nl" ? 0 : 1]}>
              <div className="palette-group" aria-hidden="true">{KIND_LABEL[g.kind][lang === "nl" ? 0 : 1]}</div>
              {g.items.map((r) => {
                k += 1;
                const i = k;
                return (
                  <a key={r.kind + r.id} id={`pr-${i}`} role="option" aria-selected={i === sel} className="palette-item" href={r.external ? r.href : `#${r.href}`}
                    onMouseMove={() => setSel(i)} onClick={(e) => { e.preventDefault(); go(r); }} tabIndex={-1}>
                    <span className="muted mono" aria-hidden="true">{KIND_GLYPH[r.kind]}</span>
                    <span style={{ minWidth: 0 }}>
                      <span>{r.title}</span>
                      {r.subtitle && <span className="sub muted" style={{ display: "block" }}>{r.subtitle}</span>}
                    </span>
                    <span className="muted xs mono">{r.external ? "↗" : ""}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot" aria-hidden="true">
          <span>↑↓ {t("kiezen", "move")}</span><span>↵ {t("openen", "open")}</span><span>esc {t("sluiten", "close")}</span>
        </div>
      </div>
    </div>
  );
}
