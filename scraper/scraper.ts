import { chromium, Page, BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const X_AUTH_TOKEN = process.env.X_AUTH_TOKEN || "";
const X_CT0        = process.env.X_CT0 || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !X_AUTH_TOKEN || !X_CT0) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

console.log("ENV OK - URL:", SUPABASE_URL.substring(0, 25));

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Topics ────────────────────────────────────────────────────────────────────
const TOPICS = [
  { topic: "Migratie",      query: "migratie OR asiel OR immigratie OR asielzoeker" },
  { topic: "Belasting",     query: "belasting OR toeslagen OR btw OR fiscus" },
  { topic: "Mensenrechten", query: "mensenrechten OR discriminatie OR racisme" },
  { topic: "Woning",        query: "woningnood OR huurwoning OR koopwoning OR hypotheek" },
  { topic: "Salaris",       query: "salaris OR minimumloon OR cao OR inkomen" },
  { topic: "PVV",           query: "PVV OR Wilders" },
  { topic: "VVD",           query: "VVD OR Yesilgoz" },
  { topic: "CDA",           query: "CDA OR Bontenbal" },
  { topic: "GPvda",         query: "GroenLinks OR PvdA OR Timmermans" },
  { topic: "D66",           query: "D66 OR Jetten" },
  { topic: "J21",           query: "JA21 OR Eerdmans" },
  { topic: "FvD",           query: "FvD OR Baudet" }
];

const TWEETS_PER_TOPIC = 150;

// ── Realistic user agents (rotated per session) ───────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

// ── Realistic screen resolutions ──────────────────────────────────────────────
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900  },
  { width: 1366, height: 768  },
  { width: 1536, height: 864  },
  { width: 1280, height: 720  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return new Promise(r => setTimeout(r, randomInt(minMs, maxMs)));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Human-like scroll: variable distance, occasional pauses, sometimes scrolls up slightly
async function humanScroll(page: Page): Promise<void> {
  const scrolls = randomInt(2, 5);
  for (let i = 0; i < scrolls; i++) {
    const distance = randomInt(300, 800);
    await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), distance);
    await randomDelay(400, 1200);
    // Occasionally scroll back up a little (like a human re-reading)
    if (Math.random() < 0.2) {
      await page.evaluate(() => window.scrollBy({ top: -randomInt(50, 150), behavior: "smooth" } as any));
      await randomDelay(300, 600);
    }
  }
}

// Simulate mouse movement across the viewport
async function humanMouseWiggle(page: Page): Promise<void> {
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  for (let i = 0; i < randomInt(2, 4); i++) {
    await page.mouse.move(
      randomInt(100, vp.width - 100),
      randomInt(100, vp.height - 100),
      { steps: randomInt(10, 30) }
    );
    await randomDelay(100, 400);
  }
}

// ── Interface ─────────────────────────────────────────────────────────────────
interface Tweet {
  tweet_id:      string;
  text:          string;
  author_handle: string;
  topic:         string;
  scraped_at:    string;
  processed:     boolean;
}

// ── Collect tweets from current page with human-like behaviour ────────────────
async function collect(page: Page, topic: string, limit: number): Promise<Tweet[]> {
  const tweets: Tweet[] = [];
  const seenIds = new Set<string>();
  let previousHeight = 0;
  let retries = 0;

  while (tweets.length < limit && retries < 5) {
    const articles = await page.$$('article[data-testid="tweet"]');

    for (const article of articles) {
      if (tweets.length >= limit) break;
      try {
        const textEl = await article.$('div[data-testid="tweetText"]');
        if (!textEl) continue;
        const text = await textEl.innerText();

        const linkEl = await article.$('a[href*="/status/"]');
        if (!linkEl) continue;
        const href = await linkEl.getAttribute("href");
        if (!href) continue;

        const match = href.match(/status\/(\d+)/);
        if (!match) continue;

        const tweet_id    = match[1];
        const author_handle = href.split("/")[1];

        if (!seenIds.has(tweet_id)) {
          seenIds.add(tweet_id);
          tweets.push({
            tweet_id,
            text:          text.replace(/\n/g, " "),
            author_handle,
            topic,
            scraped_at:    new Date().toISOString(),
            processed:     false,
          });
        }
      } catch (e) {
        // skip broken tweet elements
      }
    }

    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === previousHeight) {
      retries++;
      await randomDelay(2000, 4000);
    } else {
      retries = 0;
    }

    previousHeight = currentHeight;

    // Human-like scroll instead of jumping straight to bottom
    await humanScroll(page);

    // Occasionally wiggle the mouse
    if (Math.random() < 0.4) {
      await humanMouseWiggle(page);
    }

    // Random pause between scroll bursts (mimics reading)
    await randomDelay(1500, 3500);
  }

  return tweets;
}

