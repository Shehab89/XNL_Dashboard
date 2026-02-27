/**
 * Dutch Social Media Monitor - X (Twitter) Scraper
 * Runs on GitHub Actions (or locally) every 24 hours.
 * Uses Playwright + Crawlee with stealth to avoid bot detection.
 * Auth via cookie injection (auth_token + ct0) - no API key required.
 */

import { PlaywrightCrawler, Dataset } from "crawlee";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AUTH_TOKEN   = process.env.X_AUTH_TOKEN!;   // auth_token cookie value
const CT0          = process.env.X_CT0!;           // ct0 cookie value

const TOPICS: Record<string, string> = {
  Salaris:    "salarissen loon minimumloon Nederland",
  Woningnood: "woningnood huurprijs koopwoning Nederland",
  Zorg:       "zorg zorgkosten ziekenhuis wachttijden",
  Klimaat:    "klimaat klimaatverandering duurzaamheid stikstof",
  Onderwijs:  "onderwijs leerkort schoolkosten studenten Nederland",
};

const TWEETS_PER_TOPIC = 75; // target per topic
const TWEET_LANGUAGE   = "nl";

// ─── Supabase Client ──────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScrapedTweet {
  tweet_id:    string;
  topic:       string;
  text:        string;
  author:      string;
  author_handle: string;
  published_at: string;
  likes:       number;
  retweets:    number;
  replies:     number;
  tweet_url:   string;
  scraped_at:  string;
}

// ─── Cookie Injection Helper ──────────────────────────────────────────────────

function buildTwitterCookies(domain = ".x.com") {
  return [
    {
      name: "auth_token",
      value: AUTH_TOKEN,
      domain,
      path: "/",
      httpOnly: true,
      secure: true,
    },
    {
      name: "ct0",
      value: CT0,
      domain,
      path: "/",
      httpOnly: false,
      secure: true,
    },
  ];
}

// ─── Parse tweet data from the DOM ───────────────────────────────────────────

async function parseTweets(page: any, topic: string): Promise<ScrapedTweet[]> {
  const results: ScrapedTweet[] = [];

  const tweetElements = await page.$$('[data-testid="tweet"]');

  for (const el of tweetElements) {
    try {
      // Text
      const textEl  = await el.$('[data-testid="tweetText"]');
      const text     = textEl ? await textEl.innerText() : "";

      // Author
      const authorEl       = await el.$('[data-testid="User-Name"]');
      const authorText     = authorEl ? await authorEl.innerText() : "";
      const [displayName, handle] = authorText.split("\n");

      // Date / URL
      const timeEl   = await el.$("time");
      const dateTime = timeEl ? await timeEl.getAttribute("datetime") : new Date().toISOString();
      const linkEl   = await el.$('a[href*="/status/"]');
      const href     = linkEl ? await linkEl.getAttribute("href") : "";
      const tweetUrl = href ? `https://x.com${href}` : "";
      const tweetId  = href ? href.split("/status/")[1]?.split("?")[0] : "";

      // Engagement
      const getCount = async (testId: string): Promise<number> => {
        const countEl = await el.$(`[data-testid="${testId}"]`);
        if (!countEl) return 0;
        const raw = await countEl.getAttribute("aria-label") ?? "";
        const match = raw.match(/[\d,]+/);
        return match ? parseInt(match[0].replace(",", ""), 10) : 0;
      };

      const likes    = await getCount("like");
      const retweets = await getCount("retweet");
      const replies  = await getCount("reply");

      if (!text || !tweetId) continue;

      results.push({
        tweet_id:      tweetId,
        topic,
        text:          text.trim(),
        author:        displayName?.trim() ?? "",
        author_handle: handle?.trim().replace("@", "") ?? "",
        published_at:  dateTime ?? new Date().toISOString(),
        likes,
        retweets,
        replies,
        tweet_url:     tweetUrl,
        scraped_at:    new Date().toISOString(),
      });
    } catch (err) {
      // Skip malformed tweet elements
    }
  }

  return results;
}

// ─── Scroll to load more tweets ───────────────────────────────────────────────

async function scrollAndCollect(
  page: any,
  topic: string,
  target: number
): Promise<ScrapedTweet[]> {
  const collected = new Map<string, ScrapedTweet>();
  let prevCount   = 0;
  let staleRounds = 0;

  while (collected.size < target && staleRounds < 5) {
    const batch = await parseTweets(page, topic);
    batch.forEach((t) => collected.set(t.tweet_id, t));

    if (collected.size === prevCount) {
      staleRounds++;
    } else {
      staleRounds = 0;
    }
    prevCount = collected.size;

    // Scroll down
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(2000 + Math.random() * 1000);
  }

  return Array.from(collected.values()).slice(0, target);
}

// ─── Build search URL ─────────────────────────────────────────────────────────

function buildSearchUrl(query: string): string {
  const encoded = encodeURIComponent(`${query} lang:${TWEET_LANGUAGE}`);
  return `https://x.com/search?q=${encoded}&src=typed_query&f=live`;
}

// ─── Upload to Supabase ───────────────────────────────────────────────────────

async function uploadToSupabase(tweets: ScrapedTweet[]): Promise<void> {
  if (!tweets.length) return;

  // Upsert to avoid duplicates on re-run
  const { error } = await supabase
    .from("raw_tweets")
    .upsert(tweets, { onConflict: "tweet_id" });

  if (error) {
    console.error("Supabase upload error:", error.message);
  } else {
    console.log(`✅ Uploaded ${tweets.length} tweets to Supabase.`);
  }
}

// ─── Main Scraper ─────────────────────────────────────────────────────────────

async function main() {
  chromium.use(StealthPlugin());

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "nl-NL",
  });

  // Inject auth cookies
  await context.addCookies(buildTwitterCookies());

  const allTweets: ScrapedTweet[] = [];

  for (const [topic, query] of Object.entries(TOPICS)) {
    console.log(`\n🔍 Scraping topic: ${topic}`);
    const page = await context.newPage();

    try {
      await page.goto(buildSearchUrl(query), {
        waitUntil: "networkidle",
        timeout: 30_000,
      });

      // Wait for tweets to appear
      await page.waitForSelector('[data-testid="tweet"]', { timeout: 15_000 });

      const tweets = await scrollAndCollect(page, topic, TWEETS_PER_TOPIC);
      console.log(`   Found ${tweets.length} tweets for "${topic}"`);
      allTweets.push(...tweets);
    } catch (err) {
      console.error(`   Error scraping ${topic}:`, (err as Error).message);
    } finally {
      await page.close();
      // Polite delay between topics
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
    }
  }

  await browser.close();

  console.log(`\n📦 Total tweets collected: ${allTweets.length}`);

  // Save locally for debugging
  await Dataset.pushData(allTweets);

  // Upload to Supabase
  await uploadToSupabase(allTweets);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
