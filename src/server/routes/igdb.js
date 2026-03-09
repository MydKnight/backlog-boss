import { Router } from 'express';
import { lookupBySteamAppId, searchByName } from '../services/igdb.js';

const router = Router();

/**
 * GET /api/igdb/lookup?appid=400
 * Diagnostic: look up a single game by Steam App ID and return the raw result.
 */
router.get('/lookup', async (req, res) => {
  const { appid } = req.query;
  if (!appid) return res.status(400).json({ error: 'appid query param required' });

  const result = await lookupBySteamAppId(Number(appid));
  res.json({ appid, result });
});

/**
 * GET /api/igdb/search?q=Portal
 * Diagnostic: search IGDB by name.
 */
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q query param required' });

  const results = await searchByName(q);
  res.json({ query: q, results });
});

export default router;
