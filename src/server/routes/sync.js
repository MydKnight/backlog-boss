import { Router } from 'express';
import { getDefaultUser, getRecentSyncLogs, demoteStaleInProgressGames } from '../db/queries.js';
import { syncSteamLibrary } from '../services/steam.js';
import { enrichGamesFromIgdb } from '../services/igdb.js';
import { lookupHltbForAllGames } from '../services/hltb.js';

const router = Router();

/**
 * POST /api/sync
 * Runs all three sync phases in order: Steam → IGDB → HLTB.
 * Each phase is independent — failures are logged but don't abort subsequent phases.
 */
router.post('/', async (req, res) => {
  const user = getDefaultUser();
  if (!user) {
    return res.status(500).json({ error: 'No user configured. Check server setup.' });
  }

  if (!user.steam_api_key || !user.steam_id) {
    return res.status(400).json({
      error: 'Steam credentials not configured.',
      hint: 'Set STEAM_API_KEY and STEAM_ID in your .env file.',
    });
  }

  const results = {
    steam: null,
    igdb: null,
    hltb: null,
    demotion: null,
    errors: [],
  };

  // Phase 1: Steam library sync
  try {
    console.log('Sync: starting Steam library pull...');
    results.steam = await syncSteamLibrary(user);
    console.log(`Sync: Steam done — ${results.steam.gamesUpdated} games updated`);
  } catch (err) {
    console.error('Sync: Steam sync failed:', err.message);
    results.errors.push(`steam: ${err.message}`);
  }

  // Phase 1b: Demote stale in_progress games to backburner
  // Runs after Steam sync so playtime + last_played_at are fresh.
  try {
    const demotion = demoteStaleInProgressGames(user.id);
    results.demotion = demotion;
    if (demotion.demoted > 0) {
      console.log(`Sync: demoted ${demotion.demoted} stale in_progress games to backburner`);
      if (demotion.demoted <= 20) {
        console.log('  Demoted:', demotion.titles.join(', '));
      }
    }
  } catch (err) {
    console.error('Sync: stale game demotion failed:', err.message);
    results.errors.push(`demotion: ${err.message}`);
  }

  // Phase 2: IGDB enrichment
  try {
    console.log('Sync: starting IGDB enrichment...');
    results.igdb = await enrichGamesFromIgdb(user);
    console.log(`Sync: IGDB done — ${results.igdb.gamesUpdated} games enriched`);
  } catch (err) {
    console.error('Sync: IGDB enrichment failed:', err.message);
    results.errors.push(`igdb: ${err.message}`);
  }

  // Phase 3: HLTB lookup
  try {
    console.log('Sync: starting HLTB lookup...');
    results.hltb = await lookupHltbForAllGames(user);
    console.log(`Sync: HLTB done — ${results.hltb.gamesUpdated} games updated`);
  } catch (err) {
    console.error('Sync: HLTB lookup failed:', err.message);
    results.errors.push(`hltb: ${err.message}`);
  }

  const overallStatus = results.errors.length === 0 ? 'success' : 'partial';
  res.json({ status: overallStatus, results });
});

/**
 * GET /api/sync/status
 * Returns the 10 most recent sync log entries for the default user.
 */
router.get('/status', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const logs = getRecentSyncLogs(user.id, 10);
  res.json({ logs });
});

export default router;
