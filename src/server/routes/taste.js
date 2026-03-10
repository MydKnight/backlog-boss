import { Router } from 'express';
import { getDefaultUser } from '../db/queries.js';
import { checkOllamaHealth } from '../services/ollama.js';

const router = Router();

/**
 * GET /api/taste/health
 * Check whether Ollama is reachable and the configured model is available.
 * Use this to verify your setup before attempting inference.
 */
router.get('/health', async (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(500).json({ error: 'No user configured.' });

  const endpoint = user.ollama_endpoint;
  const model = user.ollama_model;

  const health = await checkOllamaHealth(endpoint, model);

  res.json({
    endpoint,
    model,
    ...health,
  });
});

export default router;
