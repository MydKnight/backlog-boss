import { Router } from 'express';
import { searchRaw, fetchByTitle, debugKeyExtraction } from '../services/hltb.js';
import { resetHltbFetchedAt } from '../db/queries.js';
import { getDb } from '../db/schema.js';

const router = Router();

/**
 * GET /api/hltb/test?title=Portal
 * Returns the raw HLTB API response so we can verify the data shape and
 * confirm times are being converted correctly before running a full sync.
 */
router.get('/test', async (req, res) => {
  const { title } = req.query;
  if (!title) return res.status(400).json({ error: 'title query param required' });

  try {
    const raw = await searchRaw(title);
    const mapped = await fetchByTitle(title);
    // Return both so we can verify the mapping is correct
    res.json({
      title,
      mapped,
      raw_first_result: raw?.data?.[0] ?? null,
      total_results: raw?.data?.length ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/hltb/debug-key
 * Shows exactly what script URLs HLTB's homepage returns and what api-related
 * strings appear in each chunk — so we can identify the correct key pattern.
 */
router.get('/debug-key', async (req, res) => {
  const result = await debugKeyExtraction();
  res.json(result);
});

/**
 * POST /api/hltb/reset
 * Clears hltb_fetched_at for all games that have no HLTB data (i.e. were
 * marked as fetched but got no results, typically due to throttling).
 * After calling this, the next sync will retry those games.
 */
router.post('/reset', (req, res) => {
  const db = getDb();

  const stats = {
    total_games: db.prepare('SELECT COUNT(*) as n FROM games').get().n,
    hltb_fetched_at_not_null: db.prepare('SELECT COUNT(*) as n FROM games WHERE hltb_fetched_at IS NOT NULL').get().n,
    hltb_main_extras_not_null: db.prepare('SELECT COUNT(*) as n FROM games WHERE hltb_main_extras IS NOT NULL').get().n,
    would_reset: db.prepare('SELECT COUNT(*) as n FROM games WHERE hltb_fetched_at IS NOT NULL AND hltb_main_extras IS NULL').get().n,
  };

  const count = resetHltbFetchedAt();
  res.json({ reset: count, stats, message: `${count} games cleared — run /api/sync to retry` });
});

export default router;
