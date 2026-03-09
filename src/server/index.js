import 'dotenv/config';
import express from 'express';
import { getDb } from './db/schema.js';
import { getDefaultUser, createDefaultUser } from './db/queries.js';
import syncRouter from './routes/sync.js';

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
  });
});

app.use('/api/sync', syncRouter);

// 404 fallback
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
