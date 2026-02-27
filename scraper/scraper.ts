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
  console.error("Missing env variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Updated targets based on your specific groups
const TARGET_CONFIG = [
  // Group 1: Social Topics
  { topic: "Migratie", query: "migratie OR asielzoekers OR immigratie", cat: "Social" },
  { topic: "Belasting", query: "belasting OR btw OR belastingdienst", cat: "Social" },
  { topic: "Mensenrechten", query: "mensenrechten OR burgerrechten OR discriminatie", cat: "Social" },
  { topic: "Woning", query: "woningnood OR huurprijs OR koopwoning", cat: "Social" },
  { topic: "Salaris", query: "salaris OR loon OR minimumloon", cat: "Social" },
  // Group 2: Parties
  { topic: "PVV", query: "PVV OR @pvv OR Geert Wilders", cat: "Party" },
  { topic: "VVD", query: "VVD OR @VVD OR Dilan Yeşilgöz", cat: "Party" },
  { topic: "CDA", query: "CDA OR @CDAnews OR Henri Bontenbal", cat: "Party" },
  { topic: "GPvda", query: "GroenLinks-PvdA OR @GroenLinksPvdA OR Timmermans", cat: "Party" },
  { topic: "D66", query: "D66 OR @D66 OR Rob Jetten", cat: "Party" },
  { topic: "J21", query: "JA21 OR @JuisteAntwoord OR Eerdmans", cat: "Party" },
  { topic: "FvD", query: "FvD OR @fvdemocratie OR Baudet", cat: "Party" }
];

async function main() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ locale: "nl-NL" });
  
  await context.addCookies([
    { name: "auth_token", value: AUTH_TOKEN, domain: ".x.com", path: "/", secure: true },
    { name: "ct0", value: CT0, domain: ".x.com", path: "/", secure: true }
  ]);

  for (const item of TARGET_CONFIG) {
    console.log(`Scraping ${item.topic}...`);
    const page = await context.newPage();
    const url = `https://x.com/search?q=${encodeURIComponent(item.query + " lang:nl")}&f=live`;
    
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      // Logic from original scraper to collect and parse tweets 
      // ... (parsing and collection logic remains similar to original)
    } finally {
      await page.close();
    }
  }
  await browser.close();
}
main();
