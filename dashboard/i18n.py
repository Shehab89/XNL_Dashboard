"""Dutch translations of the dashboard's texts. English is written in the code; `t()` returns the Dutch text when
the dashboard is switched to Nederlands. A text without a translation is shown in English."""

NL = {
    # data-quality notes
    "**{share} of these items have AI labels.** The rest are labelled by a simpler keyword model that marks more headlines negative than the AI does, so tone here leans negative. AI labelling catches up every run; switch on *AI-labelled only* in the sidebar for the most reliable tone.":
        "**{share} van deze items heeft een AI-label.** De rest is gelabeld door een eenvoudiger trefwoordmodel dat meer koppen negatief noemt dan de AI, dus de toon valt hier negatiever uit. De AI haalt elke run een deel in; zet *alleen AI-gelabeld* aan in de zijbalk voor de betrouwbaarste toon.",
    "average {value}": "gemiddeld {value}",
    "Share of voice counts items that mention a party. Net sentiment = % positive items − % negative items; bubble size = number of mentions; the whisker shows the statistical uncertainty. Compare a party with the dashed average line rather than with zero: headlines are on balance negative for everyone.":
        "Share of voice telt items die een partij noemen. Netto sentiment = % positieve − % negatieve items; bolgrootte = aantal vermeldingen; de streep toont de statistische onzekerheid. Vergelijk een partij met de gestippelde gemiddelde lijn in plaats van met nul: koppen zijn per saldo voor iedereen negatief.",
    "The dotted line marks {day}: before it the history was collected once from weekly news searches, after it the regular collection runs every 6 hours. Compare tone across the line, not volume.":
        "De stippellijn markeert {day}: daarvoor is de geschiedenis één keer verzameld met wekelijkse nieuwszoekopdrachten, daarna loopt de reguliere verzameling elke 6 uur. Vergelijk over de lijn heen de toon, niet het volume.",
    # page and sidebar
    "Dutch Political Media Monitor": "Politieke Mediamonitor Nederland",
    "Political Media Monitor": "Politieke Mediamonitor",
    "Dutch politics · news & social media": "Nederlandse politiek · nieuws & sociale media",
    "Media Monitor": "Mediamonitor",
    "Language": "Taal",
    "Time": "Periode",
    "Period": "Periode",
    "From": "Van",
    "To": "Tot en met",
    "Last 24 hours": "Laatste 24 uur",
    "Last 7 days": "Laatste 7 dagen",
    "Last 30 days": "Laatste 30 dagen",
    "Last 90 days": "Laatste 90 dagen",
    "Last 6 months": "Laatste 6 maanden",
    "Last 12 months": "Laatste 12 maanden",
    "All data": "Alle data",
    "Custom dates": "Eigen datums",
    "Sources": "Bronnen",
    "Channel": "Kanaal",
    "All": "Alles",
    "News media": "Nieuwsmedia",
    "Social media": "Sociale media",
    "Platforms": "Platforms",
    "Outlets / channels": "Media / kanalen",
    "All outlets and channels": "Alle media en kanalen",
    "Sorted by number of items in the chosen period.": "Gesorteerd op aantal items in de gekozen periode.",
    "Topics": "Onderwerpen",
    "Parties": "Partijen",
    "Charts compare these parties. Default: the 8 most-mentioned in the period.":
        "De grafieken vergelijken deze partijen. Standaard: de 8 meest genoemde in de periode.",
    "Only items about these parties": "Alleen items over deze partijen",
    "Issues": "Thema's",
    "All issues": "Alle thema's",
    "Content": "Inhoud",
    "Tone": "Toon",
    "Search text": "Zoek in tekst",
    "e.g. huurprijzen, Schoof, asiel": "bijv. huurprijzen, Schoof, asiel",
    "Only AI-labelled items": "Alleen items gelabeld door AI",
    "Items whose party, issue and tone were judged by the AI model, not by keywords.":
        "Items waarvan partij, thema en toon door het AI-model zijn beoordeeld, niet via trefwoorden.",
    "Showing **fictional demo data**. Run the pipeline to collect real data (see README).":
        "Je ziet **fictieve demodata**. Start de pipeline om echte data te verzamelen (zie README).",
    "Data: {store} · {n} items loaded · newest {newest}": "Data: {store} · {n} items geladen · nieuwste {newest}",
    "Could not read {store}: {error}": "Kon {store} niet lezen: {error}",
    "↻ Refresh": "↻ Vernieuwen",
    "Reset filters": "Filters wissen",
    "Loading data…": "Data laden…",
    # header
    "{n} items": "{n} items",
    "per day": "per dag",
    "per week": "per week",
    "{n} of {total} platforms": "{n} van {total} platforms",
    "{n} outlets": "{n} media",
    "only selected parties": "alleen gekozen partijen",
    "tone: {tones}": "toon: {tones}",
    "AI-labelled only": "alleen AI-gelabeld",
    "**Demo mode:** the numbers below are generated from fictional posts and invented outlets, only to show what "
    "the dashboard does. Real data appears after the first pipeline run.":
        "**Demomodus:** de cijfers hieronder komen uit verzonnen berichten en verzonnen media, alleen om te laten zien "
        "wat het dashboard doet. Echte data verschijnt na de eerste run van de pipeline.",
    "No items match the current filters. Widen the dates or remove a filter (or press Reset filters).":
        "Geen items voor deze filters. Kies een ruimere periode of haal een filter weg (of klik Filters wissen).",
    # tabs
    "🧭 Briefing": "🧭 Overzicht",
    "📈 Trends": "📈 Trends",
    "🗳️ Parties": "🗳️ Partijen",
    "📌 Issues": "📌 Thema's",
    "📰 Media landscape": "📰 Medialandschap",
    "💬 Narratives": "💬 Narratieven",
    "🔎 Explorer": "🔎 Verkenner",
    "ℹ️ Methodology": "ℹ️ Methode",
    # briefing
    "Items": "Items",
    "Net tone": "Netto toon",
    "{share} negative": "{share} negatief",
    "% positive − % negative items": "% positieve − % negatieve items",
    "Social media share": "Aandeel sociale media",
    "{n} posts": "{n} berichten",
    "Most discussed": "Meest besproken",
    "{share} share of voice": "{share} share of voice",
    "Top issue": "Grootste thema",
    "{share} of issue mentions": "{share} van de thema-vermeldingen",
    "Key findings": "Belangrijkste bevindingen",
    "🚨 Alerts (last 24 hours)": "🚨 Signalen (laatste 24 uur)",
    "party": "partij",
    "issue": "thema",
    "tone {shift} pts vs. usual": "toon {shift} punten t.o.v. normaal",
    "tone unchanged": "toon onveranderd",
    "<b>{name}</b> ({kind}): <b>{recent}</b> mentions vs. ~{typical} normally ({ratio}×); {tone}.":
        "<b>{name}</b> ({kind}): <b>{recent}</b> vermeldingen vs. ~{typical} normaal ({ratio}×); {tone}.",
    "No unusual spikes: every party and issue is within its normal range.":
        "Geen uitschieters: alle partijen en thema's zitten binnen hun normale bandbreedte.",
    "Share of voice: mentions per party": "Share of voice: vermeldingen per partij",
    "Mentions": "Vermeldingen",
    "Net sentiment per party (±95% interval)": "Netto sentiment per partij (±95%-interval)",
    "% positive − % negative": "% positief − % negatief",
    "Net sentiment {value}": "Netto sentiment {value}",
    "{n} mentions": "{n} vermeldingen",
    "positive {pos} · negative {neg}": "positief {pos} · negatief {neg}",
    # trends
    "Choose a longer period to see trends.": "Kies een langere periode om trends te zien.",
    "Items per {unit}, by tone": "Items per {unit}, naar toon",
    "Items per {unit}": "Items per {unit}",
    "Overall net tone per {unit}": "Netto toon per {unit}",
    "net tone {value}": "netto toon {value}",
    "Attention per party and {unit}": "Aandacht per partij en {unit}",
    "Attention per issue and {unit}": "Aandacht per thema en {unit}",
    "{z} mentions": "{z} vermeldingen",
    "Darker cells = more mentions. Read a row left to right to see when a party or issue was in the news; read a "
    "column to see what dominated that {unit}.":
        "Donkerder = meer vermeldingen. Lees een rij van links naar rechts om te zien wanneer een partij of thema in "
        "het nieuws was; lees een kolom om te zien wat die {unit} domineerde.",
    "Where the items came from, per {unit}": "Waar de items vandaan kwamen, per {unit}",
    "day": "dag",
    "week": "week",
    # parties
    "Attention over time": "Aandacht door de tijd",
    "Mentions per {unit}": "Vermeldingen per {unit}",
    " (3-day average)": " (3-daags gemiddelde)",
    "Net sentiment per week": "Netto sentiment per week",
    "Net sentiment, 7-day rolling": "Netto sentiment, voortschrijdend 7 dagen",
    "Daily net sentiment": "Netto sentiment per dag",
    " (first 6 selected parties)": " (eerste 6 gekozen partijen)",
    "Net sentiment": "Netto sentiment",
    "Choose a period of 7 days or more to see trends.": "Kies een periode van 7 dagen of meer om trends te zien.",
    "Momentum: share of voice, last 7 days vs. the 7 days before":
        "Momentum: share of voice, laatste 7 dagen vs. de 7 dagen ervoor",
    "Change in share of voice (pts)": "Verandering in share of voice (procentpunt)",
    "Tone of coverage": "Toon van de berichtgeving",
    "News vs. social media tone": "Toon in nieuws vs. sociale media",
    "Where is a party judged more harshly?": "Waar wordt een partij harder beoordeeld?",
    "A long line means the party is judged very differently by journalists and by the public online.":
        "Een lange lijn betekent dat journalisten en het publiek online de partij heel verschillend beoordelen.",
    "Needs both news and social items for the selected parties.":
        "Hiervoor zijn zowel nieuws- als social-items over de gekozen partijen nodig.",
    "Issue profile per party": "Themaprofiel per partij",
    "Share of each party's mentions that is about each issue": "Aandeel van de vermeldingen van een partij per thema",
    "Read across a row: which issues a party is linked to in the media (issue ownership).":
        "Lees een rij: met welke thema's een partij in de media wordt verbonden (issue ownership).",
    # issues
    "The political agenda: mentions per issue": "De politieke agenda: vermeldingen per thema",
    "Agenda gap": "Agendakloof",
    "← bigger in news · bigger on social →": "← groter in nieuws · groter op sociale media →",
    "Select both channels to compare the news agenda with the social-media agenda.":
        "Kies beide kanalen om de nieuwsagenda met de agenda op sociale media te vergelijken.",
    "Issues to compare over time": "Thema's om door de tijd te vergelijken",
    "Tone of the debate per issue": "Toon van het debat per thema",
    "Issue tone reflects how people and media talk about the topic (e.g. worry about housing), not support for a "
    "policy.": "De toon per thema laat zien hoe mensen en media over het onderwerp praten (bijv. zorgen over wonen), "
               "niet de steun voor beleid.",
    # media landscape
    "Where the items come from": "Waar de items vandaan komen",
    "Most active sources": "Meest actieve bronnen",
    "How each outlet covers each party": "Hoe elk medium over elke partij bericht",
    "Net sentiment by news outlet (blank = fewer than 4 articles)":
        "Netto sentiment per nieuwsmedium (leeg = minder dan 4 artikelen)",
    "Net": "Netto",
    "Differences between outlets can reflect editorial choices, but also which events they covered. Treat as a "
    "signal to investigate, not as proof of bias.":
        "Verschillen tussen media kunnen redactionele keuzes weerspiegelen, maar ook welke gebeurtenissen ze "
        "versloegen. Zie het als signaal om uit te zoeken, niet als bewijs van vooringenomenheid.",
    "Not enough news articles per outlet and party in this selection.":
        "Te weinig nieuwsartikelen per medium en partij in deze selectie.",
    "Which parties each outlet pays attention to": "Aan welke partijen elk medium aandacht besteedt",
    "Share of the outlet's party mentions": "Aandeel van de partijvermeldingen van het medium",
    # narratives
    "Subject": "Onderwerp",
    "All items": "Alle items",
    "Party: {name}": "Partij: {name}",
    "Issue: {name}": "Thema: {name}",
    "No items for this subject.": "Geen items voor dit onderwerp.",
    "Most used words & phrases": "Meest gebruikte woorden & woordcombinaties",
    "Emerging in the last 48 hours of the period": "Opkomend in de laatste 48 uur van de periode",
    "How much more frequent than before (log ratio)": "Hoeveel vaker dan ervoor (log-verhouding)",
    "No clearly emerging terms for this subject in the last 48 hours of the period.":
        "Geen duidelijk opkomende termen voor dit onderwerp in de laatste 48 uur van de periode.",
    "Most engaged social posts": "Social-berichten met de meeste interactie",
    "Latest headlines": "Laatste koppen",
    # explorer
    "{n} items match the filters in the sidebar (newest first; the table shows up to 3,000).":
        "{n} items voldoen aan de filters in de zijbalk (nieuwste eerst; de tabel toont er maximaal 3.000).",
    "Time ": "Tijd",
    "Platform": "Platform",
    "Source": "Bron",
    "Author": "Auteur",
    "Text": "Tekst",
    "Score": "Score",
    "Labelled by": "Gelabeld door",
    "keywords": "trefwoorden",
    "Engagement": "Interactie",
    "likes + 2×shares + replies": "likes + 2×shares + reacties",
    "Post": "Bericht",
    "Outlet": "Medium",
    "Headline": "Kop",
    "open ↗": "open ↗",
    "⬇️ Download selection (CSV)": "⬇️ Download selectie (CSV)",
    # values shown in charts, legends and tables
    "positive": "positief",
    "neutral": "neutraal",
    "negative": "negatief",
    "Positive": "Positief",
    "Neutral": "Neutraal",
    "Negative": "Negatief",
    "News sites (RSS)": "Nieuwssites (RSS)",
    "GDELT news": "GDELT-nieuws",
    "mentions": "vermeldingen",
    "items": "items",
    "share": "aandeel",
    "date": "datum",
    "parties": "partij",
    "issues": "thema",
    "channel": "kanaal",
    "sentiment": "toon",
    "tone": "toon",
    "platform_label": "platform",
    "source": "bron",
    "change": "verandering",
    "net": "netto",
    "gap": "verschil",
    "news": "nieuws",
    "social": "sociaal",
    "term": "term",
    "lift": "toename",
    "recent": "recent",
    "before": "ervoor",
}


def translator(lang):
    if lang != "nl":
        return lambda text, **kw: text.format(**kw) if kw else text
    return lambda text, **kw: NL.get(text, text).format(**kw) if kw else NL.get(text, text)
