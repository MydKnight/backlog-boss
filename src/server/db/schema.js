import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

let db;

/**
 * Returns the shared DatabaseSync singleton, initializing it on first call.
 * @returns {DatabaseSync}
 */
export function getDb() {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || './data/backlog.db';
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

/**
 * Creates all tables and indexes if they don't already exist.
 * Safe to call on every startup — all statements use IF NOT EXISTS.
 * @param {DatabaseSync} db
 */
export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT NOT NULL,
      steam_api_key   TEXT,
      steam_id        TEXT,
      ollama_endpoint TEXT NOT NULL DEFAULT 'http://localhost:11434',
      ollama_model    TEXT NOT NULL DEFAULT 'qwen2.5:14b',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS games (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      igdb_id           INTEGER UNIQUE,
      steam_app_id      INTEGER,
      title             TEXT NOT NULL,
      cover_url         TEXT,
      genres            TEXT,
      themes            TEXT,
      similar_igdb_ids  TEXT,
      hltb_id           INTEGER,
      hltb_main         REAL,
      hltb_main_extras  REAL,
      hltb_completionist REAL,
      hltb_fetched_at   DATETIME,
      igdb_fetched_at   DATETIME,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_games (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id               INTEGER NOT NULL REFERENCES users(id),
      igdb_id               INTEGER REFERENCES games(igdb_id),
      ownership_type        TEXT NOT NULL DEFAULT 'owned_steam',
      status                TEXT NOT NULL DEFAULT 'unplayed',
      playtime_minutes      INTEGER DEFAULT 0,
      playtime_source       TEXT NOT NULL DEFAULT 'steam',
      last_played_at        DATETIME,
      achievement_pct       REAL,
      completion_pct_override REAL,
      steam_synced_at       DATETIME,
      added_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      taste_boost           INTEGER NOT NULL DEFAULT 0,
      snoozed_until         DATETIME,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      igdb_id     INTEGER REFERENCES games(igdb_id),
      event_type  TEXT NOT NULL,
      event_date  DATETIME DEFAULT CURRENT_TIMESTAMP,
      star_rating INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_interviews (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id),
      game_event_id     INTEGER REFERENCES game_events(id),
      igdb_id           INTEGER REFERENCES games(igdb_id),
      interview_type    TEXT NOT NULL,
      positive_tags     TEXT,
      negative_tags     TEXT,
      free_text         TEXT,
      free_text_summary TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS taste_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      model_used   TEXT,
      context_hash TEXT,
      suggestions  TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS guides (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id),
      igdb_id        INTEGER REFERENCES games(igdb_id),
      source_url     TEXT NOT NULL,
      title          TEXT,
      content        TEXT,
      content_length INTEGER,
      fetched_at     DATETIME,
      scroll_position INTEGER DEFAULT 0,
      last_read_at   DATETIME,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id),
      sync_type      TEXT NOT NULL,
      status         TEXT NOT NULL,
      games_updated  INTEGER DEFAULT 0,
      error_message  TEXT,
      started_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at   DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_user_games_user_status ON user_games(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_user_games_igdb ON user_games(igdb_id);
    CREATE INDEX IF NOT EXISTS idx_game_events_user ON game_events(user_id, igdb_id);
    CREATE INDEX IF NOT EXISTS idx_guides_user_game ON guides(user_id, igdb_id);
    CREATE INDEX IF NOT EXISTS idx_taste_snapshots_user ON taste_snapshots(user_id, generated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_games_unique ON user_games(user_id, igdb_id);
  `);

  // Additive migrations — safe to run on every startup, ALTER TABLE IF NOT EXISTS
  // equivalent: check if column exists before adding it.
  const userGamesCols = db.prepare("PRAGMA table_info(user_games)").all().map(c => c.name);
  if (!userGamesCols.includes('taste_boost')) {
    db.exec("ALTER TABLE user_games ADD COLUMN taste_boost INTEGER NOT NULL DEFAULT 0");
    console.log('Migration: added taste_boost to user_games');
  }
  if (!userGamesCols.includes('snoozed_until')) {
    db.exec("ALTER TABLE user_games ADD COLUMN snoozed_until DATETIME");
    console.log('Migration: added snoozed_until to user_games');
  }

  // Embedding columns on games — store vector as JSON float array
  const gamesCols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  if (!gamesCols.includes('embedding')) {
    db.exec("ALTER TABLE games ADD COLUMN embedding TEXT");
    console.log('Migration: added embedding to games');
  }
  if (!gamesCols.includes('embedding_model')) {
    db.exec("ALTER TABLE games ADD COLUMN embedding_model TEXT");
    console.log('Migration: added embedding_model to games');
  }
  if (!gamesCols.includes('embedding_fetched_at')) {
    db.exec("ALTER TABLE games ADD COLUMN embedding_fetched_at DATETIME");
    console.log('Migration: added embedding_fetched_at to games');
  }

  // Embedding model config on users
  const usersCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!usersCols.includes('ollama_embed_model')) {
    db.exec("ALTER TABLE users ADD COLUMN ollama_embed_model TEXT NOT NULL DEFAULT 'nomic-embed-text'");
    console.log('Migration: added ollama_embed_model to users');
  }

  // IGDB ignore flag — marks unresolvable games (DLC, test servers, duplicates)
  if (!gamesCols.includes('igdb_ignored')) {
    db.exec("ALTER TABLE games ADD COLUMN igdb_ignored INTEGER NOT NULL DEFAULT 0");
    console.log('Migration: added igdb_ignored to games');
  }

  // Guide content type + parse warning
  const guidesCols = db.prepare("PRAGMA table_info(guides)").all().map(c => c.name);
  if (!guidesCols.includes('content_type')) {
    db.exec("ALTER TABLE guides ADD COLUMN content_type TEXT NOT NULL DEFAULT 'html'");
    console.log('Migration: added content_type to guides');
  }
  if (!guidesCols.includes('parse_warning')) {
    db.exec("ALTER TABLE guides ADD COLUMN parse_warning INTEGER NOT NULL DEFAULT 0");
    console.log('Migration: added parse_warning to guides');
  }

  // Phase 8: email column for CF Access identity
  // Re-fetch usersCols since it may have been populated above
  const usersCols2 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!usersCols2.includes('email')) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
    console.log('Migration: added email to users');
    // Create unique index (partial — allows multiple NULLs, enforces uniqueness for non-null)
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL");
    console.log('Migration: created unique index on users.email');
  }
}
