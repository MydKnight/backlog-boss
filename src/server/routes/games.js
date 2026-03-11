import { Router } from 'express';
import {
  getDefaultUser,
  getInProgressGames,
  getOngoingGames,
  getUnplayedGames,
  getCompletedGames,
  markGameBeaten,
  markGameRetired,
  revertGameToInProgress,
  upsertGameFromIgdb,
  logHistoryGame,
  getHistoryGames,
  addCurrentlyPlaying,
  setBackburner,
  setOngoing,
  restoreToNow,
  getOngoingCandidates,
} from '../db/queries.js';

const router = Router();

function parseGame(game) {
  const bench = game.hltb_main_extras ?? game.hltb_main ?? null;
  const pct = game.completion_pct_override != null
    ? game.completion_pct_override
    : bench
      ? Math.min(99, Math.round(game.playtime_minutes / (bench * 60) * 100))
      : null;

  return {
    id: game.id,
    igdb_id: game.igdb_id,
    title: game.title,
    cover_url: game.cover_url ?? null,
    genres: game.genres ? JSON.parse(game.genres) : [],
    hltb_main: game.hltb_main ?? null,
    hltb_main_extras: game.hltb_main_extras ?? null,
    playtime_minutes: game.playtime_minutes ?? 0,
    last_played_at: game.last_played_at ?? null,
    completion_pct: pct,
  };
}

/**
 * GET /api/games/now
 * In-progress games sorted by proximity to completion, plus ongoing (Always On) games.
 */
router.get('/now', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const games = getInProgressGames(user.id).map(parseGame);
  const ongoing = getOngoingGames(user.id).map(g => ({
    id: g.id,
    igdb_id: g.igdb_id,
    title: g.title,
    cover_url: g.cover_url ?? null,
    genres: g.genres ? JSON.parse(g.genres) : [],
    playtime_minutes: g.playtime_minutes ?? 0,
    last_played_at: g.last_played_at ?? null,
  }));
  res.json({ games, ongoing });
});

/**
 * GET /api/games/next
 * Unplayed + backburner games sorted alphabetically (taste ranking added in Phase 4).
 */
router.get('/next', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const games = getUnplayedGames(user.id).map(g => ({
    ...parseGame(g),
    status: g.status,
  }));
  res.json({ games, total: games.length });
});

/**
 * GET /api/games/done
 * Completed games sorted by most recently beaten.
 */
router.get('/done', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const games = getCompletedGames(user.id).map(g => ({
    id: g.id,
    igdb_id: g.igdb_id,
    title: g.title,
    cover_url: g.cover_url ?? null,
    star_rating: g.star_rating ?? null,
    event_date: g.event_date ?? null,
    positive_tags: g.positive_tags ? JSON.parse(g.positive_tags) : [],
    free_text: g.free_text ?? null,
  }));

  res.json({ games });
});

/**
 * POST /api/games/:igdbId/beaten
 * Body: { starRating, positiveTags, negativeTags, freeText }
 */
router.post('/:igdbId/beaten', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const igdbId = parseInt(req.params.igdbId);
  const { starRating, positiveTags, negativeTags, freeText } = req.body;

  try {
    markGameBeaten(user.id, igdbId, { starRating, positiveTags, negativeTags, freeText });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/games/:igdbId/retired
 * Body: { starRating, positiveTags, negativeTags, freeText }
 */
router.post('/:igdbId/retired', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const igdbId = parseInt(req.params.igdbId);
  const { starRating, positiveTags, negativeTags, freeText } = req.body;

  try {
    markGameRetired(user.id, igdbId, { starRating, positiveTags, negativeTags, freeText });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/games/history
 * All history-interview entries, sorted by most recently logged.
 */
router.get('/history', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const games = getHistoryGames(user.id).map(g => ({
    igdb_id: g.igdb_id,
    title: g.title,
    cover_url: g.cover_url ?? null,
    event_type: g.event_type ?? null,
    star_rating: g.star_rating ?? null,
    event_date: g.event_date ?? null,
    positive_tags: g.positive_tags ? JSON.parse(g.positive_tags) : [],
    negative_tags: g.negative_tags ? JSON.parse(g.negative_tags) : [],
    free_text: g.free_text ?? null,
  }));

  res.json({ games });
});

/**
 * POST /api/games/history
 * Log a previously played game. Body: { igdbData, starRating, positiveTags, freeText }
 */
router.post('/history', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const { igdbData, starRating, positiveTags, freeText } = req.body;
  if (!igdbData?.igdbId) return res.status(400).json({ error: 'igdbData.igdbId required' });

  try {
    upsertGameFromIgdb(igdbData);
    logHistoryGame(user.id, igdbData.igdbId, { starRating, positiveTags, freeText });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/games/currently-playing
 * Add a non-Steam game to Now. Body: { igdbData, ownershipType, playtimeMinutes }
 */
router.post('/currently-playing', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const { igdbData, ownershipType, playtimeMinutes } = req.body;
  if (!igdbData?.igdbId) return res.status(400).json({ error: 'igdbData.igdbId required' });

  const validTypes = ['owned_ps5', 'owned_switch', 'owned_other'];
  if (!validTypes.includes(ownershipType)) {
    return res.status(400).json({ error: `ownershipType must be one of: ${validTypes.join(', ')}` });
  }

  try {
    upsertGameFromIgdb(igdbData);
    addCurrentlyPlaying(user.id, igdbData.igdbId, { ownershipType, playtimeMinutes });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/games/:igdbId/revert
 * Moves a completed or retired game back to in_progress.
 * Preserves game_events and game_interviews history.
 */
router.post('/:igdbId/revert', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const igdbId = parseInt(req.params.igdbId);
  try {
    revertGameToInProgress(user.id, igdbId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/games/:igdbId/set-backburner
 * Push a Now game to backburner — persists across Steam syncs.
 */
router.post('/:igdbId/set-backburner', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const igdbId = parseInt(req.params.igdbId);
  try {
    setBackburner(user.id, igdbId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/games/:igdbId/set-ongoing
 * Mark a game as ongoing (live service / no completion state).
 */
router.post('/:igdbId/set-ongoing', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const igdbId = parseInt(req.params.igdbId);
  try {
    setOngoing(user.id, igdbId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/games/:igdbId/restore-to-now
 * Move a backburner game back to in_progress (Now view).
 */
router.post('/:igdbId/restore-to-now', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const igdbId = parseInt(req.params.igdbId);
  try {
    restoreToNow(user.id, igdbId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/games/ongoing-candidates
 * Games with no HLTB data and > 10h playtime — likely live service / sandbox candidates.
 */
router.get('/ongoing-candidates', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const games = getOngoingCandidates(user.id).map(g => ({
    igdb_id: g.igdb_id,
    title: g.title,
    cover_url: g.cover_url ?? null,
    playtime_minutes: g.playtime_minutes,
  }));
  res.json({ games });
});

export default router;
