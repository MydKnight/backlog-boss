import { Router } from 'express';
import crypto from 'node:crypto';
import {
  getDefaultUser,
  getTasteContext,
  getLatestTasteSnapshot,
  saveTasteSnapshot,
  snoozeSuggestion,
  getEligibleCandidateIds,
} from '../db/queries.js';
import { checkOllamaHealth, runInference, runEmbedding } from '../services/ollama.js';
import {
  buildTasteProfileText,
  embedAllGames,
  rankCandidatesBySimilarity,
} from '../services/embeddings.js';

const router = Router();

// ---------------------------------------------------------------------------
// Background job state (in-memory — single user, single job at a time)
// ---------------------------------------------------------------------------

const embedJob = {
  status: 'idle',       // 'idle' | 'running' | 'done' | 'failed'
  startedAt: null,
  progress: 0,          // games processed so far
  total: 0,             // total games to embed
  error: null,
  abortController: null,
};

const inferenceJob = {
  status: 'idle',       // 'idle' | 'generating' | 'ready' | 'failed'
  startedAt: null,
  tokensGenerated: 0,
  error: null,
  abortController: null,
};

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * GET /api/taste/health
 */
router.get('/health', async (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const [inferenceHealth, embedHealth] = await Promise.all([
    checkOllamaHealth(user.ollama_endpoint, user.ollama_model),
    checkOllamaHealth(user.ollama_endpoint, user.ollama_embed_model),
  ]);

  res.json({
    endpoint: user.ollama_endpoint,
    inferenceModel: { name: user.ollama_model, ...inferenceHealth },
    embedModel: { name: user.ollama_embed_model, ...embedHealth },
  });
});

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * GET /api/taste/snapshot
 */
router.get('/snapshot', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const snapshot = getLatestTasteSnapshot(user.id);
  if (!snapshot) return res.json({ snapshot: null });

  res.json({
    snapshot: {
      generated_at: snapshot.generated_at,
      model_used: snapshot.model_used,
      suggestions: JSON.parse(snapshot.suggestions),
    },
  });
});

// ---------------------------------------------------------------------------
// Embedding job
// ---------------------------------------------------------------------------

/**
 * POST /api/taste/embed-games
 * Kicks off background embedding of all games that don't have a vector yet.
 * This is a one-time setup job plus incremental runs for new games.
 * Poll GET /api/taste/embed-status for progress.
 */
router.post('/embed-games', async (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  if (embedJob.status === 'running') {
    return res.json({
      status: 'running',
      progress: embedJob.progress,
      total: embedJob.total,
      message: 'Embedding job already in progress.',
    });
  }

  const health = await checkOllamaHealth(user.ollama_endpoint, user.ollama_embed_model);
  if (!health.reachable || !health.modelAvailable) {
    return res.status(503).json({
      error: `Embedding model "${user.ollama_embed_model}" not available. Pull it with: ollama pull ${user.ollama_embed_model}`,
    });
  }

  embedJob.status = 'running';
  embedJob.startedAt = new Date().toISOString();
  embedJob.progress = 0;
  embedJob.total = 0;
  embedJob.error = null;
  embedJob.abortController = new AbortController();

  res.json({
    status: 'running',
    message: 'Embedding job started. Poll GET /api/taste/embed-status for progress.',
    embedModel: user.ollama_embed_model,
  });

  // Run detached
  embedAllGames(user.ollama_endpoint, user.ollama_embed_model, {
    onProgress: (done, total) => {
      embedJob.progress = done;
      embedJob.total = total;
      if (done % 50 === 0) {
        console.log(`[embeddings] ${done}/${total} games embedded`);
      }
    },
    signal: embedJob.abortController.signal,
  }).then(({ embedded, errors }) => {
    embedJob.status = 'done';
    console.log(`[embeddings] Job complete — ${embedded} embedded, ${errors} errors`);
  }).catch(err => {
    if (err.name !== 'AbortError') {
      embedJob.status = 'failed';
      embedJob.error = err.message;
      console.error('[embeddings] Job failed:', err.message);
    }
  });
});

/**
 * GET /api/taste/embed-status
 */
router.get('/embed-status', (req, res) => {
  const elapsedSeconds = embedJob.startedAt
    ? Math.floor((Date.now() - new Date(embedJob.startedAt).getTime()) / 1000)
    : null;

  const pct = embedJob.total > 0
    ? Math.round(embedJob.progress / embedJob.total * 100)
    : null;

  res.json({
    status: embedJob.status,
    startedAt: embedJob.startedAt,
    elapsedSeconds,
    progress: embedJob.progress,
    total: embedJob.total,
    percentComplete: pct,
    error: embedJob.error,
  });
});

/**
 * POST /api/taste/cancel-embed
 */
