import type { Lang } from "../i18n/messages";

const locale = (lang: Lang) => (lang === "nl" ? "nl-NL" : "en-GB");

export const fmtInt = (n: number, lang: Lang) => n.toLocaleString(locale(lang));

export const fmtPct = (x: number, lang: Lang, digits = 0) =>
  (x * 100).toLocaleString(locale(lang), { maximumFractionDigits: digits }) + "%";

export const fmtSigned = (x: number, lang: Lang, digits = 0) =>
  (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x).toLocaleString(locale(lang), { maximumFractionDigits: digits });

export const fmtChange = (x: number, lang: Lang) => fmtSigned(Math.round(x * 100), lang) + "%";

export function fmtDate(iso: string, lang: Lang, style: "long" | "short" | "month" = "long") {
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  const opts: Intl.DateTimeFormatOptions =
    style === "long" ? { day: "numeric", month: "long", year: "numeric" }
      : style === "short" ? { day: "numeric", month: "short" }
        : { month: "short", year: "2-digit" };
  return d.toLocaleDateString(locale(lang), opts);
}

/** "week of 6 Oct" style label for a Monday. */
export const fmtWeek = (iso: string, lang: Lang) => (lang === "nl" ? "week van " : "week of ") + fmtDate(iso, lang, "short");

export const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};
