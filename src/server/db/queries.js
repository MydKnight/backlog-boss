import { getDb } from './schema.js';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function getUser(userId) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

export function getDefaultUser() {
  return getDb().prepare('SELECT * FROM users LIMIT 1').get();
}

export function createDefaultUser({ ollamaEndpoint, ollamaModel }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO users (username, ollama_endpoint, ollama_model)
    VALUES ('owner', :ollamaEndpoint, :ollamaModel)
  `).run({ ollamaEndpoint, ollamaModel });
  return getDefaultUser();
}

export function updateUserSteamCredentials(userId, { steamApiKey, steamId }) {
  getDb().prepare(`
    UPDATE users SET steam_api_key = :steamApiKey, steam_id = :steamId,
    updated_at = CURRENT_TIMESTAMP WHERE id = :userId
  `).run({ steamApiKey, steamId, userId });
}

// ---------------------------------------------------------------------------
// Games (canonical IGDB records)
// ---------------------------------------------------------------------------

export function getGameBySteamAppId(steamAppId) {
  return getDb().prepare('SELECT * FROM games WHERE steam_app_id = ?').get(steamAppId);
}

export function getGameByIgdbId(igdbId) {
  return getDb().prepare('SELECT * FROM games WHERE igdb_id = ?').get(igdbId);
}

/**
 * Insert a minimal game record from Steam data (before IGDB enrichment).
 * Returns the new row's id.
 */
export function upsertGameFromSteam({ steamAppId, title }) {
  const db = getDb();
  const existing = getGameBySteamAppId(steamAppId);
  if (existing) return existing;

  db.prepare(`
    INSERT INTO games (steam_app_id, title)
    VALUES (:steamAppId, :title)
  `).run({ steamAppId, title });

  return getGameBySteamAppId(steamAppId);
}

/**
 * Enrich a games row with IGDB metadata.
 * If the igdb_id is already claimed by a different steam_app_id (duplicate Steam
 * entries pointing to the same IGDB game), the update is skipped — the first
 * match wins and the duplicate Steam entry is left without an igdb_id.
 */
export function updateGameFromIgdb(steamAppId, { igdbId, title, coverUrl, genres, themes, similarIgdbIds }) {
  const db = getDb();

  // Guard: if this igdb_id already belongs to a different steam_app_id, skip
  const conflict = db.prepare(
    'SELECT steam_app_id FROM games WHERE igdb_id = ? AND steam_app_id != ?'
  ).get(igdbId, steamAppId);

  if (conflict) return; // duplicate — leave this steam entry without an igdb_id

  db.prepare(`
    UPDATE games SET
      igdb_id          = :igdbId,
      title            = :title,
      cover_url        = :coverUrl,
      genres           = :genres,
      themes           = :themes,
      similar_igdb_ids = :similarIgdbIds,
      igdb_fetched_at  = CURRENT_TIMESTAMP,
      updated_at       = CURRENT_TIMESTAMP
    WHERE steam_app_id = :steamAppId
  `).run({
    igdbId,
    title,
    coverUrl,
    genres: JSON.stringify(genres || []),
    themes: JSON.stringify(themes || []),
    similarIgdbIds: JSON.stringify(similarIgdbIds || []),
    steamAppId,
  });
}

/**
 * Update a games row with HLTB data.
 */
export function updateGameFromHltb(gameId, { hltb_id, main, mainExtras, completionist }) {
  getDb().prepare(`
    UPDATE games SET
      hltb_id            = :hltb_id,
      hltb_main          = :main,
      hltb_main_extras   = :mainExtras,
      hltb_completionist = :completionist,
      hltb_fetched_at    = CURRENT_TIMESTAMP,
      updated_at         = CURRENT_TIMESTAMP
    WHERE id = :gameId
  `).run({ hltb_id, main, mainExtras, completionist, gameId });
}

/**
 * Games that have no IGDB ID yet and have a steam_app_id to look up.
 */
export function getGamesNeedingIgdbEnrich() {
  return getDb().prepare(`
    SELECT * FROM games
    WHERE steam_app_id IS NOT NULL
      AND (igdb_id IS NULL OR igdb_fetched_at < datetime('now', '-90 days'))
  `).all();
}

/**
 * Games that need a fresh HLTB lookup (never fetched or cache expired).
 */
/**
 * Clear hltb_fetched_at for games with no HLTB data so the next sync retries them.
 * Used to recover from a throttled batch run that marked games as fetched with no data.
 */
export function resetHltbFetchedAt() {
  const result = getDb().prepare(`
    UPDATE games SET hltb_fetched_at = NULL
    WHERE hltb_fetched_at IS NOT NULL AND hltb_main_extras IS NULL
  `).run();
  return result.changes;
}

// Minimum playtime (minutes) for a game to appear in the Now view.
// Games below this threshold appear in Next instead, even if status = in_progress.
export const NOW_THRESHOLD_MINUTES = 60;

/**
 * In-progress games for the Now view — only games at or above the playtime threshold.
 */
export function getInProgressGames(userId) {
  return getDb().prepare(`
    SELECT
      g.id, g.igdb_id, g.title, g.cover_url, g.genres,
      g.hltb_main, g.hltb_main_extras,
      ug.playtime_minutes, ug.last_played_at, ug.completion_pct_override
    FROM user_games ug
    JOIN games g ON g.igdb_id = ug.igdb_id
    WHERE ug.user_id = :userId
      AND ug.status = 'in_progress'
      AND ug.playtime_minutes >= :threshold
    ORDER BY
      CASE
        WHEN g.hltb_main_extras IS NOT NULL
          THEN CAST(ug.playtime_minutes AS REAL) / (g.hltb_main_extras * 60)
        WHEN g.hltb_main IS NOT NULL
          THEN CAST(ug.playtime_minutes AS REAL) / (g.hltb_main * 60)
        ELSE 0
      END DESC
  `).all({ userId, threshold: NOW_THRESHOLD_MINUTES });
}

/**
 * Unplayed games for the Next view — includes in_progress games below the Now threshold
 * so nothing falls through the cracks.
 */
export function getUnplayedGames(userId) {
  return getDb().prepare(`
    SELECT
      g.id, g.igdb_id, g.title, g.cover_url, g.genres,
      g.hltb_main, g.hltb_main_extras,
      ug.playtime_minutes
    FROM user_games ug
    JOIN games g ON g.igdb_id = ug.igdb_id
    WHERE ug.user_id = :userId
      AND (
        ug.status = 'unplayed'
        OR (ug.status = 'in_progress' AND ug.playtime_minutes < :threshold)
      )
    ORDER BY g.title ASC
  `).all({ userId, threshold: NOW_THRESHOLD_MINUTES });
}

/**
 * Push a game back to the Next view by setting status to unplayed.
 */
export function pushGameToNext(userId, igdbId) {
  getDb().prepare(`
    UPDATE user_games SET status = 'unplayed', updated_at = CURRENT_TIMESTAMP
    WHERE user_id = :userId AND igdb_id = :igdbId
  `).run({ userId, igdbId });
}

export function getGamesNeedingHltbLookup() {
  return getDb().prepare(`
    SELECT * FROM games
    WHERE hltb_fetched_at IS NULL
       OR hltb_fetched_at < datetime('now', '-30 days')
  `).all();
}

/**
 * Mark a game as completed. Writes game_events + game_interviews in a transaction.
 */
export function markGameBeaten(userId, igdbId, { starRating, positiveTags, negativeTags, freeText }) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE user_games SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = :userId AND igdb_id = :igdbId
    `).run({ userId, igdbId });

    const event = db.prepare(`
      INSERT INTO game_events (user_id, igdb_id, event_type, star_rating)
      VALUES (:userId, :igdbId, 'completed', :starRating)
    `).run({ userId, igdbId, starRating: starRating ?? null });

    db.prepare(`
      INSERT INTO game_interviews
        (user_id, game_event_id, igdb_id, interview_type, positive_tags, negative_tags, free_text)
      VALUES
        (:userId, :eventId, :igdbId, 'completed', :positiveTags, :negativeTags, :freeText)
    `).run({
      userId,
      eventId: event.lastInsertRowid,
      igdbId,
      positiveTags: JSON.stringify(positiveTags ?? []),
      negativeTags: JSON.stringify(negativeTags ?? []),
      freeText: freeText ?? null,
    });

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

