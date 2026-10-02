import { lazy } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { LangProvider } from "./hooks/useLang";
import { Layout } from "./layouts/Layout";

// Each page is its own chunk; Home is eager so the first paint does not wait for a second request.
import Home from "./pages/Home";
const Politics = lazy(() => import("./pages/Politics"));
const Parties = lazy(() => import("./pages/Parties"));
const PartyDetail = lazy(() => import("./pages/PartyDetail"));
const Politicians = lazy(() => import("./pages/Politicians"));
const PoliticianDetail = lazy(() => import("./pages/PoliticianDetail"));
const Topics = lazy(() => import("./pages/Topics"));
const TopicDetail = lazy(() => import("./pages/TopicDetail"));
const Parliament = lazy(() => import("./pages/Parliament"));
const Timeline = lazy(() => import("./pages/Timeline"));
const Search = lazy(() => import("./pages/Search"));
const Data = lazy(() => import("./pages/Data"));
const NotFound = lazy(() => import("./pages/NotFound"));

/** Hash routing so the site works from any static host (GitHub Pages, a single HTML file) without server rewrites. */
export function App() {
  return (
    <LangProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="politiek" element={<Politics />} />
            <Route path="partijen" element={<Parties />} />
            <Route path="partijen/:id" element={<PartyDetail />} />
            <Route path="politici" element={<Politicians />} />
            <Route path="politici/:id" element={<PoliticianDetail />} />
            <Route path="onderwerpen" element={<Topics />} />
            <Route path="onderwerpen/:id" element={<TopicDetail />} />
            <Route path="parlement" element={<Parliament />} />
            <Route path="tijdlijn" element={<Timeline />} />
            <Route path="zoeken" element={<Search />} />
            <Route path="data" element={<Data />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </LangProvider>
  );
}
