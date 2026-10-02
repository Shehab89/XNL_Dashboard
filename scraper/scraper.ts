/**
 * OPTIONAL X (Twitter) scraper.
 *
 * X has no free API, so this logs in with YOUR browser cookies and reads the "Latest" search results.
 * Use at your own risk: it is against X's terms of service and X may lock the account. A secondary
 * account is strongly recommended. Everything else in the monitor works without it.
 *
 * It uses the same search queries as the other sources (from config/entities.yaml via
 * queries.json) and writes x_items.json, which the Python pipeline analyses and stores:
 *
 *   python -m monitor.pipeline queries > scraper/queries.json
 *   cd scraper && npm run build && npm start          # -> scraper/x_items.json
 *   python -m monitor.pipeline run --extra-json scraper/x_items.json
 */
import { chromium, Page } from "patchright"; // Playwright with stealth patches
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const X_AUTH_TOKEN = process.env.X_AUTH_TOKEN || "";
const X_CT0 = process.env.X_CT0 || "";
const PER_QUERY = Number(process.env.X_PER_QUERY || 40);
// Works both from the compiled dist/ folder and when run directly with ts-node.
const SCRAPER_DIR = path.basename(__dirname) === "dist" ? path.join(__dirname, "..") : __dirname;
const OUT = path.join(SCRAPER_DIR, "x_items.json");
const QUERIES = path.join(SCRAPER_DIR, "queries.json");
// Hard stop so X can never hold up the rest of the pipeline (the workflow step has its own timeout too).
const MAX_RUNTIME_MS = Number(process.env.X_MAX_MINUTES || 15) * 60_000;
const MAX_SCROLLS = 25;
// X_HEADFUL=1 opens a real browser window (on a server: under xvfb-run), which X treats like a person's browser.
// That is how this scraper worked in February 2026; headless Chromium now gets stuck on X's "Even geduld..." screen.
const HEADFUL = /^(1|true|yes)$/i.test(process.env.X_HEADFUL || "");
// Headless Chromium announces itself as "HeadlessChrome", which X refuses to serve timelines to.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

interface Query { label: string; terms: string[] }
interface XItem {
  platform: "x"; source: string; uid: string; url: string; author: string; text: string;
  published_at: string | null; lang: string; likes: number; shares: number; replies: number;
}

/** "1,2K" / "3.4M" / "57" -> number */
function toCount(raw: string | null): number {
  if (!raw) return 0;
  const m = raw.replace(/\s/g, "").match(/([\d.,]+)([KkMm]?)/);
  if (!m) return 0;
  const value = parseFloat(m[1].replace(",", "."));
  return Math.round(value * (m[2].toLowerCase() === "k" ? 1_000 : m[2].toLowerCase() === "m" ? 1_000_000 : 1));
}

async function metric(article: any, testId: string): Promise<number> {
  const el = await article.$(`[data-testid="${testId}"]`);
  return el ? toCount(await el.innerText()) : 0;
}

async function collect(page: Page, limit: number): Promise<XItem[]> {
  const items: XItem[] = [];
  const seen = new Set<string>();
  let previousHeight = 0;
  let stuck = 0;
  let scrolls = 0;

  while (items.length < limit && stuck < 4 && scrolls++ < MAX_SCROLLS) {
    for (const article of await page.$$('article[data-testid="tweet"]')) {
      if (items.length >= limit) break;
      try {
        const textEl = await article.$('div[data-testid="tweetText"]');
        const timeEl = await article.$("time");
        const linkEl = timeEl ? await timeEl.evaluateHandle((t) => t.closest("a")) : null;
        const href = linkEl ? await (linkEl as any).getAttribute("href") : null;
        const match = href ? href.match(/^\/([^/]+)\/status\/(\d+)/) : null;
        if (!textEl || !match) continue;
        const [, handle, id] = match;
        if (seen.has(id)) continue;
        seen.add(id);
        items.push({
          platform: "x", source: "X", uid: id, url: `https://x.com/${handle}/status/${id}`, author: handle,
          text: (await textEl.innerText()).replace(/\s+/g, " ").trim(),
          published_at: timeEl ? await timeEl.getAttribute("datetime") : null, lang: "nl",
          likes: await metric(article, "like"), shares: await metric(article, "retweet"),
          replies: await metric(article, "reply"),
        });
      } catch {
        /* skip a tweet that changed while reading */
      }
    }
    const height = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });
    stuck = height === previousHeight ? stuck + 1 : 0;
    previousHeight = height;
    await page.waitForTimeout(2000);
  }
  return items;
}

