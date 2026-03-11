import { upsertGameFromSteam, upsertUserGameFromSteam, startSyncLog, completeSyncLog } from '../db/queries.js';

const STEAM_BASE = 'https://api.steampowered.com';

/**
 * Fetch with exponential backoff retry.
 * @param {string} url
 * @param {number} retries
 */
async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
}

/**
 * Pull the user's full Steam library and upsert into games + user_games.
 * @param {{ id: number, steam_id: string }} user
 * @returns {{ gamesUpdated: number, errors: string[] }}
 */
export async function syncSteamLibrary(user) {
  const logId = startSyncLog(user.id, 'steam_library');
  const errors = [];
  let gamesUpdated = 0;

  const steamApiKey = process.env.STEAM_API_KEY;
  if (!steamApiKey) throw new Error('STEAM_API_KEY environment variable is not set.');

  try {
    const url = `${STEAM_BASE}/IPlayerService/GetOwnedGames/v1/` +
      `?key=${steamApiKey}` +
      `&steamid=${user.steam_id}` +
      `&include_appinfo=true` +
      `&include_played_free_games=true` +
      `&format=json`;

    const res = await fetchWithRetry(url);
    const data = await res.json();
    const games = data?.response?.games ?? [];

    for (const steamGame of games) {
      try {
        const gameRow = upsertGameFromSteam({
          steamAppId: steamGame.appid,
          title: steamGame.name,
        });

        const lastPlayedAt = steamGame.rtime_last_played
          ? new Date(steamGame.rtime_last_played * 1000).toISOString()
          : null;

        upsertUserGameFromSteam(user.id, gameRow, {
          playtimeMinutes: steamGame.playtime_forever ?? 0,
          lastPlayedAt,
        });

        gamesUpdated++;
      } catch (err) {
        errors.push(`appid ${steamGame.appid}: ${err.message}`);
      }
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

/**
 * Fetch achievement % for a single game. Called lazily, not during bulk sync.
 * @param {{ steam_api_key: string, steam_id: string }} user
 * @param {number} appId
 * @returns {number|null} percentage 0–100, or null if unavailable
 */
export async function fetchAchievementPct(user, appId) {
  try {
    const url = `${STEAM_BASE}/ISteamUserStats/GetPlayerAchievements/v1/` +
      `?key=${user.steam_api_key}` +
      `&steamid=${user.steam_id}` +
      `&appid=${appId}`;

    const res = await fetchWithRetry(url);
    const data = await res.json();
    const achievements = data?.playerstats?.achievements ?? [];

    if (achievements.length === 0) return null;

    const unlocked = achievements.filter(a => a.achieved === 1).length;
    return Math.round((unlocked / achievements.length) * 100);
  } catch {
    return null;
  }
}
