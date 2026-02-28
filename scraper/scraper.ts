import { chromium, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const X_AUTH_TOKEN = process.env.X_AUTH_TOKEN || "";
const X_CT0 = process.env.X_CT0 || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !X_AUTH_TOKEN || !X_CT0) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

console.log("ENV OK - URL:", SUPABASE_URL.substring(0, 25));

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

interface Tweet {
  tweet_id:      string;
  text:          string;
  author_handle: string;
  topic:         string;
  scraped_at:    string;
  processed:     boolean;
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
        if (!textEl) continue;
        const text = await textEl.innerText();

        const linkEl = await article.$('a[href*="/status/"]');
        if (!linkEl) continue;
        const href = await linkEl.getAttribute("href");
        if (!href) continue;

        const match = href.match(/status\/(\d+)/);
        if (!match) continue;

        const tweet_id = match[1];
        const author_handle = href.split("/")[1];

        if (!seenIds.has(tweet_id)) {
          seenIds.add(tweet_id);
          tweets.push({
            tweet_id,
            text:          text.replace(/\n/g, " "),
            author_handle,
            topic,
            scraped_at: new Date().toISOString(),
            processed:  false,
          });
        }
      } catch (e) {
        // skip broken elements
      }
    }

    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === previousHeight) {
      retries++;
      await page.waitForTimeout(2000);
    } else {
      retries = 0;
    }
    previousHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  return tweets;
}

async function main() {
  console.log("Starting Dutch Social Scraper...");

  // Shuffle topics so different ones get priority on partial runs
  TOPICS.sort(() => Math.random() - 0.5);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale: "nl-NL",
  });

  await context.addCookies([
    { name: "auth_token", value: X_AUTH_TOKEN, domain: ".x.com", path: "/", httpOnly: true,  secure: true },
    { name: "ct0",        value: X_CT0,        domain: ".x.com", path: "/", httpOnly: false, secure: true },
  ]);

  const page = await context.newPage();
  let allTweets: Tweet[] = [];
  const TWEETS_PER_TOPIC = 75;

  for (const item of TOPICS) {
    console.log("Scraping:", item.topic);
    const encodedQuery = encodeURIComponent(item.query + " lang:nl");
    const url = "https://x.com/search?q=" + encodedQuery + "&src=typed_query&f=live";

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });

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

    await page.waitForTimeout(3000);
  }

  await browser.close();

  if (allTweets.length === 0) {
    console.log("No tweets collected - cookies may be expired.");
    return;
  }

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
