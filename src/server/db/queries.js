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

export function getUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
}

/**
 * Create a stub user for a new CF-authenticated email.
 * No Steam credentials — they'll be entered via Onboarding.
 */
export function createUserByEmail(email) {
  const db = getDb();
  const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
  const ollamaEmbedModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

  // Use the part before @ as default username
  const username = email.split('@')[0] || 'user';

  db.prepare(`
    INSERT INTO users (username, email, ollama_endpoint, ollama_model, ollama_embed_model)
    VALUES (:username, :email, :ollamaEndpoint, :ollamaModel, :ollamaEmbedModel)
  `).run({ username, email, ollamaEndpoint, ollamaModel, ollamaEmbedModel });

  return getUserByEmail(email);
}

/**
 * Update user profile settings (username and/or Steam credentials).
 * Only updates fields that are explicitly provided (not null/undefined).
 */
export function updateUserSettings(userId, { username, steamApiKey, steamId }) {
  const db = getDb();
  if (username !== undefined && username !== null) {
    db.prepare(`UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(username, userId);
  }
  if (steamApiKey !== undefined && steamApiKey !== null) {
    db.prepare(`UPDATE users SET steam_api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(steamApiKey, userId);
  }
  if (steamId !== undefined && steamId !== null) {
    db.prepare(`UPDATE users SET steam_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(steamId, userId);
  }
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
    'SELECT steam_app_id, title FROM games WHERE igdb_id = ? AND steam_app_id != ?'
  ).get(igdbId, steamAppId);

  if (conflict) return { ok: false, conflict }; // duplicate — leave this steam entry without an igdb_id

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

// Days of inactivity before an in_progress game is auto-demoted to backburner.
export const INACTIVITY_DAYS = 90;

/**
 * Demote stale in_progress games to backburner.
 * Targets games that haven't been played in INACTIVITY_DAYS days, or that
 * have playtime but no recorded last_played_at (played so long ago Steam
 * didn't track it).
 *
 * Sets status = 'backburner' so it survives future syncs and appears in Next.
 * Only affects status = 'in_progress' — ongoing/backburner/completed/retired untouched.
 *
 * @param {number} userId
 * @returns {{ demoted: number, titles: string[] }}
 */
export function demoteStaleInProgressGames(userId) {
  const db = getDb();
  const cutoff = new Date(Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Find stale games before updating so we can log titles
  const stale = db.prepare(`
    SELECT ug.igdb_id, g.title
    FROM user_games ug
    JOIN games g ON g.igdb_id = ug.igdb_id
    WHERE ug.user_id = :userId
      AND ug.status = 'in_progress'
      AND ug.playtime_minutes >= :threshold
      AND (
        ug.last_played_at IS NULL
        OR ug.last_played_at < :cutoff
      )
  `).all({ userId, threshold: NOW_THRESHOLD_MINUTES, cutoff });

  if (stale.length === 0) return { demoted: 0, titles: [] };

  db.prepare(`
    UPDATE user_games
    SET status = 'backburner', updated_at = CURRENT_TIMESTAMP
    WHERE user_id = :userId
      AND status = 'in_progress'
      AND playtime_minutes >= :threshold
      AND (
        last_played_at IS NULL
        OR last_played_at < :cutoff
      )
  `).run({ userId, threshold: NOW_THRESHOLD_MINUTES, cutoff });

  return { demoted: stale.length, titles: stale.map(g => g.title) };
}

/**
 * Ongoing games for the Now view "Always On" section.
 * These have no completion state — live service, sandboxes, board game apps, etc.
 */
export function getOngoingGames(userId) {
  return getDb().prepare(`
    SELECT
      g.id, g.igdb_id, g.title, g.cover_url, g.genres,
      ug.playtime_minutes, ug.last_played_at
    FROM user_games ug
    JOIN games g ON g.igdb_id = ug.igdb_id
    WHERE ug.user_id = :userId
      AND ug.status = 'ongoing'
    ORDER BY ug.last_played_at DESC NULLS LAST
  `).all({ userId });
}

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
 * and backburner games (explicitly deferred). Excludes ongoing.
 */
export function getUnplayedGames(userId) {
  return getDb().prepare(`
    SELECT
      g.id, g.igdb_id, g.title, g.cover_url, g.genres,
      g.hltb_main, g.hltb_main_extras,
      ug.playtime_minutes, ug.status
    FROM user_games ug
    JOIN games g ON g.igdb_id = ug.igdb_id
    WHERE ug.user_id = :userId
      AND (
        ug.status = 'unplayed'
        OR ug.status = 'backburner'
        OR (ug.status = 'in_progress' AND ug.playtime_minutes < :threshold)
      )
    ORDER BY g.title ASC
  `).all({ userId, threshold: NOW_THRESHOLD_MINUTES });
}

/**
 * Push a game to the backburner — survives Steam sync, excluded from Now.
 */
export function setBackburner(userId, igdbId) {
  getDb().prepare(`
    UPDATE user_games SET status = 'backburner', updated_at = CURRENT_TIMESTAMP
    WHERE user_id = :userId AND igdb_id = :igdbId
  `).run({ userId, igdbId });
}

/**
 * Mark a game as ongoing (live service / no completion state).
 * Excluded from Next and Done. Exit path is retired.
 */
export function setOngoing(userId, igdbId) {
  getDb().prepare(`
    UPDATE user_games SET status = 'ongoing', updated_at = CURRENT_TIMESTAMP
    WHERE user_id = :userId AND igdb_id = :igdbId
  `).run({ userId, igdbId });
}

/**
 * Restore a backburner (or unplayed) game to in_progress (Move to Now).
 * Bumps playtime to the Now threshold if the game has never been played,
 * so it clears the minimum-playtime filter and appears in the Now view immediately.
 */
export function restoreToNow(userId, igdbId) {
  getDb().prepare(`
    UPDATE user_games
    SET status = 'in_progress',
        playtime_minutes = MAX(playtime_minutes, :threshold),
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = :userId AND igdb_id = :igdbId
  `).run({ userId, igdbId, threshold: NOW_THRESHOLD_MINUTES });
}

/**
 * Auto-detection: games with no HLTB data and playtime > 10h that haven't
 * been classified as ongoing/backburner/completed/retired — likely live-service
 * or sandbox candidates.
 */
export function getOngoingCandidates(userId) {
  return getDb().prepare(`
    SELECT g.igdb_id, g.title, g.cover_url, ug.playtime_minutes
    FROM user_games ug
    JOIN games g ON g.igdb_id = ug.igdb_id
    WHERE ug.user_id = :userId
      AND ug.status = 'in_progress'
      AND ug.playtime_minutes > 600
      AND g.hltb_main IS NULL
    ORDER BY ug.playtime_minutes DESC
  `).all({ userId });
}

/**
 * @deprecated Use setBackburner instead. Kept for reference only.
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

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/**
 * Games that need an embedding generated — no embedding yet, or embedded with
 * a different model than currently configured.
 */
export function getGamesNeedingEmbedding(embedModel) {
  return getDb().prepare(`
    SELECT id, igdb_id, title, genres, themes
    FROM games
    WHERE embedding IS NULL
       OR embedding_model != ?
  `).all(embedModel);
}

/**
 * Store an embedding vector for a game.
 * @param {number} igdbId
 * @param {{ vector: number[], model: string }} param
 */
export function updateGameEmbedding(igdbId, { vector, model }) {
  getDb().prepare(`
    UPDATE games
    SET embedding = ?, embedding_model = ?, embedding_fetched_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE igdb_id = ?
  `).run(JSON.stringify(vector), model, igdbId);
}

/**
 * Fetch all game embeddings for ranking.
 * Only returns games that have an embedding stored.
 */
export function getAllGameEmbeddings() {
  return getDb().prepare(`
    SELECT igdb_id, title, cover_url, genres, themes, hltb_main_extras, hltb_main, embedding
    FROM games
    WHERE embedding IS NOT NULL
  `).all();
}

/**
 * Fetch all eligible candidate igdb_ids for a user — unplayed + backburner,
 * not snoozed. Used by the embedding ranker to filter to owned games only.
 */
export function getEligibleCandidateIds(userId) {
  const now = new Date().toISOString();
  return getDb().prepare(`
    SELECT ug.igdb_id, ug.status, ug.playtime_minutes, ug.taste_boost, ug.added_at
    FROM user_games ug
    WHERE ug.user_id = ?
      AND ug.status IN ('unplayed', 'backburner')
      AND (ug.snoozed_until IS NULL OR ug.snoozed_until < ?)
  `).all(userId, now);
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
 * starRating is optional — a retired game may still have a positive rating
 * (e.g. loved it but won't return) which feeds the taste engine positively.
 */
export function markGameRetired(userId, igdbId, { starRating, positiveTags, negativeTags, freeText }) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE user_games SET status = 'retired', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = :userId AND igdb_id = :igdbId
    `).run({ userId, igdbId });

    const event = db.prepare(`
      INSERT INTO game_events (user_id, igdb_id, event_type, star_rating)
      VALUES (:userId, :igdbId, 'retired', :starRating)
    `).run({ userId, igdbId, starRating: starRating ?? null });

    db.prepare(`
      INSERT INTO game_interviews
        (user_id, game_event_id, igdb_id, interview_type, positive_tags, negative_tags, free_text)
      VALUES
        (:userId, :eventId, :igdbId, 'retired', :positiveTags, :negativeTags, :freeText)
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
 * Add a non-Steam game to Now (currently playing on another platform).
 * Creates user_games with in_progress status and the given ownership_type.
 * If a row already exists, updates ownership_type and status only if not protected.
 */
export function addCurrentlyPlaying(userId, igdbId, { ownershipType, playtimeMinutes }) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT status FROM user_games WHERE user_id = :userId AND igdb_id = :igdbId'
  ).get({ userId, igdbId });

  const protectedStatuses = ['completed', 'retired'];

  if (existing) {
    if (!protectedStatuses.includes(existing.status)) {
      db.prepare(`
        UPDATE user_games SET
          status = 'in_progress',
          ownership_type = :ownershipType,
          playtime_minutes = :playtimeMinutes,
          playtime_source = 'manual',
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = :userId AND igdb_id = :igdbId
      `).run({ userId, igdbId, ownershipType, playtimeMinutes: playtimeMinutes ?? 0 });
    }
  } else {
    db.prepare(`
      INSERT INTO user_games
        (user_id, igdb_id, ownership_type, status, playtime_minutes, playtime_source)
      VALUES
        (:userId, :igdbId, :ownershipType, 'in_progress', :playtimeMinutes, 'manual')
    `).run({ userId, igdbId, ownershipType, playtimeMinutes: playtimeMinutes ?? 0 });
  }
}

/**
 * Insert a game record sourced directly from IGDB (not via Steam sync).
 * Uses INSERT OR IGNORE so existing records are never overwritten.
 */
export function upsertGameFromIgdb({ igdbId, title, coverUrl, genres, themes, similarIgdbIds }) {
  getDb().prepare(`
    INSERT OR IGNORE INTO games
      (igdb_id, title, cover_url, genres, themes, similar_igdb_ids, igdb_fetched_at)
    VALUES
      (:igdbId, :title, :coverUrl, :genres, :themes, :similarIgdbIds, CURRENT_TIMESTAMP)
  `).run({
    igdbId,
    title,
    coverUrl: coverUrl ?? null,
    genres: JSON.stringify(genres ?? []),
    themes: JSON.stringify(themes ?? []),
    similarIgdbIds: JSON.stringify(similarIgdbIds ?? []),
  });
}

/**
 * Log a game to History. Creates a user_games row (historical ownership) if one
 * doesn't exist, then writes game_events + game_interviews in a transaction.
 */
export function logHistoryGame(userId, igdbId, { starRating, positiveTags, freeText }) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT OR IGNORE INTO user_games
        (user_id, igdb_id, ownership_type, status, playtime_source)
      VALUES
        (:userId, :igdbId, 'historical', 'historical', 'manual')
    `).run({ userId, igdbId });

    const event = db.prepare(`
      INSERT INTO game_events (user_id, igdb_id, event_type, star_rating)
      VALUES (:userId, :igdbId, 'completed', :starRating)
    `).run({ userId, igdbId, starRating: starRating ?? null });

    db.prepare(`
      INSERT INTO game_interviews
        (user_id, game_event_id, igdb_id, interview_type, positive_tags, free_text)
      VALUES
        (:userId, :eventId, :igdbId, 'history', :positiveTags, :freeText)
    `).run({
      userId,
      eventId: event.lastInsertRowid,
      igdbId,
      positiveTags: JSON.stringify(positiveTags ?? []),
      freeText: freeText ?? null,
    });

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

/**
 * All played games (beaten, retired, or manually logged history), sorted by most recently logged.
 */
export function getHistoryGames(userId) {
  return getDb().prepare(`
    SELECT
      g.id, g.igdb_id, g.title, g.cover_url,
      ge.id as event_id, ge.event_type, ge.star_rating, ge.event_date,
      gi.positive_tags, gi.negative_tags, gi.free_text
    FROM game_events ge
    JOIN games g ON g.igdb_id = ge.igdb_id
    LEFT JOIN game_interviews gi ON gi.game_event_id = ge.id AND gi.user_id = :userId
    WHERE ge.user_id = :userId
    ORDER BY ge.event_date DESC
  `).all({ userId });
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
  const protectedStatuses = ['completed', 'retired', 'ongoing', 'backburner'];

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

// ---------------------------------------------------------------------------
// Taste Snapshots
// ---------------------------------------------------------------------------

/**
 * Get the most recent taste snapshot for a user.
 */
export function getLatestTasteSnapshot(userId) {
  return getDb().prepare(`
    SELECT * FROM taste_snapshots
    WHERE user_id = ?
    ORDER BY generated_at DESC
    LIMIT 1
  `).get(userId);
}

/**
 * Save a new taste snapshot. Keeps only the last 5 snapshots per user
 * (older ones are deleted) to avoid unbounded growth.
 * @param {number} userId
 * @param {{ modelUsed: string, contextHash: string, suggestions: object[] }} payload
 */
export function saveTasteSnapshot(userId, { modelUsed, contextHash, suggestions }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO taste_snapshots (user_id, model_used, context_hash, suggestions)
    VALUES (:userId, :modelUsed, :contextHash, :suggestions)
  `).run({
    userId,
    modelUsed,
    contextHash,
    suggestions: JSON.stringify(suggestions),
  });

  // Prune old snapshots — keep only the 5 most recent
  db.prepare(`
    DELETE FROM taste_snapshots
    WHERE user_id = ?
      AND id NOT IN (
        SELECT id FROM taste_snapshots
        WHERE user_id = ?
        ORDER BY generated_at DESC
        LIMIT 5
      )
  `).run(userId, userId);
}

/**
 * Assemble the taste profile context for a user.
 *
 * Returns completed/retired/in-progress game signals used to build the
 * taste profile text for embedding. Candidate ranking is handled separately
 * by the embedding service (rankCandidatesBySimilarity).
 *
 * Returns:
 *   completedGames  — all beaten games with ratings/tags
 *   retiredGames    — all retired games with reason tags
 *   inProgressGames — currently playing (context only)
 */
export function getTasteContext(userId) {
  const db = getDb();
  const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

  const completedGames = db.prepare(`
    SELECT
      g.title, g.genres, g.themes,
      ge.star_rating, ge.event_date,
      gi.positive_tags, gi.negative_tags, gi.free_text
    FROM game_events ge
    JOIN games g ON g.igdb_id = ge.igdb_id
    LEFT JOIN game_interviews gi ON gi.game_event_id = ge.id
    WHERE ge.user_id = :userId AND ge.event_type = 'completed'
    ORDER BY ge.event_date DESC
  `).all({ userId });

  const retiredGames = db.prepare(`
    SELECT
      g.title, g.genres, g.themes,
      gi.negative_tags, gi.free_text
    FROM game_events ge
    JOIN games g ON g.igdb_id = ge.igdb_id
    LEFT JOIN game_interviews gi ON gi.game_event_id = ge.id
    WHERE ge.user_id = :userId AND ge.event_type = 'retired'
    ORDER BY ge.event_date DESC
  `).all({ userId });

  const inProgressGames = db.prepare(`
    SELECT
      g.title, g.genres,
      ug.playtime_minutes, g.hltb_main_extras, g.hltb_main
    FROM user_games ug
    JOIN games g ON g.igdb_id = ug.igdb_id
    WHERE ug.user_id = :userId AND ug.status IN ('in_progress', 'ongoing')
      AND ug.playtime_minutes >= 60
    ORDER BY ug.playtime_minutes DESC
  `).all({ userId });

  return {
    completedGames: completedGames.map(g => ({
      title: g.title,
      genres: g.genres ? JSON.parse(g.genres) : [],
      star_rating: g.star_rating,
      positive_tags: g.positive_tags ? JSON.parse(g.positive_tags) : [],
      negative_tags: g.negative_tags ? JSON.parse(g.negative_tags) : [],
      free_text: g.free_text ?? null,
      recency_weight: g.event_date > twelveMonthsAgo ? 'recent' : 'older',
    })),
    retiredGames: retiredGames.map(g => ({
      title: g.title,
      genres: g.genres ? JSON.parse(g.genres) : [],
      negative_tags: g.negative_tags ? JSON.parse(g.negative_tags) : [],
      free_text: g.free_text ?? null,
    })),
    inProgressGames: inProgressGames.map(g => ({
      title: g.title,
      playtime_hours: g.playtime_minutes ? Math.round(g.playtime_minutes / 60) : 0,
      hltb_hours: g.hltb_main_extras ?? g.hltb_main ?? null,
    })),
  };
}

/**
 * Snooze a suggestion — exclude from taste engine candidates for 30 days.
 */
export function snoozeSuggestion(userId, igdbId) {
  const snoozedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(`
    UPDATE user_games SET snoozed_until = :snoozedUntil, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = :userId AND igdb_id = :igdbId
  `).run({ snoozedUntil, userId, igdbId });
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

export function listGuides(userId, igdbId) {
  return getDb().prepare(`
    SELECT id, igdb_id, source_url, title, content_type, content_length,
           fetched_at, scroll_position, last_read_at, parse_warning, created_at
    FROM guides
    WHERE user_id = ? AND igdb_id = ?
    ORDER BY created_at DESC
  `).all(userId, igdbId);
}

export function getGuideContent(userId, guideId) {
  return getDb().prepare(`
    SELECT id, igdb_id, source_url, title, content, content_type,
           scroll_position, parse_warning, fetched_at
    FROM guides
    WHERE id = ? AND user_id = ?
  `).get(guideId, userId);
}

export function createGuide(userId, { igdbId, sourceUrl, title, content, contentType, contentLength, parseWarning }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO guides
      (user_id, igdb_id, source_url, title, content, content_type, content_length, parse_warning, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(userId, igdbId, sourceUrl, title, content, contentType, contentLength, parseWarning ? 1 : 0);
  return db.prepare('SELECT * FROM guides WHERE id = ?').get(result.lastInsertRowid);
}

export function updateGuideScroll(userId, guideId, scrollPosition) {
  getDb().prepare(`
    UPDATE guides
    SET scroll_position = ?, last_read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(scrollPosition, guideId, userId);
}

export function deleteGuide(userId, guideId) {
  getDb().prepare('DELETE FROM guides WHERE id = ? AND user_id = ?').run(guideId, userId);
}

// ---------------------------------------------------------------------------
// Admin — Data Quality
// ---------------------------------------------------------------------------

/**
 * User's owned games that have an IGDB match but no HLTB completion times.
 */
export function getGamesWithoutHltb(userId) {
  return getDb().prepare(`
    SELECT g.id, g.igdb_id, g.title, g.cover_url, g.hltb_fetched_at
    FROM games g
    JOIN user_games ug ON ug.igdb_id = g.igdb_id
    WHERE ug.user_id = ?
      AND g.hltb_id IS NULL
    ORDER BY g.title
  `).all(userId);
}

/**
 * Steam games that never matched an IGDB record.
 * No user_games row exists for these — global table scan.
 */
export function getGamesWithoutIgdb() {
  return getDb().prepare(`
    SELECT id, steam_app_id, title
    FROM games
    WHERE igdb_id IS NULL
      AND steam_app_id IS NOT NULL
      AND igdb_ignored = 0
    ORDER BY title
  `).all();
}

export function setIgdbIgnored(gameId, ignored) {
  getDb().prepare(`
    UPDATE games SET igdb_ignored = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(ignored ? 1 : 0, gameId);
}
