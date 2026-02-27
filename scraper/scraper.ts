import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AUTH_TOKEN   = process.env.X_AUTH_TOKEN || "";
const CT0          = process.env.X_CT0 || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !AUTH_TOKEN || !CT0) {
  console.error("Missing environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TARGETS = [
  // Group 1: Social Topics
  { topic: "Migratie", category: "Social", query: "migratie OR asielzoekers OR immigratie" },
  { topic: "Belasting", category: "Social", query: "belasting OR btw OR belastingdienst" },
  { topic: "Mensenrechten", category: "Social", query: "mensenrechten OR discriminatie OR gelijkheid" },
  { topic: "Woning", category: "Social", query: "woningnood OR huurmarkt OR koopwoning" },
  { topic: "Salaris", category: "Social", query: "salaris OR minimumloon OR cao" },
  // Group 2: Parties
  { topic: "PVV", category: "Party", query: "PVV OR Geert Wilders" },
  { topic: "VVD", category: "Party", query: "VVD OR Dilan Yesilgoz" },
  { topic: "CDA", category: "Party", query: "CDA OR Henri Bontenbal" },
  { topic: "GPvda", category: "Party", query: "GroenLinks-PvdA OR Frans Timmermans" },
  { topic: "D66", category: "Party", query: "D66 OR Rob Jetten" },
  { topic: "J21", category: "Party", query: "JA21 OR Joost Eerdmans" },
  { topic: "FvD", category: "Party", query: "FvD OR Thierry Baudet" }
];

async function collect(page: any, topic: string, target: number) {
  const seen = new Map();
  let stale = 0;
  
  while (seen.size < target && stale < 4) {
    const prevSize = seen.size;
    const els = await page.$$('[data-testid="tweet"]');
    
    for (const el of els) {
      try {
        const textEl = await el.$('[data-testid="tweetText"]');
        const text = textEl ? await textEl.innerText() : "";
        if (!text) continue;

        const linkEl = await el.$('a[href*="/status/"]');
        const href = linkEl ? await linkEl.getAttribute("href") : "";
        const tweetId = href ? href.split("/status/")[1].split("?")[0] : "";
        
        if (!tweetId || seen.has(tweetId)) continue;

        seen.set(tweetId, {
          tweet_id: tweetId,
          topic: topic,
          text: text.trim(),
          scraped_at: new Date().toISOString(),
          processed: false
        });
      } catch (e) { /* ignore single tweet error */ }
    }
    stale = seen.size === prevSize ? stale + 1 : 0;
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(2500); // Give X time to load the next batch
  }
  return Array.from(seen.values()).slice(0, target);
}

async function main() {
  chromium.use(StealthPlugin());
  // We use headless: true, but give it a bit more leeway for GitHub Actions
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const context = await browser.newContext({ locale: "nl-NL" });

  await context.addCookies([
    { name: "auth_token", value: AUTH_TOKEN, domain: ".x.com", path: "/", secure: true },
    { name: "ct0", value: CT0, domain: ".x.com", path: "/", secure: true }
  ]);

  let allTweets: any[] = [];

  for (const item of TARGETS) {
    console.log(`[Scraping] ${item.topic}`);
    const page = await context.newPage();
    try {
      const url = `https://x.com/search?q=${encodeURIComponent(item.query + " lang:nl")}&f=live`;
      
      // FIX 1: Use domcontentloaded instead of networkidle, and give it 60 seconds
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      
      // FIX 2: Wait specifically for the first tweet to appear on the screen
      try {
        await page.waitForSelector('[data-testid="tweet"]', { timeout: 15000 });
      } catch (e) {
        console.log(` > No tweets loaded for ${item.topic} (might be empty or rate-limited). Skipping.`);
        continue;
      }
      
      const tweets = await collect(page, item.topic, 40);
      console.log(` > Found ${tweets.length} tweets for ${item.topic}`);
      allTweets.push(...tweets);
    } catch (err) {
      console.error(` > Error on ${item.topic}:`, (err as Error).message);
    } finally {
      await page.close();
      // Brief pause between targets to avoid triggering X's anti-bot defenses
      await new Promise(r => setTimeout(r, 2000)); 
    }
  }

  await browser.close();

  if (allTweets.length > 0) {
    const { error } = await supabase.from("raw_tweets").upsert(allTweets, { onConflict: "tweet_id" });
    if (error) console.error("Upload Error:", error);
    else console.log(`Successfully uploaded ${allTweets.length} tweets to Supabase.`);
  } else {
    console.log("No tweets collected across all topics.");
  }
}

main().catch(console.error);
