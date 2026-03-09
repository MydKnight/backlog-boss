import PQueue from 'p-queue';
import { getGamesNeedingIgdbEnrich, updateGameFromIgdb, linkPendingSteamGamesToIgdb, startSyncLog, completeSyncLog } from '../db/queries.js';

const IGDB_BASE = 'https://api.igdb.com/v4';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

// 4 requests per second — IGDB rate limit
const queue = new PQueue({ intervalCap: 4, interval: 1000 });

// In-memory token cache
let tokenCache = { token: null, expiresAt: 0 };

/**
 * Get a valid Twitch/IGDB bearer token, refreshing if expired.
 * @returns {Promise<string>}
 */
async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;

  const res = await fetch(
    `${TWITCH_TOKEN_URL}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );

  if (!res.ok) throw new Error(`Twitch token request failed: HTTP ${res.status}`);

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    // Refresh 5 minutes before actual expiry
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
  };

  return tokenCache.token;
}

/**
 * Make a rate-limited IGDB API request.
 * Handles 401 (token expired) with one retry.
 * @param {string} endpoint
 * @param {string} body  Apicalypse query string
 */
async function igdbRequest(endpoint, body) {
  return queue.add(async () => {
    const doRequest = async () => {
      const token = await getToken();
      const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Client-ID': process.env.IGDB_CLIENT_ID,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body,
      });

      if (res.status === 401) {
        // Force token refresh and retry once
        tokenCache = { token: null, expiresAt: 0 };
        return null; // signal retry
      }

      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1000));
        return null; // signal retry
      }

      if (!res.ok) throw new Error(`IGDB ${res.status} on ${endpoint}`);
      return res.json();
    };

    let result = await doRequest();
    if (result === null) result = await doRequest(); // one retry
    return result;
  });
}

/**
 * Format an IGDB cover URL to a usable https URL with a larger image size.
 * @param {string|undefined} url
 */
function formatCoverUrl(url) {
  if (!url) return null;
  return 'https:' + url.replace('t_thumb', 't_cover_big');
}

/**
 * Look up a single game on IGDB by Steam App ID.
 * @param {number} steamAppId
 * @returns {Promise<object|null>}
 */
/**
 * Look up a single game on IGDB by Steam App ID.
 * Uses the external_games endpoint without a category filter — IGDB's Steam
 * category data is unreliable (category field missing on many Steam entries).
 * When multiple candidates share a uid, title-matching picks the right one.
 * @param {number} steamAppId
 * @param {string} [steamTitle]  Steam game title used to disambiguate multiple candidates
 * @returns {Promise<object|null>}
 */
export async function lookupBySteamAppId(steamAppId, steamTitle = null) {
  try {
    // Step 1: get all external_games records for this uid (no category filter)
    const extResults = await igdbRequest('external_games', `
      fields game, uid, category;
      where uid = "${steamAppId}";
      limit 10;
    `);

    if (!extResults || extResults.length === 0) return null;

    const gameIds = [...new Set(extResults.map(e => e.game).filter(Boolean))];
    if (gameIds.length === 0) return null;

    // Step 2: fetch all candidate games in one request
    const gameResults = await igdbRequest('games', `
      fields id, name, cover.url, genres.name, themes.name, similar_games;
      where id = (${gameIds.join(',')});
      limit ${gameIds.length};
    `);

    if (!gameResults || gameResults.length === 0) return null;

    // Step 3: if multiple candidates, pick the closest title match
    let game;
    if (steamTitle && gameResults.length > 1) {
      const norm = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
      const target = norm(steamTitle);
      game = gameResults.find(g => norm(g.name) === target) ?? gameResults[0];
    } else {
      game = gameResults[0];
    }

    return {
      igdbId: game.id,
      title: game.name,
      coverUrl: formatCoverUrl(game.cover?.url),
      genres: (game.genres ?? []).map(g => g.name),
      themes: (game.themes ?? []).map(t => t.name),
      similarIgdbIds: game.similar_games ?? [],
    };
  } catch (err) {
    console.error(`IGDB lookup failed for steam appid ${steamAppId}:`, err.message);
    return null;
  }
}

/**
 * Search IGDB by game name (used for History view search).
 * @param {string} query
 * @returns {Promise<object[]>}
 */
export async function searchByName(query) {
  try {
    const results = await igdbRequest('games', `
      fields id, name, cover.url, genres.name, themes.name, first_release_date, platforms.name;
      search "${query.replace(/"/g, '')}";
      limit 10;
    `);

    return (results ?? []).map(game => ({
      igdbId: game.id,
      title: game.name,
      coverUrl: formatCoverUrl(game.cover?.url),
      genres: (game.genres ?? []).map(g => g.name),
      themes: (game.themes ?? []).map(t => t.name),
      platforms: (game.platforms ?? []).map(p => p.name),
      releaseDate: game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : null,
    }));
  } catch (err) {
    console.error(`IGDB search failed for "${query}":`, err.message);
    return [];
  }
}

/**
 * Raw diagnostic lookup — returns intermediate results at each step so failures are visible.
 * Only used by GET /api/igdb/raw-lookup.
 * @param {number} steamAppId
 */
export async function igdbRawLookup(steamAppId) {
  const detail = {
    steamAppId,
    // Try 1: external_games with uid + category = 1 (Steam)
    ext_uid_and_category: null,
    ext_uid_and_category_error: null,
    // Try 2: external_games with uid only (no category filter — see if uid matches at all)
    ext_uid_only: null,
    ext_uid_only_error: null,
    // Try 3: external_games with no filter (sanity check — can we read this endpoint at all?)
    ext_any: null,
    ext_any_error: null,
    // Try 4: games search by name (bypass external_games entirely)
    games_by_name: null,
    games_by_name_error: null,
  };

  try {
    detail.ext_uid_and_category = await igdbRequest('external_games',
      `fields game, uid, category; where uid = "${steamAppId}" & category = 1; limit 1;`
    );
  } catch (err) { detail.ext_uid_and_category_error = err.message; }

  try {
    detail.ext_uid_only = await igdbRequest('external_games',
      `fields game, uid, category; where uid = "${steamAppId}"; limit 5;`
    );
  } catch (err) { detail.ext_uid_only_error = err.message; }

  try {
    detail.ext_any = await igdbRequest('external_games',
      `fields game, uid, category; limit 3;`
    );
  } catch (err) { detail.ext_any_error = err.message; }

  try {
    detail.games_by_name = await igdbRequest('games',
      `fields id, name, cover.url, genres.name; search "Portal"; limit 3;`
    );
  } catch (err) { detail.games_by_name_error = err.message; }

  return detail;
}

/**
 * Enrich all games that are missing IGDB data (or have stale data).
 * Runs after Steam sync. Logs to sync_log.
 * @param {{ id: number }} user
 * @returns {Promise<{ gamesUpdated: number, errors: string[] }>}
 */
export async function enrichGamesFromIgdb(user) {
  const logId = startSyncLog(user.id, 'igdb_enrich');
  const errors = [];
  let gamesUpdated = 0;

  try {
    const games = getGamesNeedingIgdbEnrich();
    const total = games.length;
    console.log(`IGDB: ${total} games to enrich`);

    for (let i = 0; i < games.length; i++) {
      const game = games[i];

      if (i > 0 && i % 25 === 0) {
        console.log(`IGDB: ${i}/${total} (${Math.round(i / total * 100)}%) — ${gamesUpdated} matched so far`);
      }

      const igdbData = await lookupBySteamAppId(game.steam_app_id, game.title);

      if (igdbData) {
        try {
          updateGameFromIgdb(game.steam_app_id, igdbData);
          gamesUpdated++;
        } catch (err) {
          errors.push(`steam_app_id ${game.steam_app_id}: ${err.message}`);
        }
      }
    }

    // Create user_games rows for any games that now have an igdb_id
    const linked = linkPendingSteamGamesToIgdb(user.id);
    console.log(`Linked ${linked} previously unmatched games to user_games`);

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
