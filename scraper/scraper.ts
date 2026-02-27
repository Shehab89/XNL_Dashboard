import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const TARGETS = [
  // Group 1: Social Topics
  { topic: "Migratie", q: "migratie OR asielzoekers OR immigratie" },
  { topic: "Belasting", q: "belasting OR btw OR belastingdienst" },
  { topic: "Mensenrechten", q: "mensenrechten OR burgerrechten" },
  { topic: "Woning", q: "woningnood OR huurmarkt OR koopwoning" },
  { topic: "Salaris", q: "salaris OR minimumloon OR loon" },
  // Group 2: Parties
  { topic: "PVV", q: "PVV OR Geert Wilders" },
  { topic: "VVD", q: "VVD OR Dilan Yesilgoz" },
  { topic: "CDA", q: "CDA OR Henri Bontenbal" },
  { topic: "GPvda", q: "GroenLinks-PvdA OR Frans Timmermans" },
  { topic: "D66", q: "D66 OR Rob Jetten" },
  { topic: "J21", q: "JA21 OR Joost Eerdmans" },
  { topic: "FvD", q: "FvD OR Thierry Baudet" }
];

async function runScraper() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Add authentication cookies logic here...

  for (const item of TARGETS) {
    console.log(`[Target] Processing: ${item.topic}`);
    const page = await context.newPage();
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(item.q + " lang:nl")}&f=live`;
    
    try {
      await page.goto(searchUrl, { waitUntil: "networkidle" });
      // ... (Existing parsing logic from scraper.ts) ...
      // Final step: supabase.from('raw_tweets').upsert(results);
    } catch (err) {
      console.error(`Failed ${item.topic}:`, err);
    } finally {
      await page.close();
    }
  }
  await browser.close();
}

runScraper();
