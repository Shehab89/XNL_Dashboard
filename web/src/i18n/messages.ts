export type Lang = "nl" | "en";

/** Platform names as readers know them. */
export const PLATFORM_LABEL: Record<string, string> = {
  google_news: "Google News", news: "Nieuwssites (RSS)", gdelt: "GDELT", mastodon: "Mastodon", youtube: "YouTube",
  reddit: "Reddit", telegram: "Telegram", bluesky: "Bluesky", x: "X",
};

export const LAYER_LABEL: Record<Lang, Record<string, string>> = {
  nl: { fact: "Feit", data: "Data", analysis: "Analyse", interpretation: "Duiding" },
  en: { fact: "Fact", data: "Data", analysis: "Analysis", interpretation: "Interpretation" },
};

export const LAYER_HELP: Record<Lang, Record<string, string>> = {
  nl: {
    fact: "Vastgesteld door een officiële bron (Kiesraad, Tweede Kamer, Rijksoverheid).",
    data: "Geteld door de monitor uit openbare bronnen. Exact herleidbaar.",
    analysis: "Ingeschat door een model (AI of trefwoorden). Kan fouten bevatten.",
    interpretation: "Een redactionele lezing. Altijd als mening te beschouwen.",
  },
  en: {
    fact: "Established by an official source (Electoral Council, House of Representatives, government).",
    data: "Counted by the monitor from public sources. Fully traceable.",
    analysis: "Estimated by a model (AI or keywords). May contain errors.",
    interpretation: "An editorial reading. Always to be treated as opinion.",
  },
};
