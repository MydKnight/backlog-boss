import { Router } from 'express';
import { getGameByIgdbId } from '../db/queries.js';
import {
  listGuides,
  getGuideContent,
  createGuide,
  updateGuideScroll,
  deleteGuide,
} from '../db/queries.js';
import { fetchAndParseGuide, convertDivTables } from '../services/readability.js';
import { searchAllSites } from '../services/guideSources.js';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const router = Router();

// ---------------------------------------------------------------------------
// IMPORTANT: specific paths must come before /:igdbId to avoid swallowing them
// ---------------------------------------------------------------------------

/**
 * GET /api/guides/search?igdbId=
 * Search Steam Community guides for the game's Steam App ID.
 * Uses igdbId to look up the steam_app_id from the games table.
 */
router.get('/search', async (req, res) => {
  const igdbId = parseInt(req.query.igdbId);
  if (isNaN(igdbId)) return res.status(400).json({ error: 'igdbId query param required.' });

  const game = getGameByIgdbId(igdbId);
  const steamAppId = game?.steam_app_id ?? null;

  if (!steamAppId) {
    return res.json({ results: [], reason: 'no_steam_id' });
  }

  try {
    const results = await searchAllSites(steamAppId);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guides/content/:guideId
 * Full guide content — cached by service worker for offline access.
 */
router.get('/content/:guideId', (req, res) => {
  const user = req.user;

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
 * GET /api/guides/:igdbId
 * List all guides for a game (metadata only — no content payload).
 */
router.get('/:igdbId', (req, res) => {
  const user = req.user;

  const igdbId = parseInt(req.params.igdbId);
  if (isNaN(igdbId)) return res.status(400).json({ error: 'Invalid igdbId.' });

  const guides = listGuides(user.id, igdbId);
  res.json({ guides });
});

// ---------------------------------------------------------------------------
// Write endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/guides
 * Ingest a guide for a game. Two modes:
 *
 * Mode 1 — fetch from URL (existing):
 *   Body: { igdbId: number, url: string }
 *
 * Mode 2 — paste raw content (new):
 *   Body: { igdbId: number, pastedContent: string, title: string, sourceUrl?: string }
 *   pastedContent: full HTML page source or plain text
 *   sourceUrl: optional — stored as source_url and used as Readability base URL
 *              for correct relative image resolution
 */
router.post('/', async (req, res) => {
  const user = req.user;

  const { igdbId, url, pastedContent, title: pastedTitle, sourceUrl } = req.body;

  if (!igdbId) return res.status(400).json({ error: 'igdbId is required.' });

  try {
    let parsed;

    if (pastedContent != null) {
      // --- Paste content mode ---
      if (!pastedTitle?.trim()) {
        return res.status(400).json({ error: 'title is required when pasting content.' });
      }
      parsed = parsepastedContent(pastedContent, pastedTitle.trim(), sourceUrl ?? null);
    } else if (url) {
      // --- Fetch from URL mode ---
      parsed = await fetchAndParseGuide(url);
    } else {
      return res.status(400).json({ error: 'url or pastedContent is required.' });
    }

    const guide = createGuide(user.id, {
      igdbId,
      sourceUrl: url ?? sourceUrl ?? null,
      title: parsed.title,
      content: parsed.content,
      contentType: parsed.contentType,
      contentLength: parsed.contentLength,
      parseWarning: parsed.parseWarning,
    });

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
  const user = req.user;

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
  const user = req.user;

  const guideId = parseInt(req.params.guideId);
  if (isNaN(guideId)) return res.status(400).json({ error: 'Invalid guideId.' });

  deleteGuide(user.id, guideId);
  res.json({ ok: true });
});

export default router;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HTML_PATTERN = /<(html|head|body|div|p|h[1-6]|ul|ol|article|section|main|table|span)\b/i;
const MAX_CONTENT_BYTES = 10 * 1024 * 1024;

/**
 * Process pasted content — auto-detect HTML vs plain text.
 * HTML is run through Readability; plain text stored as-is.
 */
function parsepastedContent(content, title, sourceUrl) {
  if (content.length > MAX_CONTENT_BYTES) {
    throw new Error('Pasted content is too large (> 10 MB).');
  }

  const trimmed = content.trimStart();

  if (!HTML_PATTERN.test(trimmed.slice(0, 2000))) {
    // Plain text
    return {
      title,
      content,
      contentType: 'text',
      contentLength: content.length,
      parseWarning: false,
    };
  }

  // HTML — run through Readability
  // Use sourceUrl as the base URL so relative image src attributes resolve correctly
  const baseUrl = sourceUrl || 'https://example.com';
  const dom = new JSDOM(content, { url: baseUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.content || article.content.length < 200) {
    // Readability couldn't extract enough — store stripped HTML with a warning
    const stripped = content
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    return {
      title: article?.title || title,
      content: stripped,
      contentType: 'html',
      contentLength: stripped.length,
      parseWarning: true,
    };
  }

  const processed = convertDivTables(article.content);
  return {
    title: article.title || title,
    content: processed,
    contentType: 'html',
    contentLength: processed.length,
    parseWarning: false,
  };
}
