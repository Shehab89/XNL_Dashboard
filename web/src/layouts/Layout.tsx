import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { PageSkeleton } from "../components/ui";
import { SearchPalette } from "../components/SearchPalette";
import { useLang } from "../hooks/useLang";
import { useMonitor } from "../hooks/useMonitor";
import { fmtDate, fmtInt } from "../utils/format";

const NAV: [string, string, string][] = [
  ["/", "Overzicht", "Overview"],
  ["/politiek", "Politiek", "Politics"],
  ["/partijen", "Partijen", "Parties"],
  ["/politici", "Politici", "Politicians"],
  ["/parlement", "Parlement", "Parliament"],
  ["/onderwerpen", "Onderwerpen", "Topics"],
  ["/tijdlijn", "Tijdlijn", "Timeline"],
  ["/data", "Methode", "Method"],
];

function BrandMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" fill="var(--ink)" />
      <g fill="var(--paper)">
        <circle cx="6" cy="23" r="2" /><circle cx="8.6" cy="15.5" r="2" /><circle cx="15.5" cy="10" r="2" />
        <circle cx="22.4" cy="15.5" r="2" /><circle cx="25" cy="23" r="2" fill="var(--red)" />
        <circle cx="11.5" cy="23" r="1.6" /><circle cx="13" cy="18" r="1.6" /><circle cx="18" cy="18" r="1.6" /><circle cx="19.5" cy="23" r="1.6" />
      </g>
    </svg>
  );
}

export function Layout() {
  const { lang, setLang, t } = useLang();
  const state = useMonitor();
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => { setDrawer(false); window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); setPalette(true); }
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const navLinks = NAV.map(([to, nl, en]) => (
    <NavLink key={to} to={to} end={to === "/"}>{t(nl, en)}</NavLink>
  ));

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        {t("Naar de inhoud", "Skip to content")}
      </a>
      <header className="masthead">
        <div className="page masthead-inner">
          <Link to="/" className="brand" aria-label={t("Politiek Monitor, naar overzicht", "Politiek Monitor, go to overview")}>
            <BrandMark />
            <span className="brand-name">Politiek Monitor <em>Nederland</em></span>
          </Link>
          <nav className="nav" aria-label={t("Hoofdmenu", "Main menu")}>{navLinks}</nav>
          <div className="masthead-tools">
            <button type="button" className="search-trigger" onClick={() => setPalette(true)} aria-haspopup="dialog">
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="2" /></svg>
              <span className="label">{t("Zoeken", "Search")}</span>
              <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
            </button>
            <div className="lang-switch" role="group" aria-label={t("Taal", "Language")}>
              <button type="button" aria-pressed={lang === "nl"} onClick={() => setLang("nl")} lang="nl">NL</button>
              <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en">EN</button>
            </div>
            <button type="button" className="menu-button" aria-expanded={drawer} aria-controls="drawer" onClick={() => setDrawer(true)}>
              <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M0 1h16M0 6h16M0 11h16" stroke="currentColor" strokeWidth="1.6" /></svg>
              {t("Menu", "Menu")}
            </button>
          </div>
        </div>
      </header>
      <div className="freshness" role="note">
        <div className="page">
          <span><span aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, background: "var(--blue)", marginRight: 6, verticalAlign: 1 }} />
            {t("Momentopname, geen live data", "Snapshot, not live data")}</span>
          {state.status === "ready" && <>
            <span>{t("Berichten t/m", "Coverage up to")} {fmtDate(state.data.totals.lastItem.slice(0, 10), lang)}</span>
            <span>{fmtInt(state.data.totals.items, lang)} {t("berichten sinds", "items since")} {fmtDate(state.data.totals.firstDay, lang)}</span>
          </>}
          <span>{t("Kamerdata (moties, stemmingen): nog niet gekoppeld", "Parliamentary records (motions, votes): not connected yet")}</span>
        </div>
      </div>

      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <div className="drawer" id="drawer" role="dialog" aria-modal="true" aria-label={t("Menu", "Menu")}>
            <div className="split" style={{ marginBottom: 16 }}>
              <span className="kicker">{t("Menu", "Menu")}</span>
              <button type="button" className="btn" onClick={() => setDrawer(false)} autoFocus>{t("Sluiten", "Close")}</button>
            </div>
            <nav aria-label={t("Hoofdmenu", "Main menu")}>{navLinks}</nav>
          </div>
        </>
      )}

      <main id="main" tabIndex={-1} style={{ outline: "none" }}>
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="footer">
        <div className="page grid-12">
          <div className="span-5">
            <div className="row" style={{ marginBottom: 10 }}><BrandMark /><span className="brand-name">Politiek Monitor</span></div>
            <p className="prose" style={{ margin: 0 }}>
              {t("Een onafhankelijke, niet-partijgebonden kaart van wat er over de Nederlandse politiek wordt gepubliceerd. Gemaakt door EinData (Shehab Al-Masri). Elke grafiek noemt zijn bron; analyse en duiding zijn als zodanig gemarkeerd.",
                "An independent, non-partisan map of what is published about Dutch politics. Made by EinData (Shehab Al-Masri). Every chart names its source; analysis and interpretation are marked as such.")}
            </p>
          </div>
          <div className="span-3">
            <h2>{t("Verkennen", "Explore")}</h2>
            <ul>{NAV.slice(1, 7).map(([to, nl, en]) => <li key={to}><Link to={to}>{t(nl, en)}</Link></li>)}</ul>
          </div>
          <div className="span-4">
            <h2>{t("Verantwoording", "Accountability")}</h2>
            <ul>
              <li><Link to="/data">{t("Bronnen en methode", "Sources and method")}</Link></li>
              <li><Link to="/data#lagen">{t("Feit, data, analyse, duiding", "Fact, data, analysis, interpretation")}</Link></li>
              <li><Link to="/data#beperkingen">{t("Beperkingen", "Limitations")}</Link></li>
              <li><a href="https://github.com/Shehab89/xnl_dashboard" target="_blank" rel="noreferrer">{t("Broncode (GitHub)", "Source code (GitHub)")}</a></li>
            </ul>
          </div>
        </div>
      </footer>
      <SearchPalette open={palette} onClose={() => setPalette(false)} />
    </>
  );
}
