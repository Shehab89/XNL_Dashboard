import { chromium, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const X_AUTH_TOKEN = process.env.X_AUTH_TOKEN || "";
const X_CT0 = process.env.X_CT0 || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !X_AUTH_TOKEN || !X_CT0) {
  console.error("❌ Missing required environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TOPICS = [
  { topic: "Migratie", query: "migratie OR asiel OR immigratie OR asielzoeker" },
  { topic: "Belasting", query: "belasting OR toeslagen OR btw OR fiscus" },
  { topic: "Mensenrechten", query: "mensenrechten OR discriminatie OR racisme" },
  { topic: "Woning", query: "woningnood OR huurwoning OR koopwoning OR hypotheek" },
  { topic: "Salaris", query: "salaris OR minimumloon OR cao OR inkomen" },
  { topic: "PVV", query: "PVV OR Wilders" },
  { topic: "VVD", query: "VVD OR Yesilgoz" },
  { topic: "CDA", query: "CDA OR Bontenbal" },
  { topic: "GPvda", query: "GroenLinks OR PvdA OR Timmermans OR GL-PvdA" },
  { topic: "D66", query: "D66 OR Jetten" },
  { topic: "J21", query: "JA21 OR Eerdmans" },
  { topic: "FvD", query: "FvD OR Baudet" }
];

interface Tweet {
  tweet_id: string;
  text: string;
  author_id: string;
  topic: string;
  scraped_at: string;
  processed: boolean;
}

async function collect(page: Page, topic: string, limit: number): Promise<Tweet[]> {
  const tweets: Tweet[] = [];
  const seenIds = new Set<string>();
  let previousHeight = 0;
  let retries = 0;

  while (tweets.length < limit && retries < 4) {
    const articles = await page.$$('article[data-testid="tweet"]');

    for (const article of articles) {
      if (tweets.length >= limit) break;
      try {
        const textEl = await article.$('div[data-testid="tweetText"]');
        const linkEl = await article.$('a[href*="/status/"]');
        if (!textEl || !linkEl) continue;

        const text = await textEl.innerText();
        const href = await linkEl.getAttribute('href');
        if (!href) continue;

        const match = href.match(/status\/(\d+)/);
        if (!match) continue;

        const tweet_id = match[1];
        if (!seenIds.has(tweet_id)) {
          seenIds.add(tweet_id);
          tweets.push({
            tweet_id,
            text: text.replace(/\n/g, ' '),
            author_id: href.split('/')[1],
            topic,
            scraped_at: new Date().toISOString(),
            processed: false
          });
        }
      } catch (e) { /* skip individual tweet errors */ }
    }

    // Fixed scrolling logic: No more external randomInt inside evaluate
    const currentHeight = await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        return document.body.scrollHeight;
    });

    if (currentHeight === previousHeight) {
      retries++;
    } else {
      retries = 0;
    }
    previousHeight = currentHeight;
    
    // Wait for content to load
    await page.waitForTimeout(2000);
  }
  return tweets;
}

async function main() {
  console.log("🚀 Starting Dutch Social Scraper...");
  TOPICS.sort(() => Math.random() - 0.5);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await context.addCookies([
    { name: "auth_token", value: X_AUTH_TOKEN, domain: ".x.com", path: "/" },
    { name: "ct0", value: X_CT0, domain: ".x.com", path: "/" }
  ]);

  const page = await context.newPage();
  let allTweets: Tweet[] = [];

  for (const item of TOPICS) {
    console.log(`Scraping: ${item.topic}`);
    const encodedQuery = encodeURIComponent(`${item.query} lang:nl`);
    const url = `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`;

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      const tweets = await collect(page, item.topic, 75);
      allTweets = allTweets.concat(tweets);
      console.log(`  Found ${tweets.length} tweets.`);
    } catch (error) {
      console.log(`  Error scraping ${item.topic}: ${error.message}`);
    }
    
    // Random pause on the server side (safe)
    const pause = Math.floor(Math.random() * 5000) + 5000;
    console.log(`  Pausing ${Math.round(pause/1000)} seconds...`);
    await page.waitForTimeout(pause);
  }

  await browser.close();

  if (allTweets.length > 0) {
    const { error } = await supabase.from('raw_tweets').upsert(allTweets, { onConflict: 'tweet_id' });
    if (error) console.error("❌ Supabase error:", error.message);
    else console.log(`✅ Successfully uploaded ${allTweets.length} tweets.`);
  } else {
    console.log("No tweets collected - check if cookies are valid.");
  }
}

main().catch(console.error);