/**
 * Mark a game as retired. Writes game_events + game_interviews in a transaction.
 */
export function markGameRetired(userId, igdbId, { negativeTags, freeText }) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE user_games SET status = 'retired', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = :userId AND igdb_id = :igdbId
    `).run({ userId, igdbId });

    const event = db.prepare(`
      INSERT INTO game_events (user_id, igdb_id, event_type)
      VALUES (:userId, :igdbId, 'retired')
    `).run({ userId, igdbId });

    db.prepare(`
      INSERT INTO game_interviews
        (user_id, game_event_id, igdb_id, interview_type, negative_tags, free_text)
      VALUES
        (:userId, :eventId, :igdbId, 'retired', :negativeTags, :freeText)
    `).run({
      userId,
      eventId: event.lastInsertRowid,
      igdbId,
      negativeTags: JSON.stringify(negativeTags ?? []),
      freeText: freeText ?? null,
    });

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

/**
 * Revert a completed or retired game back to in_progress.
 * Leaves game_events and game_interviews intact — history is preserved.
 */
export function revertGameToInProgress(userId, igdbId) {
  getDb().prepare(`
    UPDATE user_games SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
    WHERE user_id = :userId AND igdb_id = :igdbId
  `).run({ userId, igdbId });
}

/**
 * Completed games for the Done view, sorted by most recently beaten.
 */
export function getCompletedGames(userId) {
  return getDb().prepare(`
    SELECT
      g.id, g.igdb_id, g.title, g.cover_url,
      ge.id as event_id, ge.star_rating, ge.event_date,
      gi.positive_tags, gi.free_text
    FROM game_events ge
    JOIN games g ON g.igdb_id = ge.igdb_id
    LEFT JOIN game_interviews gi ON gi.game_event_id = ge.id
    WHERE ge.user_id = :userId AND ge.event_type = 'completed'
    ORDER BY ge.event_date DESC
  `).all({ userId });
}

// ---------------------------------------------------------------------------
// User Games
// ---------------------------------------------------------------------------

export function getUserGame(userId, igdbId) {
  return getDb().prepare(
    'SELECT * FROM user_games WHERE user_id = ? AND igdb_id = ?'
  ).get(userId, igdbId);
}

export function getUserGameBySteamAppId(userId, steamAppId) {
  return getDb().prepare(`
    SELECT ug.* FROM user_games ug
    JOIN games g ON g.igdb_id = ug.igdb_id
    WHERE ug.user_id = ? AND g.steam_app_id = ?
  `).get(userId, steamAppId);
}

/**
 * Create or update a user_games record from a Steam sync.
 * Does not downgrade status — won't change completed/retired back to in_progress.
 */
export function upsertUserGameFromSteam(userId, gameRow, { playtimeMinutes, lastPlayedAt }) {
  const db = getDb();

  // Determine status: use igdb_id if available, otherwise we'll update later
  const igdbId = gameRow.igdb_id ?? null;

  const existing = igdbId
    ? getUserGame(userId, igdbId)
    : null;

  const newStatus = playtimeMinutes > 0 ? 'in_progress' : 'unplayed';
  const protectedStatuses = ['completed', 'retired'];

  if (existing) {
    const status = protectedStatuses.includes(existing.status)
      ? existing.status
      : newStatus;

    db.prepare(`
      UPDATE user_games SET
        playtime_minutes = :playtimeMinutes,
        last_played_at   = :lastPlayedAt,
        steam_synced_at  = CURRENT_TIMESTAMP,
        status           = :status,
        updated_at       = CURRENT_TIMESTAMP
      WHERE user_id = :userId AND igdb_id = :igdbId
    `).run({ playtimeMinutes, lastPlayedAt, status, userId, igdbId });
  } else if (igdbId) {
    db.prepare(`
      INSERT INTO user_games
        (user_id, igdb_id, ownership_type, status, playtime_minutes,
         playtime_source, last_played_at, steam_synced_at)
      VALUES
        (:userId, :igdbId, 'owned_steam', :status, :playtimeMinutes,
         'steam', :lastPlayedAt, CURRENT_TIMESTAMP)
    `).run({ userId, igdbId, status: newStatus, playtimeMinutes, lastPlayedAt });
  }
  // If no igdb_id yet, the record will be created/linked during IGDB enrichment
}

/**
 * After IGDB enrichment, create any user_games rows that couldn't be created
 * during Steam sync (because igdb_id wasn't known yet).
 */
export function linkPendingSteamGamesToIgdb(userId) {
  const db = getDb();

  // Find Steam games that now have an igdb_id but no user_games row
  const unlinked = db.prepare(`
    SELECT g.igdb_id, g.steam_app_id
    FROM games g
    WHERE g.igdb_id IS NOT NULL
      AND g.steam_app_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_games ug
        WHERE ug.user_id = :userId AND ug.igdb_id = g.igdb_id
      )
  `).all({ userId });

  for (const game of unlinked) {
    // Check if we have any Steam playtime data via the games table
    db.prepare(`
      INSERT OR IGNORE INTO user_games
        (user_id, igdb_id, ownership_type, status, playtime_source)
      VALUES (:userId, :igdbId, 'owned_steam', 'unplayed', 'steam')
    `).run({ userId, igdbId: game.igdb_id });
  }

  return unlinked.length;
}

// ---------------------------------------------------------------------------
// Sync Log
// ---------------------------------------------------------------------------

export function startSyncLog(userId, syncType) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sync_log (user_id, sync_type, status, started_at)
    VALUES (:userId, :syncType, 'running', CURRENT_TIMESTAMP)
  `).run({ userId, syncType });
  return result.lastInsertRowid;
}

export function completeSyncLog(logId, { status, gamesUpdated, errorMessage }) {
  getDb().prepare(`
    UPDATE sync_log SET
      status        = :status,
      games_updated = :gamesUpdated,
      error_message = :errorMessage,
      completed_at  = CURRENT_TIMESTAMP
    WHERE id = :logId
  `).run({ status, gamesUpdated: gamesUpdated || 0, errorMessage: errorMessage || null, logId });
}

export function getRecentSyncLogs(userId, limit = 10) {
  return getDb().prepare(`
    SELECT * FROM sync_log
    WHERE user_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(userId, limit);
}
