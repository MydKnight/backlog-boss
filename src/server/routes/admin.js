import { Router } from 'express';
import {
  getGamesWithoutHltb,
  getGamesWithoutIgdb,
  updateGameFromHltb,
  updateGameFromIgdb,
  linkPendingSteamGamesToIgdb,
  setIgdbIgnored,
} from '../db/queries.js';
import { searchRaw } from '../services/hltb.js';
import { searchByName } from '../services/igdb.js';

const router = Router();

// ---------------------------------------------------------------------------
// Unmatched game lists
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/unmatched
 * Returns two lists: games missing HLTB data and games missing IGDB match.
 */
router.get('/unmatched', (req, res) => {
  const user = req.user;

  const noHltb = getGamesWithoutHltb(user.id).map(g => ({
    id: g.id,
    igdb_id: g.igdb_id,
    title: g.title,
    cover_url: g.cover_url ?? null,
    hltb_tried: !!g.hltb_fetched_at,
  }));

  const noIgdb = getGamesWithoutIgdb().map(g => ({
    id: g.id,
    steam_app_id: g.steam_app_id,
    title: g.title,
  }));

  res.json({ noHltb, noIgdb });
});

// ---------------------------------------------------------------------------
// HLTB fix
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/hltb-search?title=...
 * Search HLTB by a corrected title and return results for the user to pick from.
 */
router.get('/hltb-search', async (req, res) => {
  const { title } = req.query;
  if (!title) return res.status(400).json({ error: 'title query param required.' });

  try {
    const raw = await searchRaw(title);
    const results = (raw?.data ?? []).slice(0, 10).map(r => ({
      hltb_id: r.game_id,
      title: r.game_name,
      main: r.comp_main ? Math.round((r.comp_main / 3600) * 10) / 10 : null,
      main_extras: r.comp_plus ? Math.round((r.comp_plus / 3600) * 10) / 10 : null,
      completionist: r.comp_100 ? Math.round((r.comp_100 / 3600) * 10) / 10 : null,
      image_url: r.game_image
        ? `https://howlongtobeat.com/games/${r.game_image}`
        : null,
    }));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/hltb-pin
 * Pin a chosen HLTB result to a game, bypassing the title fuzzy-match.
 * Body: { gameId, hltbId, main, mainExtras, completionist }
 */
router.post('/hltb-pin', (req, res) => {
  const { gameId, hltbId, main, mainExtras, completionist } = req.body;
  if (!gameId || !hltbId) {
    return res.status(400).json({ error: 'gameId and hltbId are required.' });
  }

  try {
    updateGameFromHltb(gameId, {
      hltb_id: hltbId,
      main: main ?? null,
      mainExtras: mainExtras ?? null,
      completionist: completionist ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// IGDB fix
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/igdb-search?q=...
 * Search IGDB by name and return candidates for the user to pick from.
 */
router.get('/igdb-search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q query param required.' });

  try {
    const results = await searchByName(q);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/igdb-relink
 * Manually link a Steam game to a chosen IGDB record.
 * Body: { steamAppId, igdbData: { igdbId, title, coverUrl, genres, themes, similarIgdbIds } }
 */
router.post('/igdb-relink', (req, res) => {
  const user = req.user;

  const { steamAppId, igdbData } = req.body;
  if (!steamAppId || !igdbData?.igdbId) {
    return res.status(400).json({ error: 'steamAppId and igdbData.igdbId are required.' });
  }

  try {
    const result = updateGameFromIgdb(steamAppId, igdbData);
    if (result?.ok === false) {
      return res.status(409).json({
        error: `That IGDB entry is already linked to another Steam game ("${result.conflict.title}", Steam ID ${result.conflict.steam_app_id}). Pick a different IGDB result.`,
      });
    }
    const linked = linkPendingSteamGamesToIgdb(user.id);
    res.json({ ok: true, linked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/igdb-ignore
 * Mark an unresolvable game as ignored so it no longer appears in the triage list.
 * Body: { gameId }
 */
router.post('/igdb-ignore', (req, res) => {
  const { gameId } = req.body;
  if (!gameId) return res.status(400).json({ error: 'gameId is required.' });
  try {
    setIgdbIgnored(gameId, true);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
