# Backlog Boss — Data Model

## Design Principles

- All tables include `user_id` for future multi-user support
- IGDB is the canonical game identity — `igdb_id` is the primary game key across all tables
- Steam ownership and HLTB benchmarks are supplementary data layered onto IGDB records
- Soft deletes preferred over hard deletes for taste engine signal preservation
- Timestamps on all records (`created_at`, `updated_at`)

---

## Tables

### `users`
The owning account. MVP has one row.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `username` | TEXT | |
| `steam_api_key` | TEXT | Encrypted at rest |
| `steam_id` | TEXT | Steam user ID (64-bit) |
| `ollama_endpoint` | TEXT | Default: http://localhost:11434 |
| `ollama_model` | TEXT | Default: qwen2.5:14b |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

---

### `games`
Canonical game records sourced from IGDB. One row per game, shared across users.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `igdb_id` | INTEGER UNIQUE | IGDB canonical ID |
| `steam_app_id` | INTEGER | Nullable — not all games are on Steam |
| `title` | TEXT | |
| `cover_url` | TEXT | IGDB cover image |
| `genres` | TEXT | JSON array of genre strings |
| `themes` | TEXT | JSON array of theme strings |
| `similar_igdb_ids` | TEXT | JSON array — IGDB similar game IDs |
| `hltb_id` | INTEGER | Nullable |
| `hltb_main` | REAL | Hours — Main story |
| `hltb_main_extras` | REAL | Hours — Main + Extras (primary benchmark) |
| `hltb_completionist` | REAL | Hours — 100% |
| `hltb_fetched_at` | DATETIME | For cache freshness check |
| `igdb_fetched_at` | DATETIME | |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

---

### `user_games`
The user's relationship to a game. Covers owned, historical, and wishlist entries.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK → users | |
| `igdb_id` | INTEGER FK → games | |
| `ownership_type` | TEXT | `owned_steam` / `owned_switch` / `owned_ps5` / `owned_other` / `historical` / `unowned` |
| `status` | TEXT | `unplayed` / `in_progress` / `completed` / `retired` |
| `playtime_minutes` | INTEGER | Steam sync or manual |
| `playtime_source` | TEXT | `steam` / `manual` |
| `last_played_at` | DATETIME | From Steam or manual |
| `achievement_pct` | REAL | Steam achievement % — nullable |
| `completion_pct_override` | REAL | Manual override 0–100 — nullable |
| `steam_synced_at` | DATETIME | Last Steam sync for this game |
| `added_at` | DATETIME | When user added/imported this game |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

**Computed field (application layer):** `estimated_pct_complete` = `playtime_minutes / (hltb_main_extras * 60)`, capped at 99% until manually marked complete.

---

### `game_events`
Completion and retirement records. One row per exit event.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK → users | |
| `igdb_id` | INTEGER FK → games | |
| `event_type` | TEXT | `completed` / `retired` |
| `event_date` | DATETIME | When the user marked it |
| `star_rating` | INTEGER | 1–5, nullable |
| `created_at` | DATETIME | |

---

### `game_interviews`
Structured exit interview responses. One row per event.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK → users | |
| `game_event_id` | INTEGER FK → game_events | |
| `igdb_id` | INTEGER FK → games | |
| `interview_type` | TEXT | `completed` / `retired` / `history` |
| `positive_tags` | TEXT | JSON array: `great_story` / `loved_gameplay` / `hidden_gem` / `overhyped` / `would_replay` / `recommend` |
| `negative_tags` | TEXT | JSON array: `felt_repetitive` / `too_difficult` / `lost_interest` / `life_got_busy` / `not_my_genre` / `other` |
| `free_text` | TEXT | Raw user input |
| `free_text_summary` | TEXT | LLM-summarized version for taste engine context |
| `created_at` | DATETIME | |

---

