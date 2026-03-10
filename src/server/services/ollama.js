/**
 * Ollama service — all LLM inference goes through this file.
 *
 * Why this abstraction exists:
 * - Ollama is a local process that may not always be running
 * - Model load times vary (cold start can be 20-60s for a 14B model)
 * - Response format compliance is not guaranteed — the model may not return
 *   valid JSON even when instructed to. All parsing is defensive.
 *
 * From inside Docker, Ollama runs on the host machine, so we use
 * host.docker.internal instead of localhost.
 */

const TIMEOUT_MS = 120_000; // 2 minutes — generous for cold 14B model start

/**
 * Check whether Ollama is reachable and the configured model is available.
 * @param {string} endpoint  e.g. 'http://localhost:11434'
 * @param {string} model     e.g. 'qwen2.5:14b'
 * @returns {{ reachable: boolean, modelAvailable: boolean, models: string[] }}
 */
export async function checkOllamaHealth(endpoint, model) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000); // short timeout for health check

    const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return { reachable: false, modelAvailable: false, models: [] };

    const data = await res.json();
    const models = (data.models ?? []).map(m => m.name);

    // Ollama model names can include the tag, e.g. 'qwen2.5:14b'
    // A model is considered available if any entry starts with the configured name
    const modelAvailable = models.some(m => m === model || m.startsWith(`${model}:`));

    return { reachable: true, modelAvailable, models };
  } catch {
    return { reachable: false, modelAvailable: false, models: [] };
  }
}

/**
 * Run a single inference against Ollama.
 *
 * We use the /api/generate endpoint (not /api/chat) because we're doing
 * batch inference, not a conversation. The full prompt is self-contained.
 *
 * The `format: 'json'` parameter instructs Ollama to constrain its output
 * to valid JSON. This works most of the time but is not a hard guarantee —
 * the model may still include preamble text, so we extract JSON defensively.
 *
 * @param {string} endpoint
 * @param {string} model
 * @param {string} prompt
 * @returns {string|null} Raw response text, or null if Ollama is unreachable/timed out
 */
export async function runInference(endpoint, model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        format: 'json',  // asks Ollama to constrain output to JSON
        stream: false,   // we want the full response in one payload, not streamed
        options: {
          temperature: 0.3, // lower temperature = more deterministic rankings
                            // 0.0 is fully deterministic but can be repetitive
                            // 0.3 gives slight variation while staying consistent
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.error(`Ollama HTTP error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data.response ?? null;

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.error(`Ollama inference timed out after ${TIMEOUT_MS / 1000}s`);
    } else {
      console.error('Ollama inference error:', err.message);
    }
    return null;
  }
}

/**
 * Extract a JSON value from a model response string.
 *
 * Even with format:'json', models sometimes wrap their output in markdown
 * code fences (```json ... ```) or add explanatory text before/after.
 * This function tries three strategies in order:
 *   1. Direct JSON.parse (the ideal case)
 *   2. Extract from ```json ... ``` code fence
 *   3. Find the first [ or { and parse from there
 *
 * Returns null if nothing parseable is found.
 *
 * @param {string} text
 * @returns {any|null}
 */
export function extractJson(text) {
  if (!text) return null;

  // Strategy 1: direct parse
  try { return JSON.parse(text); } catch {}

  // Strategy 2: markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // Strategy 3: find first array or object
  const arrayStart = text.indexOf('[');
  const objectStart = text.indexOf('{');
  const start = arrayStart === -1 ? objectStart
              : objectStart === -1 ? arrayStart
              : Math.min(arrayStart, objectStart);

  if (start !== -1) {
    try { return JSON.parse(text.slice(start)); } catch {}
  }

  return null;
}
