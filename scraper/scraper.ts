/**
 * Dutch Social Monitor — X (Twitter) Scraper
 * Rewrote for reliability: simpler auth, better error handling
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

// ── Validate env ──────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL  || "";
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AUTH_TOKEN    = process.env.X_AUTH_TOKEN  || "";
const CT0           = process.env.X_CT0         || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !AUTH_TOKEN || !CT0) {
  console.error("❌ Missing env variables. Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, X_AUTH_TOKEN, X_CT0");
  process.exit(1);
}

console.log("✅ Env check passed");
console.log("   SUPABASE_URL prefix:", SUPABASE_URL.substring(0, 20));

// ── Config ────────────────────────────────────────────────────────────────────
const TOPICS: Record<string, string> = {
  Salaris:    "salarissen loon minimumloon Nederland",
  Woningnood: "woningnood huurprijs koopwoning Nederland",
  Zorg:       "zorg zorgkosten ziekenhuis wachttijden",
  Klimaat:    "klimaat klimaatverandering duurzaamheid",
  Onderwijs:  "onderwijs lerarentekort studenten Nederland",
};

const TWEETS_PER_TOPIC = 50;

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Types ─────────────────────────────────────────────────────────────────────
interface Tweet {
  tweet_id:      string;
  topic:         string;
  text:          string;
  author:        string;
  author_handle: string;
  published_at:  string;
  likes:         number;
  retweets:      number;
  replies:       number;
  tweet_url:     string;
  scraped_at:    string;
  processed:     boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildSearchUrl(query: string): string {
  const q = encodeURIComponent(`${query} lang:nl`);
  return `https://x.com/search?q=${q}&src=typed_query&f=live`;
}

function parseCount(label: string): number {
  const m = (label || "").match(/[\d,]+/);
  return m ? parseInt(m[0].replace(/,/g, ""), 10) : 0;
}

// ── Parse tweets from page ────────────────────────────────────────────────────
async function parseTweets(page: any, topic: string): Promise<Tweet[]> {
  const results: Tweet[] = [];
  const elements = await page.$$('[data-testid="tweet"]');

  for (const el of elements) {
    try {
      const textEl  = await el.$('[data-testid="tweetText"]');
      const text    = textEl ? (await textEl.innerText()).trim() : "";
      if (!text) continue;

      const nameEl   = await el.$('[data-testid="User-Name"]');
      const nameText = nameEl ? await nameEl.innerText() : "";
      const parts    = nameText.split("\n");
      const author   = parts[0]?.trim() || "";
      const handle   = (parts[1] || "").replace("@", "").trim();

      const timeEl   = await el.$("time");
      const dt       = timeEl ? await timeEl.getAttribute("datetime") : new Date().toISOString();

      const linkEl   = await el.$('a[href*="/status/"]');
      const href     = linkEl ? await linkEl.getAttribute("href") : "";
      const tweetId  = href ? href.split("/status/")[1]?.split("?")[0] || "" : "";
      if (!tweetId) continue;

      const likeEl   = await el.$('[data-testid="like"]');
      const rtEl     = await el.$('[data-testid="retweet"]');
      const repEl    = await el.$('[data-testid="reply"]');

      const likes    = parseCount(likeEl    ? await likeEl.getAttribute("aria-label")  || "" : "");
      const retweets = parseCount(rtEl      ? await rtEl.getAttribute("aria-label")    || "" : "");
      const replies  = parseCount(repEl     ? await repEl.getAttribute("aria-label")   || "" : "");

      results.push({
        tweet_id:      tweetId,
        topic,
        text,
        author,
        author_handle: handle,
        published_at:  dt || new Date().toISOString(),
        likes,
        retweets,
        replies,
        tweet_url:     href ? `https://x.com${href}` : "",
        scraped_at:    new Date().toISOString(),
        processed:     false,
      });
    } catch {
      // skip broken elements
    }
  }
  return results;
}

// ── Scroll and collect ────────────────────────────────────────────────────────
async function scrollAndCollect(page: any, topic: string, target: number): Promise<Tweet[]> {
  const seen = new Map<string, Tweet>();
  let stale  = 0;

  while (seen.size < target && stale < 4) {
    const prev   = seen.size;
    const batch  = await parseTweets(page, topic);
    batch.forEach(t => seen.set(t.tweet_id, t));
    stale = seen.size === prev ? stale + 1 : 0;
    await page.evaluate(() => window.scrollBy(0, 1400));
    await page.waitForTimeout(2500);
  }

  return Array.from(seen.values()).slice(0, target);
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function upload(tweets: Tweet[]): Promise<void> {
  if (!tweets.length) { console.log("  No tweets to upload"); return; }
  const { error } = await supabase.from("raw_tweets").upsert(tweets, { onConflict: "tweet_id" });
  if (error) console.error("  Supabase error:", error.message);
  else       console.log(`  ✅ Uploaded ${tweets.length} tweets`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  chromium.use(StealthPlugin());

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport:  { width: 1280, height: 900 },
    locale:    "nl-NL",
  });

  await context.addCookies([
    { name: "auth_token", value: AUTH_TOKEN, domain: ".x.com", path: "/", httpOnly: true,  secure: true },
    { name: "ct0",        value: CT0,        domain: ".x.com", path: "/", httpOnly: false, secure: true },
  ]);

  const allTweets: Tweet[] = [];

  for (const [topic, query] of Object.entries(TOPICS)) {
    console.log(`\n🔍 Scraping: ${topic}`);
    const page = await context.newPage();
    try {
      await page.goto(buildSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);
      await page.waitForSelector('[data-testid="tweet"]', { timeout: 20000 }).catch(() => {
        console.log(`   ⚠️ No tweets found for ${topic} — cookies may be expired or X is blocking`);
      });
      const tweets = await scrollAndCollect(page, topic, TWEETS_PER_TOPIC);
      console.log(`   Found ${tweets.length} tweets`);
      allTweets.push(...tweets);
    } catch (err) {
      console.error(`   ⚠️ Error on ${topic}:`, (err as Error).message);
    } finally {
      await page.close();
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  await browser.close();
  console.log(`\n📦 Total: ${allTweets.length} tweets`);
  await upload(allTweets);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
