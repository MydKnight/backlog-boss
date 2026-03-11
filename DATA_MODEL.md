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
| `status` | TEXT | `unplayed` / `in_progress` / `completed` / `retired` / `ongoing` / `backburner` |
| `playtime_minutes` | INTEGER | Steam sync or manual |
| `playtime_source` | TEXT | `steam` / `manual` |
| `last_played_at` | DATETIME | From Steam or manual |
| `achievement_pct` | REAL | Steam achievement % — nullable |
| `completion_pct_override` | REAL | Manual override 0–100 — nullable |
| `steam_synced_at` | DATETIME | Last Steam sync for this game |
| `added_at` | DATETIME | When user added/imported this game |
| `taste_boost` | INTEGER | Default 0. Set to 99 to force game into taste engine candidate pool regardless of pre-filter score. UI: "Force into next evaluation" toggle. |
| `snoozed_until` | DATETIME | Nullable. When set, game is excluded from taste engine candidates until this date. Set to now+30d via "Nope, not now" dismissal on a suggestion. Auto-re-enters pool after expiry. |
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
      "free_text": "Loved the exploration and tight controls. Stunning art.",
      "recency_weight": 1.5
    }
  ],
  "retired_games": [
    {
      "title": "Assassin's Creed Origins",
      "genres": ["action", "open_world"],
      "negative_tags": ["felt_repetitive", "lost_interest"],
      "free_text": "Open world fatigue. Too many collectibles, story lost me."
    }
  ],
  "in_progress_games": [
    {
      "title": "Hades",
      "genres": ["roguelike", "action"],
      "playtime_hours": 12,
      "hltb_main_extras": 22
    }
  ],
  "candidate_games": [
    {
      "igdb_id": 12345,
      "title": "Dead Cells",
      "genres": ["roguelike", "platformer"],
      "hltb_main_extras": 20,
      "playtime_hours": 0,
      "is_backburner": false
    }
  ]
}
```

The prompt instructs the model to rank `candidate_games` by predicted enjoyment given the user's history, returning a JSON array of `{ igdb_id, title, explanation, rank }`. The model is asked to return 25 results — 20 are displayed, 5 held as dismissal replacements.

---

## Taste Engine Pre-Filter Algorithm

With 1300+ candidate games, sending all to the LLM would exceed context window limits and degrade output quality. A pre-filter scores and narrows the candidate pool to 100 games before LLM inference.

### Hard Exclusions (never sent to model)
- Status: `completed`, `retired`, `ongoing`, `in_progress` (above 60-min threshold)
- `snoozed_until` is set and has not expired
- Genre is hard-excluded: 3+ retirements with that genre, zero positive completions in that genre

### Scoring
```
Base score = 0

Positive signals:
  +3  genre overlap with 5★ completion in last 12 months
  +2  genre overlap with 5★ completion (older)
  +1  genre overlap with 4★ completion
  +5  status = backburner (explicit prior intent)
  +3  added_at within last 30 days (recency boost for new library additions)
  +99 taste_boost = 1 (forced inclusion — always enters pool regardless of score)

Negative signals:
  -1  genre overlap with retired game (soft penalty)

Mitigations:
  playtime_minutes > 6000 (100h): zero out all negative scores
  (high prior engagement overrides genre penalties)
```

### Pool Constraints (applied after scoring)
- Sort by score descending, take top 100
- Cap games where `hltb_main_extras > 40h` at 15 of the 100 slots
  (prevents long-game dominance when Now view is already full of epics)
- `taste_boost` games always occupy a slot regardless of cap rules

### Pre-filter Score Storage
After each run, pre-filter scores for ALL candidates are stored (not just top 100).
This enables the "Why wasn't this game evaluated?" lookup — the UI can show a
game's score breakdown explaining why it didn't make the cut.

### "Nope, Not Now" Dismissal
When a user dismisses a suggestion from the Next view:
- `snoozed_until = now + 30 days` is written to `user_games`
- The dismissed game is replaced immediately from the held reserve (positions 21-25)
- After 30 days the game automatically re-enters the candidate pool

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