import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../hooks/useLang";
import { LAYER_HELP, LAYER_LABEL, PLATFORM_LABEL } from "../i18n/messages";
import type { Headline, Layer, SourceRef } from "../types";
import { fmtDate, fmtInt } from "../utils/format";

const LAYER_MARK: Record<Layer, ReactNode> = {
  fact: <rect x="0" y="0" width="8" height="8" fill="currentColor" />,
  data: <circle cx="4" cy="4" r="4" fill="currentColor" />,
  analysis: <path d="M4 0 8 8H0z" fill="currentColor" />,
  interpretation: <path d="M4 0 8 4 4 8 0 4z" fill="none" stroke="currentColor" strokeWidth="1.4" />,
};

/** Marks what kind of statement a block is: fact, data, analysis or interpretation. Shape, border and colour all
 * differ, so the distinction survives without colour vision. */
export function LayerTag({ layer }: { layer: Layer }) {
  const { lang } = useLang();
  return (
    <span className={`layer layer-${layer}`} title={LAYER_HELP[lang][layer]}>
      <svg viewBox="0 0 8 8" aria-hidden="true">{LAYER_MARK[layer]}</svg>
      {LAYER_LABEL[lang][layer]}
      <span className="sr-only">: {LAYER_HELP[lang][layer]}</span>
    </span>
  );
}

/** Provenance under a block: one short line naming the source, with date, verification and method on demand. */
export function Source({ sources, method }: { sources: SourceRef[]; method?: string }) {
  const { lang, t } = useLang();
  const unverified = sources.some((s) => s.verification === "unverified" || s.verification === "demo");
  return (
    <details className="source-d">
      <summary>
        <span>{t("Bron", "Source")}: {sources.map((s) => s.name.split(":")[0]).join(", ")}</span>
        {unverified && <span className="verify">{t("te verifiëren", "to verify")}</span>}
      </summary>
      <dl className="source">
        <dt>{t("Bron", "Source")}</dt>
        <dd>
          {sources.map((s, i) => (
            <span key={s.name + i}>
              {i > 0 && "; "}
              {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}
              {(s.published ?? s.updated) && <> ({fmtDate((s.published ?? s.updated)!, lang)})</>}
              {s.verification === "unverified" && <span className="verify"> {t("nog te verifiëren", "to be verified")}</span>}
              {s.note && <span className="muted">. {s.note}</span>}
            </span>
          ))}
        </dd>
        {method && <><dt>{t("Methode", "Method")}</dt><dd>{method}</dd></>}
      </dl>
    </details>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  const { t } = useLang();
  return (
    <nav className="breadcrumbs" aria-label={t("Kruimelpad", "Breadcrumb")}>
      <ol>
        {items.map((it, i) => (
          <li key={it.label}>
            {it.to && i < items.length - 1 ? <Link to={it.to}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty" role="status"><strong>{title}</strong>{children}</div>;
}

export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function PageSkeleton() {
  const { t } = useLang();
  return (
    <div className="page" aria-busy="true">
      <p className="sr-only" role="status">{t("Laden…", "Loading…")}</p>
      <Skeleton height={14} width={160} style={{ marginTop: 32 }} />
      <Skeleton height={56} width="60%" style={{ marginTop: 16 }} />
      <Skeleton height={20} width="40%" style={{ marginTop: 16 }} />
      <Skeleton height={260} style={{ marginTop: 40 }} />
    </div>
  );
}

export function ErrorState({ error }: { error: Error }) {
  const { t } = useLang();
  return (
    <div className="page" style={{ paddingTop: 48 }}>
      <div className="empty" role="alert">
        <strong>{t("De gegevens konden niet worden geladen.", "The data could not be loaded.")}</strong>
        {t("Herlaad de pagina. Blijft het misgaan, dan ligt het aan ons, niet aan u.",
          "Reload the page. If it keeps failing, the problem is on our side.")}
        <div className="mono xs" style={{ marginTop: 8 }}>{error.message}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, layer }: { label: string; value: ReactNode; sub?: ReactNode; layer?: Layer }) {
  return (
    <div className="stat">
      <div className="split"><span className="label">{label}</span>{layer && <LayerTag layer={layer} />}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/** Tone split of a set of items. Always labelled as analysis because the labels are model estimates. */
export function ToneBar({ n, pos, neg, label }: { n: number; pos: number; neg: number; label?: string }) {
  const { lang, t } = useLang();
  if (!n) return null;
  const p = (100 * pos) / n, q = (100 * neg) / n;
  const desc = `${label ? label + ": " : ""}${Math.round(p)}% ${t("positief", "positive")}, ${Math.round(100 - p - q)}% ${t("neutraal", "neutral")}, ${Math.round(q)}% ${t("negatief", "negative")} (${fmtInt(n, lang)} ${t("items", "items")})`;
  return (
    <div>
      <div className="tonebar" role="img" aria-label={desc}>
        <span style={{ width: `${p}%`, background: "var(--tone-pos)" }} />
        <span style={{ width: `${100 - p - q}%`, background: "var(--tone-neu)" }} />
        <span style={{ width: `${q}%`, background: "var(--tone-neg)" }} />
      </div>
      <div className="row xs mono muted" style={{ marginTop: 4, gap: 12 }}>
        <span><span className="swatch" style={{ background: "var(--tone-pos)" }} /> {Math.round(p)}% {t("pos.", "pos.")}</span>
        <span><span className="swatch" style={{ background: "var(--tone-neu)" }} /> {Math.round(100 - p - q)}% {t("neutr.", "neutr.")}</span>
        <span><span className="swatch" style={{ background: "var(--tone-neg)" }} /> {Math.round(q)}% {t("neg.", "neg.")}</span>
      </div>
    </div>
  );
}

export function HeadlineList({ items, empty }: { items: Headline[]; empty?: string }) {
  const { lang, t } = useLang();
  if (!items.length) return <EmptyState title={empty ?? t("Geen berichten die bij deze filters passen.", "No items match these filters.")} />;
  return (
    <ul className="headlines">
      {items.map((h) => (
        <li key={h.url}>
          <a href={h.url} target="_blank" rel="noreferrer">
            <div className="hl-title">{h.title}</div>
            <div className="hl-meta">
              <span>{h.source}</span><span>{fmtDate(h.date, lang)}</span><span>{PLATFORM_LABEL[h.platform] ?? h.platform}</span>
              <span className="sr-only">{t("(opent in nieuw venster)", "(opens in new window)")}</span>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SectionHead({ kicker, title, children, aside }: { kicker?: string; title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        {kicker && <div className="kicker">{kicker}</div>}
        <h2 className="h2" style={{ marginTop: kicker ? 8 : 0 }}>{title}</h2>
        {children && <p>{children}</p>}
      </div>
      {aside && <div>{aside}</div>}
    </div>
  );
}

export function Delta({ value }: { value: number | null }) {
  const { lang, t } = useLang();
  if (value == null) return <span className="delta muted" title={t("Te weinig berichten om te vergelijken", "Too few items to compare")}>–</span>;
  const pct = Math.round(value * 100);
  return (
    <span className={`delta ${pct > 0 ? "delta-up" : pct < 0 ? "delta-down" : ""}`}>
      {(pct > 0 ? "+" : pct < 0 ? "−" : "±") + Math.abs(pct).toLocaleString(lang === "nl" ? "nl-NL" : "en-GB")}%
    </span>
  );
}
