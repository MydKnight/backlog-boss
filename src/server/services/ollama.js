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
 * Run inference against Ollama using streaming mode.
 *
 * We stream the response so we can count tokens as they arrive — this lets
 * the status endpoint report progress ("still alive") without knowing the
 * final token count. The full text is buffered and returned when done.
 *
 * No timeout is imposed — background jobs run until Ollama finishes.
 * The onToken callback receives a running count for status reporting.
 *
 * @param {string} endpoint
 * @param {string} model
 * @param {string} prompt
 * @param {{ onToken?: (count: number) => void, signal?: AbortSignal, json?: boolean }} options
 * @returns {Promise<string|null>} Full response text, or null on failure
 */
export async function runInference(endpoint, model, prompt, { onToken, signal, json = false } = {}) {
  try {
    const res = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        ...(json ? { format: 'json' } : {}),
        stream: true, // stream tokens so we can count progress
        options: {
          temperature: 0.3,
        },
      }),
      signal,
    });

    if (!res.ok) {
      console.error(`Ollama HTTP error: ${res.status}`);
      return null;
    }

    // Read the NDJSON stream — each line is a JSON object with a `response` chunk
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';
    let tokenCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.response) {
            fullResponse += chunk.response;
            tokenCount++;
            onToken?.(tokenCount);
          }
          if (chunk.done) break;
        } catch { /* malformed chunk — skip */ }
      }
    }

    return fullResponse || null;

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('[ollama] Inference cancelled via abort signal');
    } else {
      console.error('Ollama inference error:', err.message);
    }
    return null;
  }
}

/**
 * Generate an embedding vector for a text string.
 *
 * Uses a dedicated embedding model (nomic-embed-text) rather than the
 * generalist LLM — much faster and purpose-built for semantic similarity.
 *
 * @param {string} endpoint  e.g. 'http://localhost:11434'
 * @param {string} model     e.g. 'nomic-embed-text'
 * @param {string} text      text to embed
 * @returns {Promise<number[]|null>} embedding vector, or null on failure
 */
export async function runEmbedding(endpoint, model, text) {
  try {
    const res = await fetch(`${endpoint}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) {
      console.error(`Ollama embeddings HTTP error: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.embedding ?? null;
  } catch (err) {
    console.error('Ollama embedding error:', err.message);
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
