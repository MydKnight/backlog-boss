import { Router } from 'express';
import { lookupBySteamAppId, searchByName } from '../services/igdb.js';

const router = Router();

/**
 * GET /api/igdb/lookup?appid=400
 * Diagnostic: look up a single game by Steam App ID and return the raw result.
 */
router.get('/lookup', async (req, res) => {
  const { appid, title } = req.query;
  if (!appid) return res.status(400).json({ error: 'appid query param required' });

  const result = await lookupBySteamAppId(Number(appid), title ?? null);
  res.json({ appid, title: title ?? null, result });
});

/**
 * GET /api/igdb/raw-lookup?appid=400
 * Deep diagnostic: shows raw IGDB responses at each step so we can see exactly where a lookup fails.
 */
router.get('/raw-lookup', async (req, res) => {
  const { appid } = req.query;
  if (!appid) return res.status(400).json({ error: 'appid query param required' });

  const { igdbRawLookup } = await import('../services/igdb.js');
  const detail = await igdbRawLookup(Number(appid));
  res.json(detail);
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
