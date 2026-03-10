import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { getDb } from './db/schema.js';
import { getDefaultUser, createDefaultUser } from './db/queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import syncRouter from './routes/sync.js';
import igdbRouter from './routes/igdb.js';
import hltbRouter from './routes/hltb.js';
import gamesRouter from './routes/games.js';
import tasteRouter from './routes/taste.js';

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Database init
// ---------------------------------------------------------------------------

const db = getDb(); // creates tables on first run
console.log('Database initialised.');

// Create default user (owner) on first run
if (!getDefaultUser()) {
  const user = createDefaultUser({
    ollamaEndpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
  });
  console.log(`Default user created (id=${user.id}).`);

  // Seed Steam credentials from env if provided
  if (process.env.STEAM_API_KEY && process.env.STEAM_ID) {
    db.prepare(`
      UPDATE users SET steam_api_key = ?, steam_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(process.env.STEAM_API_KEY, process.env.STEAM_ID, user.id);
    console.log('Steam credentials loaded from environment.');
  }
} else {
  // On subsequent startups, refresh Steam credentials from env if set
  const user = getDefaultUser();
  if (process.env.STEAM_API_KEY && process.env.STEAM_ID) {
    db.prepare(`
      UPDATE users SET steam_api_key = ?, steam_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(process.env.STEAM_API_KEY, process.env.STEAM_ID, user.id);
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  const user = getDefaultUser();
  res.json({
    status: 'ok',
    user: user ? { id: user.id, username: user.username } : null,
    steamConfigured: !!(user?.steam_api_key && user?.steam_id),
    ollamaEndpoint: user?.ollama_endpoint ?? null,
    ollamaModel: user?.ollama_model ?? null,
  });
});

app.use('/api/sync', syncRouter);
app.use('/api/igdb', igdbRouter);
app.use('/api/hltb', hltbRouter);
app.use('/api/games', gamesRouter);
app.use('/api/taste', tasteRouter);

// Serve built React app (production / Docker)
const distPath = join(__dirname, '../../dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  // SPA fallback — all non-API routes return index.html
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(distPath, 'index.html'));
  });
}

// 404 fallback (API routes only in production; all routes in dev)
app.use((req, res) => {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Backlog Boss running on http://localhost:${PORT}`);
});
