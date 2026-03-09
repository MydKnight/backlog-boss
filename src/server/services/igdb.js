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
export async function lookupBySteamAppId(steamAppId) {
  try {
    const results = await igdbRequest('games', `
      fields id, name, cover.url, genres.name, themes.name, similar_games, first_release_date;
      where external_games.uid = "${steamAppId}" & external_games.category = 1;
      limit 1;
    `);

    if (!results || results.length === 0) return null;

    const game = results[0];
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

    for (const game of games) {
      const igdbData = await lookupBySteamAppId(game.steam_app_id);

      if (igdbData) {
        try {
          updateGameFromIgdb(game.steam_app_id, igdbData);
          gamesUpdated++;
        } catch (err) {
          errors.push(`steam_app_id ${game.steam_app_id}: ${err.message}`);
        }
      } else {
        // No IGDB match — not an error, just log it
        console.log(`No IGDB match for "${game.title}" (appid ${game.steam_app_id})`);
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