// ── Create a fresh stealth browser context ────────────────────────────────────
async function createStealthContext(browser: any): Promise<BrowserContext> {
  const ua       = pick(USER_AGENTS);
  const viewport = pick(VIEWPORTS);

  const context = await browser.newContext({
    userAgent: ua,
    viewport,
    locale:           "nl-NL",
    timezoneId:       "Europe/Amsterdam",
    geolocation:      { latitude: 52.3676, longitude: 4.9041 }, // Amsterdam
    permissions:      ["geolocation"],
    colorScheme:      "light",
    deviceScaleFactor: pick([1, 1, 1, 2]), // mostly non-retina
    hasTouch:         false,
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      "Accept-Language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "sec-ch-ua":       '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      "sec-ch-ua-mobile":   "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
  });

  // Inject cookies
  await context.addCookies([
    { name: "auth_token", value: X_AUTH_TOKEN, domain: ".x.com", path: "/", httpOnly: true,  secure: true, sameSite: "None" },
    { name: "ct0",        value: X_CT0,        domain: ".x.com", path: "/", httpOnly: false, secure: true, sameSite: "None" },
    // Additional cookies X expects from a real browser session
    { name: "lang",       value: "nl",         domain: ".x.com", path: "/", httpOnly: false, secure: true },
  ]);

  // Override navigator properties to mask automation
  await context.addInitScript(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // Fake plugins (real browsers have these)
    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "Chrome PDF Plugin",     filename: "internal-pdf-viewer" },
        { name: "Chrome PDF Viewer",     filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
        { name: "Native Client",         filename: "internal-nacl-plugin" },
      ],
    });

    // Fake language list
    Object.defineProperty(navigator, "languages", { get: () => ["nl-NL", "nl", "en-US", "en"] });

    // Fake hardware concurrency (real PC has multiple cores)
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });

    // Fake device memory
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });

    // Fake platform
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });

    // Remove automation-related chrome properties
    (window as any).chrome = {
      runtime: {},
      loadTimes: () => {},
      csi:        () => {},
      app:        {},
    };

    // Permissions API — return granted for notifications (real browsers do this)
    const origQuery = window.navigator.permissions.query.bind(navigator.permissions);
    (window.navigator.permissions as any).query = (params: any) =>
      params.name === "notifications"
        ? Promise.resolve({ state: "denied", onchange: null } as any)
        : origQuery(params);
  });

  return context;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Starting Dutch Social Scraper...");

  // Shuffle so different topics win on rate-limited days
  TOPICS.sort(() => Math.random() - 0.5);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--window-size=1920,1080",
    ],
  });

  // Warm up: visit x.com homepage first (like a real user)
  const context = await createStealthContext(browser);
  const page    = await context.newPage();

  console.log("Warming up — visiting x.com homepage...");
  try {
    await page.goto("https://x.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(2000, 4000);
    await humanMouseWiggle(page);
    await randomDelay(1000, 2000);
  } catch (e) {
    console.log("Warm-up failed, continuing anyway");
  }

  let allTweets: Tweet[] = [];

  for (const item of TOPICS) {
    console.log("Scraping:", item.topic);

    const encodedQuery = encodeURIComponent(item.query + " lang:nl");
    const url = "https://x.com/search?q=" + encodedQuery + "&src=typed_query&f=live";

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

      // Human-like pause after page load
      await randomDelay(2000, 5000);

      // Move mouse around before scrolling
      await humanMouseWiggle(page);

      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20000 });

      // Read for a moment before collecting
      await randomDelay(1000, 2500);

      const tweets = await collect(page, item.topic, TWEETS_PER_TOPIC);

      if (tweets.length === 0) {
        console.log("  No tweets for", item.topic);
      } else {
        console.log("  Found", tweets.length, "tweets for", item.topic);
        allTweets = allTweets.concat(tweets);
      }
    } catch (error) {
      console.log("  Skipping", item.topic, "-", (error as Error).message.split("\n")[0]);
    }

    // Random delay between topics (5–12 seconds) — mimics a human switching tabs
    const pause = randomInt(5000, 12000);
    console.log("  Pausing", Math.round(pause / 1000), "seconds before next topic...");
    await randomDelay(pause, pause);
  }

  await browser.close();

  if (allTweets.length === 0) {
    console.log("No tweets collected - cookies may be expired.");
    return;
  }

  console.log("Total collected:", allTweets.length, "tweets");

  const { error } = await supabase
    .from("raw_tweets")
    .upsert(allTweets, { onConflict: "tweet_id", ignoreDuplicates: true });

  if (error) {
    console.error("Upload error:", error.message);
  } else {
    console.log("Uploaded", allTweets.length, "tweets to Supabase.");
  }
}

main().catch(console.error);
