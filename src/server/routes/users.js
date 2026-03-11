import { Router } from 'express';
import { updateUserSettings } from '../db/queries.js';
import { syncSteamLibrary } from '../services/steam.js';
import { enrichGamesFromIgdb } from '../services/igdb.js';
import { lookupHltbForAllGames } from '../services/hltb.js';

const router = Router();

/**
 * GET /api/me
 * Returns the current user profile + steamConfigured flag.
 */
router.get('/', (req, res) => {
  const user = req.user;
  res.json({
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    steamConfigured: !!(user.steam_api_key && user.steam_id),
    ollamaEndpoint: user.ollama_endpoint ?? null,
    ollamaModel: user.ollama_model ?? null,
  });
});

/**
 * PATCH /api/me
 * Update display name and/or Steam credentials.
 * Body: { username?, steamApiKey?, steamId? }
 */
router.patch('/', async (req, res) => {
  const user = req.user;
  const { username, steamApiKey, steamId } = req.body;

  try {
    updateUserSettings(user.id, { username, steamApiKey, steamId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