async function main() {
  if (!X_AUTH_TOKEN || !X_CT0) {
    console.log("X_AUTH_TOKEN / X_CT0 not set: skipping X.");
    fs.writeFileSync(OUT, "[]");
    return;
  }
  const queries: Query[] = JSON.parse(fs.readFileSync(QUERIES, "utf-8"));
  // patchright hides the automation traces itself; it is least detectable with installed Google Chrome, a real
  // window and the browser's own user agent and window size. Falls back to the bundled Chromium.
  const launch = (channel?: string) => chromium.launch({ headless: !HEADFUL, channel, args: ["--lang=nl-NL"] });
  const browser = await launch(process.env.X_BROWSER_CHANNEL || "chrome").catch(() => launch());
  const context = await browser.newContext({
    locale: "nl-NL", timezoneId: "Europe/Amsterdam",
    ...(HEADFUL ? { viewport: null } : { userAgent: USER_AGENT, viewport: { width: 1280, height: 900 } }),
  });
  await context.addCookies([
    { name: "auth_token", value: X_AUTH_TOKEN, domain: ".x.com", path: "/", secure: true, httpOnly: true },
    { name: "ct0", value: X_CT0, domain: ".x.com", path: "/", secure: true },
  ]);
  const page = await context.newPage();
  let all: XItem[] = [];

  // Check the login once instead of timing out on every query when the cookies are stale.
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  if (/\/login|\/logout|\/i\/flow/.test(page.url())) {
    console.log(`X is not logged in (landed on ${page.url()}): refresh the X_AUTH_TOKEN and X_CT0 secrets.`);
    await browser.close();
    fs.writeFileSync(OUT, "[]");
    process.exitCode = 1;
    return;
  }
  console.log(`X session OK (${page.url()}), ${HEADFUL ? "browser window" : "headless"}`);
  let saved = 0;

  const deadline = Date.now() + MAX_RUNTIME_MS;
  for (const q of queries.sort(() => Math.random() - 0.5)) {
    if (Date.now() > deadline) {
      console.log("X time budget used up: stopping with the posts collected so far.");
      break;
    }
    const terms = q.terms.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" OR ");
    const url = `https://x.com/search?q=${encodeURIComponent(`(${terms}) lang:nl`)}&src=typed_query&f=live`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 30000 });
      const found = await collect(page, PER_QUERY);
      all = all.concat(found);
      console.log(`${q.label}: ${found.length} posts`);
    } catch (error: any) {
      const title = await page.title().catch(() => "");
      console.log(`${q.label}: no results (${error.message.split("\n")[0]}) at ${page.url()} "${title}"`);
      if (saved++ < 2) { // what X showed instead of posts, so the run log says why
        const shown = await page.evaluate(() => document.body.innerText).catch(() => "");
        console.log(`  page text: ${shown.replace(/\s+/g, " ").slice(0, 300)}`);
      }
    }
    await page.waitForTimeout(4000 + Math.random() * 5000); // behave like a person, not a bot
  }

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(all));
  console.log(`Wrote ${all.length} posts to x_items.json`);
  if (all.length === 0) console.log("No posts at all: the X cookies have probably expired.");
}

main().catch((e) => {
  console.error(e);
  fs.writeFileSync(OUT, "[]");
});
