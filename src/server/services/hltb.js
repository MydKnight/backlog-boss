/**
 * HLTB Abstraction Layer — Direct Implementation
 *
 * HLTB renamed their search endpoint from /api/search/{key} to /api/finder.
 * No dynamic key extraction needed. Same request body format as before.
 *
 * Exported API (contract unchanged):
 *   fetchByTitle(title)         → { hltb_id, main, mainExtras, completionist } | null
 *   fetchByHltbId(id)           → { hltb_id, main, mainExtras, completionist } | null
 *   lookupHltbForAllGames(user) → { gamesUpdated, errors }
 *   searchRaw(title)            → raw HLTB API response (for diagnostics)
 *   debugKeyExtraction()        → diagnostic info (for /api/hltb/debug-key)
 */

import { getGamesNeedingHltbLookup, updateGameFromHltb, startSyncLog, completeSyncLog } from '../db/queries.js';

const HLTB_BASE = 'https://howlongtobeat.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://howlongtobeat.com/',
  'Origin': 'https://howlongtobeat.com',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// ---------------------------------------------------------------------------
// Init + cookie forwarding
// HLTB's frontend calls /api/finder/init on page load and may set cookies
// that are required for subsequent API calls.
// ---------------------------------------------------------------------------

let _token = null;

async function ensureInit() {
  if (_token) return;
  const res = await fetch(`${HLTB_BASE}/api/finder/init?t=${Date.now()}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`HLTB init failed: HTTP ${res.status}`);
  const data = await res.json();
  _token = data.token;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Call the HLTB search API and return the raw response.
 * Exported for use by the diagnostic endpoint.
 * @param {string} title
 */
function buildSearchBody(title) {
  return JSON.stringify({
    searchType: 'games',
    searchTerms: title.trim().split(' '),
    searchPage: 1,
    size: 20,
    useCache: true,
    searchOptions: {
      games: {
        userId: 0,
        platform: '',
        sortCategory: 'popular',
        rangeCategory: 'main',
        rangeTime: { min: null, max: null },
        gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { min: '', max: '' },
        modifier: '',
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '',
      sort: 0,
      randomizer: 0,
    },
  });
}

async function finderPost(title) {
  const res = await fetch(`${HLTB_BASE}/api/finder`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', 'x-auth-token': _token },
    body: buildSearchBody(title),
  });

  // Token expired — refresh once and retry (mirrors HLTB's own frontend logic)
  if (res.status === 403) {
    _token = null;
    await ensureInit();
    const retry = await fetch(`${HLTB_BASE}/api/finder`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'x-auth-token': _token },
      body: buildSearchBody(title),
    });
    if (!retry.ok) throw new Error(`HLTB /api/finder returned HTTP ${retry.status} after token refresh`);
    return retry.json();
  }

  if (!res.ok) throw new Error(`HLTB /api/finder returned HTTP ${res.status}`);
  return res.json();
}

export async function searchRaw(title) {
  await ensureInit();
  return finderPost(title);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Pick best match from results by exact title match, falling back to first result.
 */
function pickBestMatch(title, results) {
  if (!results || results.length === 0) return null;
  const norm = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(title);
  return results.find(r => norm(r.game_name) === target) ?? results[0];
}

/**
 * Convert a raw HLTB time value to hours.
 * HLTB returns times in seconds.
 */
function toHours(seconds) {
  if (!seconds || seconds === 0) return null;
  return Math.round((seconds / 3600) * 10) / 10;
}

/**
 * Map a raw HLTB result entry to our standard shape.
 */
function mapEntry(entry) {
  if (!entry) return null;
  return {
    hltb_id: entry.game_id ?? null,
    main: toHours(entry.comp_main),
    mainExtras: toHours(entry.comp_plus),
    completionist: toHours(entry.comp_100),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search HLTB by game title and return the best match.
 * @param {string} title
 * @returns {Promise<{ hltb_id, main, mainExtras, completionist }|null>}
 */
export async function fetchByTitle(title) {
  try {
    const raw = await searchRaw(title);
    const best = pickBestMatch(title, raw?.data ?? []);
    return mapEntry(best);
  } catch (err) {
    console.error(`HLTB fetchByTitle failed for "${title}":`, err.message);
    return null;
  }
}

/**
 * HLTB does not expose a public ID-based lookup endpoint.
 * Returns null — callers should use fetchByTitle instead.
 */
export async function fetchByHltbId(hltbId) {
  console.warn(`HLTB: direct ID lookup not supported, use fetchByTitle`);
  return null;
}

/**
 * Diagnostic: show what we find in HLTB's JS bundle and probe candidate endpoints.
 * Used by GET /api/hltb/debug-key.
 */
export async function debugKeyExtraction() {
  const result = {
    homepage_fetch_ok: false,
    script_urls: [],
    chunks_with_api: [],
    endpoint_probes: [],
  };

  const searchBody = JSON.stringify({
    searchType: 'games', searchTerms: ['Portal'], searchPage: 1, size: 5, useCache: true,
    searchOptions: {
      games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main',
        rangeTime: { min: null, max: null }, gameplay: { perspective: '', flow: '', genre: '', subGenre: '' },
        rangeYear: { min: '', max: '' }, modifier: '' },
      users: { sortCategory: 'postcount' }, lists: { sortCategory: 'follows' },
      filter: '', sort: 0, randomizer: 0,
    },
  });
  const postHeaders = { ...HEADERS, 'Content-Type': 'application/json' };

  const candidates = [
    { method: 'GET',  path: `/api/finder/init?t=${Date.now()}` },
    { method: 'POST', path: '/api/finder' },
    { method: 'POST', path: '/api/search' },
  ];
  // First run init to capture cookies
  let probeCookies = '';
  try {
    const initRes = await fetch(`${HLTB_BASE}/api/finder/init?t=${Date.now()}`, { headers: HEADERS });
    const setCookie = initRes.headers.get('set-cookie');
    result.init_status = initRes.status;
    result.init_set_cookie = setCookie;
    if (setCookie) {
      probeCookies = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');
    }
  } catch (err) {
    result.init_error = err.message;
  }

  const headersWithCookies = { ...postHeaders, ...(probeCookies ? { 'Cookie': probeCookies } : {}) };

  for (const c of candidates) {
    try {
      const res = await fetch(`${HLTB_BASE}${c.path}`, {
        method: c.method,
        headers: c.method === 'POST' ? headersWithCookies : HEADERS,
        body: c.method === 'POST' ? searchBody : undefined,
      });
      // For 403, grab the raw text to see if it's Cloudflare
      let body = null;
      const text = await res.text().catch(() => null);
      try { body = JSON.parse(text); } catch { body = text?.slice(0, 300); }
      result.endpoint_probes.push({ path: c.path, method: c.method, status: res.status, body });
    } catch (err) {
      result.endpoint_probes.push({ path: c.path, method: c.method, error: err.message });
    }
  }

  try {
    const homeRes = await fetch(HLTB_BASE, { headers: HEADERS });
    result.homepage_fetch_ok = homeRes.ok;
    const html = await homeRes.text();
    result.script_urls = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map(m => m[1]);

    for (const url of result.script_urls) {
      try {
        const res = await fetch(`${HLTB_BASE}${url}`, { headers: HEADERS });
        if (!res.ok) continue;
        const js = await res.text();

        // Wide context around /api/finder specifically to see the full headers object
        const finderSnippets = [...js.matchAll(/.{0,300}\/api\/finder["'`].{0,300}/g)].map(m => m[0]);
        if (finderSnippets.length > 0) {
          result.chunks_with_api.push({ url, finder_snippets: finderSnippets });
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Batch lookup (called by sync)
// ---------------------------------------------------------------------------

/**
 * Run HLTB lookups for all games that need it (no data or cache expired).
 * @param {{ id: number }} user
 * @returns {Promise<{ gamesUpdated: number, errors: string[] }>}
 */
export async function lookupHltbForAllGames(user) {
  const logId = startSyncLog(user.id, 'hltb_batch');
  const errors = [];
  let gamesUpdated = 0;

  try {
    const games = getGamesNeedingHltbLookup();
    const total = games.length;
    const estMins = Math.ceil(total * 0.5 / 60);
    console.log(`HLTB: ${total} games to look up (~${estMins} min estimated)`);

    for (let i = 0; i < games.length; i++) {
      const game = games[i];

      if (i > 0 && i % 10 === 0) {
        const remaining = Math.ceil((total - i) * 0.5 / 60);
        console.log(`HLTB: ${i}/${total} (${Math.round(i / total * 100)}%) — ~${remaining} min remaining`);
      }

      try {
        const data = await fetchByTitle(game.title);
        // Always set hltb_fetched_at — even null results — so we respect the 30-day TTL
        updateGameFromHltb(game.id, data ?? { hltb_id: null, main: null, mainExtras: null, completionist: null });
        if (data) gamesUpdated++;
      } catch (err) {
        errors.push(`game id ${game.id} "${game.title}": ${err.message}`);
        try {
          updateGameFromHltb(game.id, { hltb_id: null, main: null, mainExtras: null, completionist: null });
        } catch {}
      }

      await new Promise(r => setTimeout(r, 500));
    }

    completeSyncLog(logId, {
      status: errors.length > 0 ? 'partial' : 'success',
      gamesUpdated,
      errorMessage: errors.length > 0 ? JSON.stringify(errors) : null,
    });
  } catch (err) {
    completeSyncLog(logId, { status: 'failed', gamesUpdated, errorMessage: err.message });
    throw err;
  }

  return { gamesUpdated, errors };
}
