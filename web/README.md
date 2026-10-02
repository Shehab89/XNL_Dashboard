# Hofvijver · web

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
- Live data: on load the site reads one row, `web_snapshot` (id 1), from Supabase with the public publishable key in
  `.env`. The pipeline rebuilds that row after every run (`refresh_web_snapshot`), so counts, politicians and the
  reference block (seats, fractievoorzitters, cabinet from `config/entities.yaml`) update without a redeploy.
- `src/data/snapshot.json` a bundled copy of that row, used when the live read fails. Refresh it with
  `select data from web_snapshot where id = 1`.
- `src/data/reference.ts` topics, glossary and history; parties and politicians are filled from the snapshot
  (`applyReference`).
- Filters (period presets or a custom week range, tone, source or single platform, and one party/person/topic to focus on)
  live in `src/hooks/useFilters.tsx`. The snapshot carries a sparse count cube (week × platform × tone × entity, plus
  entity pairs), and `view()` in `src/services/monitor.ts` recomputes every series, ranking and co-mention from it, so
  all filters work instantly and offline. On the live site headline lists are fetched from the `items` table with the
  same filters (`src/hooks/useHeadlines.ts`).
- `src/services` the seams: `monitor.ts` (media data), `parliament.ts` (Tweede Kamer open data, not connected yet:
  the UI shows an explicit "not connected" state), `search.ts`.
- `src/components`, `src/pages`, `src/layouts`, `src/styles/app.css` (design tokens and all styles).

## Data rules

No invented records. What is not connected is shown as not connected. Parties are ordered by seats, never on a
left-right axis, and party colours appear only for that party.
