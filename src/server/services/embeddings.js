/**
 * Embedding-based ranking service.
 *
 * Replaces the old LLM batch-ranking approach with:
 *   1. Semantic embeddings for every game (via nomic-embed-text)
 *   2. Cosine similarity between a user taste profile and all game embeddings
 *   3. LLM used only for individual explanations on the top results
 *
 * This scales to the full library (1300+ games) because ranking is pure math —
 * no context window limits, no generation time, instant results once embeddings exist.
 */

import { runEmbedding } from './ollama.js';
import {
  getGamesNeedingEmbedding,
  updateGameEmbedding,
  getAllGameEmbeddings,
  getEligibleCandidateIds,
} from '../db/queries.js';

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two vectors. Returns value between -1 and 1.
 * Higher = more similar.
 */
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Taste profile text builder
// ---------------------------------------------------------------------------

/**
 * Build a rich text representation of the user's taste profile for embedding.
 *
 * The embedding model encodes the semantic meaning of this text into a vector.
 * Candidates whose game-description vectors are closest to this vector rank highest.
 *
 * @param {object[]} completedGames  — from getTasteContext
 * @param {object[]} retiredGames    — from getTasteContext
 * @returns {string}
 */
export function buildTasteProfileText(completedGames, retiredGames) {
  function formatGame(g, { didNotFinish = false } = {}) {
    const tags = [...(g.positive_tags ?? []), ...(g.negative_tags ?? [])].join(', ');
    const note = g.free_text ? ` "${g.free_text.slice(0, 100)}"` : '';
    const genres = (g.genres ?? []).join(', ');
    const dnf = didNotFinish ? ', did not finish' : '';
    return `${g.title} (${g.star_rating}★, ${genres}${tags ? ', ' + tags : ''}${dnf}${note})`;
  }

  // Combine completed and rated retired games into the same tiers
  const allRated = [
    ...completedGames,
    ...retiredGames.filter(g => g.star_rating !== null),
  ];

  const loved = allRated
    .filter(g => g.star_rating >= 4)
    .map(g => formatGame(g, { didNotFinish: !completedGames.includes(g) }));

  const liked = allRated
    .filter(g => g.star_rating === 3)
    .map(g => formatGame(g, { didNotFinish: !completedGames.includes(g) }));

  // Low-rated or unrated retired games — still useful as avoidance signals if they have tags
  const disliked = [
    ...allRated.filter(g => g.star_rating <= 2).map(g => {
      const tags = (g.negative_tags ?? []).join(', ');
      const note = g.free_text ? ` "${g.free_text.slice(0, 80)}"` : '';
      return `${g.title} (${(g.genres ?? []).join(', ')}${tags ? ', ' + tags : ''}${note})`;
    }),
    ...retiredGames.filter(g => g.star_rating === null && (g.negative_tags ?? []).length > 0).map(g => {
      const tags = (g.negative_tags ?? []).join(', ');
      const note = g.free_text ? ` "${g.free_text.slice(0, 80)}"` : '';
      return `${g.title} (${(g.genres ?? []).join(', ')}${tags ? ', ' + tags : ''}${note})`;
    }),
  ];

  const lines = ['Games this user loves:'];
  if (loved.length) loved.forEach(g => lines.push(`- ${g}`));
  else lines.push('- (none yet)');

  if (liked.length) {
    lines.push('\nGames this user liked:');
    liked.forEach(g => lines.push(`- ${g}`));
  }

  if (disliked.length) {
    lines.push('\nGames this user abandoned or disliked:');
    disliked.forEach(g => lines.push(`- ${g}`));
  }

  return lines.join('\n');
}

/**
 * Build an embeddable text description of a game.
 * Title + genres + themes — enough for the embedding model to understand
 * what the game actually is, drawing on its training knowledge.
 */
export function buildGameText(game) {
  const genres = game.genres ? JSON.parse(game.genres) : [];
  const themes = game.themes ? JSON.parse(game.themes) : [];
  const parts = [game.title];
  if (genres.length) parts.push(`Genres: ${genres.join(', ')}`);
  if (themes.length) parts.push(`Themes: ${themes.join(', ')}`);
  return parts.join('. ');
}

// ---------------------------------------------------------------------------
// Batch embedding job
// ---------------------------------------------------------------------------

/**
 * Generate and store embeddings for all games that don't have one yet.
 * Runs as a background job — calls onProgress with { done, total } as it goes.
 *
 * @param {string} endpoint
 * @param {string} embedModel
 * @param {{ onProgress?: (done: number, total: number) => void, signal?: AbortSignal }} opts
 * @returns {Promise<{ embedded: number, errors: number }>}
 */
export async function embedAllGames(endpoint, embedModel, { onProgress, signal } = {}) {
  const games = getGamesNeedingEmbedding(embedModel);
  const total = games.length;
  let embedded = 0;
  let errors = 0;

  console.log(`[embeddings] ${total} games need embedding with model ${embedModel}`);

  for (const game of games) {
    if (signal?.aborted) break;

    const text = buildGameText(game);
    const vector = await runEmbedding(endpoint, embedModel, text);

    if (vector) {
      updateGameEmbedding(game.igdb_id, { vector, model: embedModel });
      embedded++;
    } else {
      errors++;
      console.warn(`[embeddings] Failed to embed "${game.title}"`);
    }

    onProgress?.(embedded + errors, total);

    // Small delay — be polite to local Ollama
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`[embeddings] Done — ${embedded} embedded, ${errors} errors`);
  return { embedded, errors };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Rank all eligible candidate games by cosine similarity to the taste profile vector.
 *
 * @param {number[]} tasteVector       — embedding of the user's taste profile text
 * @param {number}   userId
 * @param {object}   boosts            — { backburnerIds: Set, recentlyAddedIds: Set }
 * @returns {object[]} sorted candidates with similarity scores, most similar first
 */
export function rankCandidatesBySimilarity(tasteVector, userId, boosts = {}) {
  const { backburnerIds = new Set(), recentlyAddedIds = new Set() } = boosts;

  // Fetch eligible candidate ids for this user
  const eligible = getEligibleCandidateIds(userId);
  const eligibleMap = new Map(eligible.map(e => [e.igdb_id, e]));

  // Fetch all stored game embeddings, filter to eligible candidates only
  const allEmbeddings = getAllGameEmbeddings();
  const candidates = allEmbeddings.filter(g => eligibleMap.has(g.igdb_id));

  const results = candidates.map(game => {
    const vector = JSON.parse(game.embedding);
    let score = cosineSimilarity(tasteVector, vector);

    const meta = eligibleMap.get(game.igdb_id);

    // Post-similarity boosts (small — don't override semantic signal)
    if (meta.taste_boost > 0) score += 0.2;
    if (backburnerIds.has(game.igdb_id)) score += 0.05;
    if (recentlyAddedIds.has(game.igdb_id)) score += 0.02;

    return {
      igdb_id: game.igdb_id,
      title: game.title,
      cover_url: game.cover_url ?? null,
      genres: game.genres ? JSON.parse(game.genres) : [],
      hltb_hours: game.hltb_main_extras ?? game.hltb_main ?? null,
      playtime_hours: meta.playtime_minutes ? Math.round(meta.playtime_minutes / 60) : 0,
      is_backburner: meta.status === 'backburner',
      similarity: score,
    };
  });

  return results.sort((a, b) => b.similarity - a.similarity);
}
