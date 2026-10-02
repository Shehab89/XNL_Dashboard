# Politiek Monitor · web

The public frontend of the monitor: parties, politicians, topics, the Tweede Kamer and a timeline, with a source and a
layer mark (fact, data, analysis, interpretation) on every block.

React 19 + TypeScript + Vite. Charts are hand-drawn SVG (no chart library). Hash routing, so it runs from any static host.

```
cd web
npm install
npm run dev          # local dev server
npm run build        # typecheck + production build in dist/ (code-split per page)
npm run build:single # one self-contained file: dist/index.single.html
npm test             # unit tests (vitest)
```

## Structure

- `src/types` data models. Components only use these.
- `src/data/reference.ts` hand-entered reference data (seats, lead candidates, topics, glossary, history), each with a
  source and a verification state. Unverified items are shown as "nog te verifiëren".
- `src/data/snapshot.json` weekly aggregates exported from the monitor's Supabase database.
- `src/services` the seams: `monitor.ts` (media data), `parliament.ts` (Tweede Kamer open data, not connected yet:
  the UI shows an explicit "not connected" state), `search.ts`.
- `src/components`, `src/pages`, `src/layouts`, `src/styles/app.css` (design tokens and all styles).

## Data rules

No invented records. What is not connected is shown as not connected. Parties are ordered by seats, never on a
left-right axis, and party colours appear only for that party.