### `taste_snapshots`
Cached output from Ollama taste inference runs.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK → users | |
| `generated_at` | DATETIME | When inference ran |
| `model_used` | TEXT | e.g. `qwen2.5:14b` |
| `context_hash` | TEXT | Hash of input payload — detect if profile changed |
| `suggestions` | TEXT | JSON array of `{ igdb_id, title, explanation, rank }` |
| `created_at` | DATETIME | |

The Next view displays the most recent `taste_snapshot` for the user. A new snapshot is generated when the user requests it or when `context_hash` changes.

---

### `guides`
Ingested walkthrough guides, one per game per user.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK → users | |
| `igdb_id` | INTEGER FK → games | |
| `source_url` | TEXT | Original URL |
| `title` | TEXT | Parsed page title |
| `content` | TEXT | Readability-cleaned HTML/text |
| `content_length` | INTEGER | Character count |
| `fetched_at` | DATETIME | |
| `scroll_position` | INTEGER | Last scroll position in px |
| `last_read_at` | DATETIME | |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

---

### `sync_log`
Audit trail for Steam sync operations.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK → users | |
| `sync_type` | TEXT | `steam_library` / `hltb_batch` / `igdb_enrich` |
| `status` | TEXT | `success` / `partial` / `failed` |
| `games_updated` | INTEGER | |
| `error_message` | TEXT | Nullable |
| `started_at` | DATETIME | |
| `completed_at` | DATETIME | |

---

## Key Relationships

```
users
  └── user_games (one per game the user knows about)
        └── games (shared canonical records from IGDB)
              ├── hltb data (on games table)
              └── igdb data (on games table)
  └── game_events (completed / retired)
        └── game_interviews (structured debrief)
  └── taste_snapshots (cached LLM suggestions)
  └── guides (per-game guide content)
  └── sync_log (audit trail)
```

---

## Status Flow

```
unplayed → in_progress → completed
                      ↘ retired
historical (enters directly with a rating, no playtime)
```

Games in `historical` status with no ownership type are taste-engine signals only — they appear in the History view but not in Now/Next/Done.

---

## Taste Engine Context Payload

When querying Ollama, the app assembles this JSON payload:

```json
{
  "completed_games": [
    {
      "title": "Hollow Knight",
      "genres": ["platformer", "metroidvania"],
      "star_rating": 5,
      "positive_tags": ["great_story", "loved_gameplay", "would_replay"],
      "negative_tags": [],
      "summary": "Loved the exploration and tight controls. Stunning art."
    }
  ],
  "retired_games": [
    {
      "title": "Assassin's Creed Origins",
      "genres": ["action", "open_world"],
      "negative_tags": ["felt_repetitive", "lost_interest"],
      "summary": "Open world fatigue. Too many collectibles, story lost me."
    }
  ],
  "in_progress_games": [
    {
      "title": "Hades",
      "genres": ["roguelike", "action"],
      "playtime_hours": 12,
      "hltb_main_extras": 22,
      "estimated_pct": 55
    }
  ],
  "candidate_games": [
    {
      "igdb_id": 12345,
      "title": "Dead Cells",
      "genres": ["roguelike", "platformer"],
      "hltb_main_extras": 20,
      "playtime_hours": 0
    }
  ]
}
```

The prompt instructs the model to rank `candidate_games` by predicted enjoyment given the user's history, returning a JSON array of `{ igdb_id, title, explanation, rank }`.

---

## Indexes

```sql
CREATE INDEX idx_user_games_user_status ON user_games(user_id, status);
CREATE INDEX idx_user_games_igdb ON user_games(igdb_id);
CREATE INDEX idx_game_events_user ON game_events(user_id, igdb_id);
CREATE INDEX idx_guides_user_game ON guides(user_id, igdb_id);
CREATE INDEX idx_taste_snapshots_user ON taste_snapshots(user_id, generated_at DESC);
CREATE UNIQUE INDEX idx_games_igdb ON games(igdb_id);
CREATE UNIQUE INDEX idx_user_games_unique ON user_games(user_id, igdb_id);
```