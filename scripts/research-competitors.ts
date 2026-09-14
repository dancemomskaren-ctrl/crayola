import { mkdir } from "fs/promises";
import { join } from "path";

const SITES = ["https://opus.pro", "https://descript.com", "https://submagic.co"];
const RESEARCH_DIR = join(import.meta.dir, "../data/research");

export function visibleText(html: string): string {
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<\/?(?:div|p|li|h[1-6]|section|tr|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&(amp|nbsp|quot|apos|lt|gt|dollar);/g, (_, entity) => ({ amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", dollar: "$" })[entity]!)
    .split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export function extractCompetitorPage(html: string, url: string) {
  const lines = [...new Set(visibleText(html).split("\n"))];
  return {
    url,
    features: lines.filter(line => /\b(?:caption\w*|clip\w*|transcri\w*|edit\w*|refram\w*|dubb\w*|translation|brand\w*|watermark\w*|export\w*|collaborat\w*|publish\w*|b-roll|voice\w*|audio|subtitle\w*)\b/i.test(line)),
    pricing: lines.flatMap((line, index) => /(?:[$€£]\s*\d|\d\s*(?:USD|EUR)|\b(?:free|starter|hobbyist|creator|business|enterprise)\s*(?:plan|tier)|billed|per month|\/mo\b)/i.test(line) ? [lines.slice(Math.max(0, index - 1), index + 3).join(" | ")] : []),
    ministryMentions: lines.filter(line => /\b(?:church(?:es)?|sermons?)\b/i.test(line)),
  };
}

async function fetchPage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "CrayolaResearch/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${url}`);
  const html = await response.text();
  if (!html.trim()) throw new Error(`Empty page at ${url}`);
  return { html, url: response.url };
}

export async function researchCompetitors() {
  const results = [];
  for (const site of SITES) {
    try {
      const home = await fetchPage(site);
      const pages = [extractCompetitorPage(home.html, home.url)];
      const pricingLink = [...home.html.matchAll(/href=["']([^"']*pric(?:ing|e)[^"']*)["']/gi)]
        .map(match => new URL(match[1], home.url))
        .find(url => url.origin === new URL(home.url).origin && url.pathname !== "/");
      // Pricing is often on a separate page, so include its source explicitly.
      const pricing = await fetchPage(pricingLink?.href || new URL("/pricing", home.url).href);
      pages.push(extractCompetitorPage(pricing.html, pricing.url));
      if (!pages.some(page => page.features.length) || !pages.some(page => page.pricing.length)) throw new Error(`Could not extract features and pricing from ${site}`);
      results.push({ site, status: "ok", pages });
      console.log(`Researched ${site}`);
    } catch (error) {
      results.push({ site, status: "error", error: String(error) });
      console.error(`${site}: ${error}`);
    }
  }
  await mkdir(RESEARCH_DIR, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const path = join(RESEARCH_DIR, `competitors-${fetchedAt.slice(0, 10)}.json`);
  await Bun.write(path, JSON.stringify({ fetchedAt, method: "Visible page text candidates; pricing retains neighboring text for billing context.", competitors: results }, null, 2));
  console.log(path);
  if (results.some(result => result.status === "error")) throw new Error("Competitor research is incomplete; see saved errors.");
  return path;
}

if (import.meta.main) {
  researchCompetitors().catch(error => { console.error(error.message); process.exitCode = 1; });
}
