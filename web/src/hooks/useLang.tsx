import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Lang } from "../i18n/messages";

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; t: (nl: string, en: string) => string }
const Ctx = createContext<LangCtx | null>(null);

function initial(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "en" || q === "nl") return q;
    const stored = window.localStorage.getItem("lang");
    if (stored === "en" || stored === "nl") return stored;
  } catch { /* storage can be blocked; Dutch is the default */ }
  return "nl";
}

/** Dutch first, English second. Texts live next to the component that shows them: t("Dutch", "English"). */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { window.localStorage.setItem("lang", l); } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const t = useCallback((nl: string, en: string) => (lang === "nl" ? nl : en), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLang outside LangProvider");
  return ctx;
}
