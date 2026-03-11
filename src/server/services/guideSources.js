/**
 * Guide source search service.
 *
 * Currently searches Steam Community guides only — exact match by Steam App ID,
 * no title ambiguity, no bot protection issues.
 *
 * GameFAQs, StrategyWiki: return 403 (Cloudflare bot protection) — use Paste Content mode.
 * TrueAchievements, TrueTrophies: search results are low quality — removed.
 *
 * Result shape: { title, url, site, type }
 */

import { JSDOM } from 'jsdom';

const TIMEOUT_MS = 10_000;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS });
    console.log(`[guideSources] ${res.status} ${url}`);
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.log(`[guideSources] FAIL ${url} — ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search Steam Community guides for a game by its Steam App ID.
 * Returns top-rated guides (Steam's default sort for the listing page).
 *
 * @param {number} steamAppId
 * @returns {Promise<Array<{title,url,site,type}>>}
 */
export async function searchSteamGuides(steamAppId) {
  const listingUrl = `https://steamcommunity.com/app/${steamAppId}/guides/?browsefilter=toprated`;
  const html = await fetchHtml(listingUrl);
  if (!html) return [];

  const doc = new JSDOM(html, { url: listingUrl }).window.document;

  const anchors = [...doc.querySelectorAll('a[href*="sharedfiles/filedetails"]')]
    .filter(a => (a.getAttribute('href') ?? '').includes('?id='));

  const seen = new Set();
  const results = [];

  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (seen.has(href)) continue;
    seen.add(href);

    const titleEl =
      a.querySelector('.workshopItemTitle') ??
      a.closest('.workshopItem')?.querySelector('.workshopItemTitle');
    const label = (titleEl?.textContent ?? a.textContent).trim();
    if (!label || label.length < 2) continue;

    results.push({
      title: label,
      url: href.startsWith('http') ? href : `https://steamcommunity.com${href}`,
      site: 'steam',
      type: 'guide',
    });
    if (results.length >= 8) break;
  }

  console.log(`[guideSources] Steam: ${results.length} guides found for appId ${steamAppId}`);
  return results;
}

/**
 * Search all sources in parallel.
 * Currently Steam only — steamAppId is required for any results.
 *
 * @param {number|null} steamAppId
 * @returns {Promise<Array<{title,url,site,type}>>}
 */
export async function searchAllSites(steamAppId = null) {
  if (!steamAppId) return [];
  const [steam] = await Promise.allSettled([searchSteamGuides(steamAppId)]);
  return steam.status === 'fulfilled' ? steam.value : [];
}
