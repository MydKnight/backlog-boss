import { Router } from 'express';
import { searchRaw, fetchByTitle, debugKeyExtraction } from '../services/hltb.js';

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

export default router;