router.post('/cancel-embed', (req, res) => {
  if (embedJob.status !== 'running') {
    return res.json({ ok: false, message: 'No embed job running.' });
  }
  embedJob.abortController?.abort();
  embedJob.status = 'idle';
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Taste inference (embedding similarity + LLM explanations)
// ---------------------------------------------------------------------------

/**
 * GET /api/taste/status
 */
router.get('/status', (req, res) => {
  const elapsedSeconds = inferenceJob.startedAt
    ? Math.floor((Date.now() - new Date(inferenceJob.startedAt).getTime()) / 1000)
    : null;

  res.json({
    status: inferenceJob.status,
    startedAt: inferenceJob.startedAt,
    elapsedSeconds,
    tokensGenerated: inferenceJob.tokensGenerated,
    error: inferenceJob.error,
  });
});

/**
 * POST /api/taste/refresh
 * Kicks off background taste inference using embedding similarity + LLM explanations.
 * Returns immediately. Poll GET /api/taste/status, then GET /api/taste/snapshot.
 */
router.post('/refresh', async (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  if (inferenceJob.status === 'generating') {
    return res.json({
      status: 'generating',
      message: 'Inference already in progress.',
      startedAt: inferenceJob.startedAt,
      tokensGenerated: inferenceJob.tokensGenerated,
    });
  }

  const force = req.query.force === 'true';
  const context = getTasteContext(user.id);

  const hashInput = JSON.stringify({
    completed: context.completedGames.map(g => g.title + g.star_rating),
    retired: context.retiredGames.map(g => g.title),
    candidates: getEligibleCandidateIds(user.id).map(g => g.igdb_id),
  });
  const contextHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

  if (!force) {
    const existing = getLatestTasteSnapshot(user.id);
    if (existing?.context_hash === contextHash) {
      return res.json({
        status: 'ready',
        cached: true,
        snapshot: {
          generated_at: existing.generated_at,
          model_used: existing.model_used,
          suggestions: JSON.parse(existing.suggestions),
        },
      });
    }
  }

  const health = await checkOllamaHealth(user.ollama_endpoint, user.ollama_embed_model);
  if (!health.reachable || !health.modelAvailable) {
    return res.status(503).json({
      error: 'Embedding model not available. Run POST /api/taste/embed-games first.',
    });
  }

  inferenceJob.status = 'generating';
  inferenceJob.startedAt = new Date().toISOString();
  inferenceJob.tokensGenerated = 0;
  inferenceJob.error = null;
  inferenceJob.abortController = new AbortController();

  res.json({
    status: 'generating',
    message: 'Inference started. Poll GET /api/taste/status for progress.',
  });

  runBackgroundInference({ user, context, contextHash });
});

/**
 * POST /api/taste/cancel
 */
router.post('/cancel', (req, res) => {
  if (inferenceJob.status !== 'generating') {
    return res.json({ ok: false, message: 'No inference job running.' });
  }
  inferenceJob.abortController?.abort();
  inferenceJob.status = 'idle';
  inferenceJob.error = 'Cancelled by user.';
  res.json({ ok: true });
});

async function runBackgroundInference({ user, context, contextHash }) {
  try {
    // Step 1: Embed the taste profile
    const profileText = buildTasteProfileText(context.completedGames, context.retiredGames);
    console.log('[taste] Embedding taste profile...');
    const tasteVector = await runEmbedding(
      user.ollama_endpoint, user.ollama_embed_model, profileText
    );

    if (!tasteVector) {
      inferenceJob.status = 'failed';
      inferenceJob.error = 'Failed to embed taste profile.';
      return;
    }

    // Step 2: Rank all eligible candidates by cosine similarity
    console.log('[taste] Ranking candidates by similarity...');
    const eligible = getEligibleCandidateIds(user.id);
    const backburnerIds = new Set(eligible.filter(e => e.status === 'backburner').map(e => e.igdb_id));
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentlyAddedIds = new Set(eligible.filter(e => e.added_at > thirtyDaysAgo).map(e => e.igdb_id));

    const ranked = rankCandidatesBySimilarity(tasteVector, user.id, { backburnerIds, recentlyAddedIds });
    const top15 = ranked.slice(0, 15);

    console.log(`[taste] Top 15 ranked. Getting explanations from ${user.ollama_model}...`);

    // Step 3: Ask LLM for an explanation for each top game individually
    const suggestions = [];
    const profileSummary = buildProfileSummary(context.completedGames, context.retiredGames);

    for (let i = 0; i < top15.length; i++) {
      if (inferenceJob.abortController.signal.aborted) break;

      const game = top15[i];
      const explanation = await getGameExplanation(
        user.ollama_endpoint, user.ollama_model, game, profileSummary,
        { onToken: () => { inferenceJob.tokensGenerated++; },
          signal: inferenceJob.abortController.signal }
      );

      suggestions.push({
        igdb_id: game.igdb_id,
        title: game.title,
        rank: i + 1,
        explanation: explanation ?? '',
        similarity: Math.round(game.similarity * 1000) / 1000,
      });

      console.log(`[taste] ${i + 1}/15 explained: ${game.title}`);
    }

    if (suggestions.length === 0) {
      inferenceJob.status = 'failed';
      inferenceJob.error = 'No suggestions generated — check that embed-games has run.';
      return;
    }

    saveTasteSnapshot(user.id, {
      modelUsed: `${user.ollama_embed_model}+${user.ollama_model}`,
      contextHash,
      suggestions,
    });

    inferenceJob.status = 'ready';
    console.log(`[taste] Snapshot saved — ${suggestions.length} suggestions`);

  } catch (err) {
    if (err.name !== 'AbortError') {
      inferenceJob.status = 'failed';
      inferenceJob.error = err.message;
      console.error('[taste] Inference error:', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-game explanation
// ---------------------------------------------------------------------------

/**
 * Build a one-line taste profile summary for the explanation prompt.
 * Kept short — this goes into every individual explanation call.
 */
function buildProfileSummary(completedGames, retiredGames) {
  const loved = completedGames
    .filter(g => g.star_rating >= 4)
    .map(g => {
      const tags = [...(g.positive_tags ?? [])].join(', ');
      const note = g.free_text ? ` ("${g.free_text.slice(0, 60)}")` : '';
      return `${g.title} (${g.star_rating}★${tags ? ', ' + tags : ''}${note})`;
    })
    .join('; ');

  const disliked = retiredGames.map(g => {
    const tags = (g.negative_tags ?? []).join(', ');
    return `${g.title}${tags ? ' (' + tags + ')' : ''}`;
  }).join(', ');

  return `Loved: ${loved || 'none yet'}. Abandoned: ${disliked || 'none'}.`;
}

/**
 * Ask the LLM to explain why one specific game fits this user.
 * Small focused prompt — fast, accurate, no hallucination pressure.
 */
async function getGameExplanation(endpoint, model, game, profileSummary, { onToken, signal } = {}) {
  const genres = (game.genres ?? []).join(', ');
  const hltb = game.hltb_hours ? `~${game.hltb_hours}h to complete` : 'unknown length';

  const prompt = `Player taste: ${profileSummary}

Complete this recommendation sentence for "${game.title}" (${genres}, ${hltb}):
"You'd enjoy this because ___"

Rules:
- Fill in the blank with one specific reason grounded in what this game actually is
- Draw on your knowledge of the game's tone, mechanics, or story — not just its genre label
- Do NOT start with "You'd enjoy this because" — just write the reason itself
- Do NOT use the phrase "similar to" or "combines X and Y"
- If you have no specific reason, respond with exactly: SKIP

One sentence. No preamble.`;

  // json: false — we want a plain sentence, not JSON-constrained output
  const raw = await runInference(endpoint, model, prompt, { onToken, signal, json: false });
  if (!raw) return null;

  let cleaned = raw.trim().replace(/^["']|["']$/g, '').trim();

  // Strip trailing SKIP if model wrote an explanation AND then second-guessed itself
  cleaned = cleaned.replace(/\s*SKIP\s*$/i, '').trim();

  // Detect model signalling no connection or leaking a note
  if (!cleaned || cleaned.toUpperCase() === 'SKIP' || cleaned.length < 8) return null;
  if (cleaned.startsWith('(') || cleaned.toLowerCase().includes("isn't a direct")) return null;

  // Ensure first character is capitalised
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// ---------------------------------------------------------------------------
// Snooze + diagnostics
// ---------------------------------------------------------------------------

/**
 * POST /api/taste/snooze/:igdbId
 */
router.post('/snooze/:igdbId', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const igdbId = parseInt(req.params.igdbId);
  try {
    snoozeSuggestion(user.id, igdbId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/taste/test-prompt
 * Quick 3-game test using the new per-game explanation approach.
 */
router.post('/test-prompt', async (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const context = getTasteContext(user.id);
  const profileSummary = buildProfileSummary(context.completedGames, context.retiredGames);

  // Use top 3 candidates from context for quick test
  const testGames = context.candidateGames.slice(0, 3);
  const results = [];

  for (const game of testGames) {
    const explanation = await getGameExplanation(
      user.ollama_endpoint, user.ollama_model, game, profileSummary
    );
    results.push({ igdb_id: game.igdb_id, title: game.title, explanation });
  }

  res.json({ profileSummary, results });
});

/**
 * GET /api/taste/context-preview
 */
router.get('/context-preview', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const context = getTasteContext(user.id);
  const eligible = getEligibleCandidateIds(user.id);

  res.json({
    completedCount: context.completedGames.length,
    retiredCount: context.retiredGames.length,
    inProgressCount: context.inProgressGames.length,
    eligibleCandidateCount: eligible.length,
  });
});

export default router;
