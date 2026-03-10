import { Router } from 'express';
import { getDefaultUser } from '../db/queries.js';
import { getInProgressGames, getUnplayedGames } from '../db/queries.js';

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
 * In-progress games sorted by proximity to completion.
 */
router.get('/now', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const games = getInProgressGames(user.id).map(parseGame);
  res.json({ games });
});

/**
 * GET /api/games/next
 * Unplayed games sorted alphabetically (taste ranking added in Phase 3).
 */
router.get('/next', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const games = getUnplayedGames(user.id).map(parseGame);
  res.json({ games, total: games.length });
});

export default router;
