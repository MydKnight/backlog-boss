import { Router } from 'express';
import { getDefaultUser } from '../db/queries.js';
import {
  listGuides,
  getGuideContent,
  createGuide,
  updateGuideScroll,
  deleteGuide,
} from '../db/queries.js';
import { fetchAndParseGuide } from '../services/readability.js';

const router = Router();

/**
 * GET /api/guides/:igdbId
 * List all guides for a game (metadata only — no content payload).
 */
router.get('/:igdbId', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const igdbId = parseInt(req.params.igdbId);
  if (isNaN(igdbId)) return res.status(400).json({ error: 'Invalid igdbId.' });

  const guides = listGuides(user.id, igdbId);
  res.json({ guides });
});

/**
 * GET /api/guides/content/:guideId
 * Full guide content — cached by service worker for offline access.
 */
router.get('/content/:guideId', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const guideId = parseInt(req.params.guideId);
  if (isNaN(guideId)) return res.status(400).json({ error: 'Invalid guideId.' });

  const guide = getGuideContent(user.id, guideId);
  if (!guide) return res.status(404).json({ error: 'Guide not found.' });

  res.json({
    id: guide.id,
    igdb_id: guide.igdb_id,
    title: guide.title,
    source_url: guide.source_url,
    content: guide.content,
    content_type: guide.content_type,
    scroll_position: guide.scroll_position,
    parse_warning: !!guide.parse_warning,
    fetched_at: guide.fetched_at,
  });
});

/**
 * POST /api/guides
 * Ingest a new guide URL for a game.
 * Body: { igdbId: number, url: string }
 */
router.post('/', async (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const { igdbId, url } = req.body;
  if (!igdbId || !url) return res.status(400).json({ error: 'igdbId and url are required.' });

  try {
    const parsed = await fetchAndParseGuide(url);
    const guide = createGuide(user.id, {
      igdbId,
      sourceUrl: url,
      title: parsed.title,
      content: parsed.content,
      contentType: parsed.contentType,
      contentLength: parsed.contentLength,
      parseWarning: parsed.parseWarning,
    });

    // Return metadata only (not the full content) to keep the response small
    res.json({
      guide: {
        id: guide.id,
        igdb_id: guide.igdb_id,
        source_url: guide.source_url,
        title: guide.title,
        content_type: guide.content_type,
        content_length: guide.content_length,
        parse_warning: !!guide.parse_warning,
        fetched_at: guide.fetched_at,
        scroll_position: 0,
      },
    });
  } catch (err) {
    console.error('[guides] Ingest error:', err.message);
    res.status(422).json({ error: err.message });
  }
});

/**
 * PATCH /api/guides/:guideId/scroll
 * Save scroll position. Called on scroll (debounced by client).
 * Body: { scrollPosition: number }
 */
router.patch('/:guideId/scroll', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const guideId = parseInt(req.params.guideId);
  const { scrollPosition } = req.body;

  if (isNaN(guideId) || typeof scrollPosition !== 'number') {
    return res.status(400).json({ error: 'Invalid guideId or scrollPosition.' });
  }

  updateGuideScroll(user.id, guideId, scrollPosition);
  res.json({ ok: true });
});

/**
 * DELETE /api/guides/:guideId
 */
router.delete('/:guideId', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const guideId = parseInt(req.params.guideId);
  if (isNaN(guideId)) return res.status(400).json({ error: 'Invalid guideId.' });

  deleteGuide(user.id, guideId);
  res.json({ ok: true });
});

export default router;
