/**
 * HLTB Abstraction Layer
 *
 * ALL HowLongToBeat access in this codebase goes through this file only.
 * The howlongtobeat npm package is unofficial and breaks periodically.
 * When it does, this is the only file that needs updating.
 *
 * Exposed API (the rest of the app only calls these):
 *   fetchByTitle(title)    → { hltb_id, main, mainExtras, completionist } | null
 *   fetchByHltbId(id)      → { hltb_id, main, mainExtras, completionist } | null
 */

import { getGamesNeedingHltbLookup, updateGameFromHltb, startSyncLog, completeSyncLog } from '../db/queries.js';

// Dynamic import — isolates breakage if the package changes its export shape
let _hltbService = null;
async function getService() {
  if (!_hltbService) {
    const mod = await import('howlongtobeat');
    const Ctor = mod.default ?? mod.HowLongToBeatService;
    _hltbService = new Ctor();
  }
  return _hltbService;
}

/**
 * Normalise a title for comparison (lowercase, strip punctuation).
 * @param {string} title
 */
function normalise(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Pick the best match from HLTB search results.
 * Prefers exact normalised title match; falls back to first result.
 * @param {string} title
 * @param {object[]} results
 */
function pickBestMatch(title, results) {
  if (!results || results.length === 0) return null;
  const norm = normalise(title);
  const exact = results.find(r => normalise(r.name) === norm);
  return exact ?? results[0];
}

/**
 * Map a raw HLTB result object to our standard shape.
 * Property names vary between package versions — handled defensively.
 * @param {object} entry
 */
function mapEntry(entry) {
  if (!entry) return null;
  return {
    hltb_id: entry.id ?? entry.gameId ?? null,
    main: entry.gameplayMain ?? entry.comp_main ?? null,
    mainExtras: entry.gameplayMainExtra ?? entry.comp_plus ?? null,
    completionist: entry.gameplayCompletionist ?? entry.comp_100 ?? null,
  };
}

/**
 * Search HLTB by game title and return the best match.
 * @param {string} title
 * @returns {Promise<{ hltb_id: number, main: number, mainExtras: number, completionist: number }|null>}
 */
export async function fetchByTitle(title) {
  try {
    const svc = await getService();
    const results = await svc.search([title]);
    const best = pickBestMatch(title, results);
    return mapEntry(best);
  } catch (err) {
    console.error(`HLTB fetchByTitle failed for "${title}":`, err.message);
    return null;
  }
}

/**
 * Look up a specific HLTB entry by ID.
 * @param {number} hltbId
 * @returns {Promise<{ hltb_id: number, main: number, mainExtras: number, completionist: number }|null>}
 */
export async function fetchByHltbId(hltbId) {
  try {
    const svc = await getService();
    // Some versions expose detail(), others require search by id
    if (typeof svc.detail === 'function') {
      const entry = await svc.detail(hltbId);
      return mapEntry(entry);
    }
    // Fallback: not all package versions support direct ID lookup
    console.warn('HLTB: direct ID lookup not available in this package version');
    return null;
  } catch (err) {
    console.error(`HLTB fetchByHltbId failed for id ${hltbId}:`, err.message);
    return null;
  }
}

/**
 * Run HLTB lookups for all games that need it (no data or cache expired).
 * Inserts a 500ms delay between requests to be polite to the unofficial API.
 * @param {{ id: number }} user
 * @returns {Promise<{ gamesUpdated: number, errors: string[] }>}
 */
export async function lookupHltbForAllGames(user) {
  const logId = startSyncLog(user.id, 'hltb_batch');
  const errors = [];
  let gamesUpdated = 0;

  try {
    const games = getGamesNeedingHltbLookup();

    for (const game of games) {
      try {
        const data = await fetchByTitle(game.title);

        if (data) {
          updateGameFromHltb(game.id, data);
          gamesUpdated++;
        } else {
          // Mark as attempted so we don't retry until TTL expires
          updateGameFromHltb(game.id, { hltb_id: null, main: null, mainExtras: null, completionist: null });
        }
      } catch (err) {
        errors.push(`game id ${game.id} "${game.title}": ${err.message}`);
      }

      // Polite delay between HLTB requests
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
