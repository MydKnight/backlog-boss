# CLAUDE.md — Backlog Boss

This file is the source of truth for Claude Code sessions on this project. Read it fully before taking any action.

---

## What This Project Is

A personal game backlog manager with a taste-aware suggestion engine. The owner has 500+ Steam games plus decades of gaming history. The app surfaces the right game to play next, tracks in-progress games toward completion, and ingests walkthrough guides for offline reading.

This is a **personal tool**, not a public product. Multi-user is designed in at the data layer but not built at MVP.

---

## Key Design Documents

Before writing any code, read these files in order:

1. `PROJECT_BRIEF.md` — Full scope, phase plan, product decisions
2. `DATA_MODEL.md` — Complete database schema with rationale
3. `API_INTEGRATION_NOTES.md` — Steam, IGDB, HLTB, Ollama, Readability integration contracts

Do not deviate from decisions documented in these files without explicit instruction.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js |
| Frontend | React + Tailwind CSS (PWA) |
| Database | SQLite via `node:sqlite` (Node 22 built-in) |
| LLM | Ollama (`qwen2.5:14b`) via local HTTP |
| Hosting | Docker container on QNAP NAS |
| Exposure | Cloudflare Zero Trust tunnel |

---

## Project Structure

```
/
├── CLAUDE.md                  ← this file
├── PROJECT_BRIEF.md
├── DATA_MODEL.md
├── API_INTEGRATION_NOTES.md
├── docker-compose.yml
├── Dockerfile
├── package.json
├── .env.example
├── /src
│   ├── /server                ← Node.js Express backend
│   │   ├── index.js           ← entry point
│   │   ├── /routes            ← API route handlers
│   │   ├── /services          ← external API integrations
│   │   │   ├── steam.js
│   │   │   ├── igdb.js
│   │   │   ├── hltb.js        ← HLTB abstraction layer (see below)
│   │   │   ├── ollama.js
│   │   │   └── readability.js
│   │   ├── /db
│   │   │   ├── schema.js      ← table creation + migrations
│   │   │   └── queries.js     ← reusable query functions
│   │   └── /utils
│   └── /client                ← React PWA
│       ├── /components
│       ├── /views             ← Now, Next, Done, History
│       ├── /hooks
│       └── App.jsx
└── /data                      ← SQLite DB lives here (gitignored)
```

---

## Non-Negotiable Architecture Rules

### HLTB Abstraction Layer
The `howlongtobeat` npm package is unofficial and breaks periodically. **All HLTB access must go through `src/server/services/hltb.js` only.** No other file may import from `howlongtobeat` directly. The service exposes only:
- `fetchByTitle(title)` → `{ hltb_id, main, mainExtras, completionist } | null`
- `fetchByHltbId(id)` → same shape

### IGDB as Canonical Game Identity
`igdb_id` is the primary key for game identity across the entire system. `steam_app_id` is a lookup field, not an identity field. When building any feature that references a game, use `igdb_id`.

### user_id on Everything
Every table that stores user data includes `user_id`. This is not optional even at MVP. Queries must always filter by `user_id`.

### LLM is Batch, Not Real-Time
Ollama is invoked on demand only (user action or profile change detection via context hash). It is never invoked in a request/response cycle for page loads. Results are always cached in `taste_snapshots`.

### Offline First
The PWA must function offline for reading (guides, library, Done/History views). Sync operations fail gracefully when offline with clear UI feedback. Do not block UI renders on network calls.

---

## Phase Plan Summary

| Phase | Deliverable |
|---|---|
| 1 | Docker setup, Steam sync, IGDB enrichment, HLTB lookup, DB schema |
| 2 | React PWA, four views (Now/Next/Done/History), exit interview flows |
| 3 | Ongoing/infinite game type — `ongoing` status, "Always On" section, auto-detection |
| 4 | Ollama taste engine, suggestion ranking, Next view LLM integration |
| 5 | Guide reader (URL ingest, Readability parse, offline storage, scroll position) |
| 6 | Multi-user auth, per-user Steam keys, scoped queries |

**Current phase:** Phase 2 (in progress — on checkpoint 2.2).

---

## Coding Conventions

- **No Python.** Node.js only.
- **Async/await** throughout. No raw Promise chains.
- **Error handling:** All external API calls wrapped in try/catch. Failures logged to `sync_log` table or console — never swallowed silently.
- **No ORMs.** Use `node:sqlite` directly with parameterized queries in `src/server/db/queries.js`.
- **Environment variables** for all secrets and config. Never hardcode. See `.env.example`.
- **Mobile-first CSS.** Tailwind utility classes. No custom CSS files unless unavoidable.
- **No TypeScript** at MVP — plain JS with JSDoc comments for complex types.

---

## External API Behavior Notes

### Steam
- Playtime is in minutes (`playtime_forever`)
- `rtime_last_played` is a Unix timestamp (seconds)
- Achievement % must be computed from individual achievement records — not provided directly
- Fetch achievements lazily per game, not in bulk sync

### IGDB
- Auth requires Twitch OAuth2 client credentials flow — token lasts ~60 days, cache it
- Rate limit: 4 req/sec — use a request queue (`p-queue` package recommended)
- Steam → IGDB match: use `external_games.category = 1` (Steam category ID)
- Some Steam games will not match IGDB — handle gracefully, don't block sync

### HLTB
- Unofficial package — wrap everything, expect breakage
- Fuzzy title matching needed — HLTB titles often differ slightly from Steam/IGDB
- Cache aggressively (30 day TTL) — don't hit HLTB on every sync

### Ollama
- From inside Docker: use `http://host.docker.internal:11434` not `localhost`
- Response format: request `"format": "json"` but still validate — model may not comply
- Timeout: set to 120s minimum
- If Ollama is unreachable: show last cached snapshot, do not error the page

---

## What "Done" Looks Like Per Phase

### Phase 1 Done
- [ ] Docker container builds and runs on QNAP NAS
- [ ] `.env` wired, DB initializes on first run
- [ ] Steam sync populates `games` and `user_games` tables
- [ ] IGDB enrichment runs after Steam sync, fills `games` with metadata
- [ ] HLTB lookup runs for each game, stored on `games` table
- [ ] `sync_log` records each sync operation
- [ ] Manual sync endpoint exists (`POST /api/sync`)

### Phase 2 Done
- [ ] PWA installable on iOS/Android home screen
- [ ] Now view shows in-progress games sorted by estimated % complete
- [ ] Next view shows unplayed games (unsorted at this phase)
- [ ] Done view shows completed games with ratings
- [ ] History view allows IGDB search and game logging
- [ ] "Mark Beaten" flow with full exit interview
- [ ] "Mark Retired" flow with reason tags and optional notes
- [ ] Sync button in UI triggers backend sync
- [ ] App is usable offline for browsing (no sync)

#### Phase 2 Commit Decomposition
Phase 2 is split into four tested-then-committed checkpoints:

**2.1 — PWA scaffold + shell**
React app boots, Tailwind wired, four tab views exist with placeholder content,
PWA manifest in place, installable on mobile. No real data. Verify: loads on mobile.

**2.2 — Now + Next views (read-only)**
Backend API endpoints for in-progress and unplayed games. Now view renders with
% complete sorting. Next view renders backlog list. Sync button works with real data.

**2.3 — Mark Beaten + Mark Retired flows**
Exit interview component, backend endpoints writing to `game_events` and
`game_interviews`, status transitions in `user_games`. Done view shows results.

**2.4 — History view**
IGDB search endpoint + UI, manual game logging flow (lighter interview), logged
games appear in Done/History.

### Phase 3 Done
- [ ] `ongoing` status added to `user_games` status enum (DB migration safe — additive only)
- [ ] "Mark as Ongoing" flow accessible from game detail (no interview, just status change)
- [ ] Now view renders `ongoing` games in a separate "Always On" section without HLTB bar
- [ ] Next view excludes `ongoing` games
- [ ] Done view excludes `ongoing` games
- [ ] Exit path from `ongoing` is `retired` (existing flow, no changes needed)
- [ ] Auto-detection heuristic surfaces candidate games (HLTB null + playtime > 10h) for user confirmation

### Phase 4 Done
- [ ] Ollama integration service functional
- [ ] Taste profile context builder assembles correct payload
- [ ] `ongoing` games included as a signal category in the context payload
- [ ] Snapshot generated and stored on demand
- [ ] Next view displays LLM-ranked suggestions with explanations
- [ ] "Refresh Suggestions" button triggers new snapshot if context changed
- [ ] Retired and ongoing games correctly excluded from candidates

### Phase 5 Done
- [ ] Guide URL input per game
- [ ] Server-side fetch + Readability parse
- [ ] Guide stored locally, accessible offline
- [ ] Mobile reader UI renders cleaned content
- [ ] Scroll position persisted and restored on reopen

### Phase 6 Done
- [ ] Auth layer (username/password minimum)
- [ ] Per-user Steam API key storage
- [ ] All queries scoped to authenticated user
- [ ] Basic account settings page

---

## Common Pitfalls to Avoid

1. **Don't import `howlongtobeat` anywhere except `src/server/services/hltb.js`**
2. **Don't use `localhost` for Ollama inside Docker** — use `host.docker.internal`
3. **Don't fetch Steam achievements in bulk** — one request per game, fetch lazily
4. **Don't block the UI on Ollama inference** — it's slow, always async with loading state
5. **Don't forget `user_id` filters** — every user-data query must be scoped
6. **Don't hard-delete game records** — soft delete to preserve taste engine history
7. **Don't re-fetch HLTB data on every sync** — check `hltb_fetched_at` TTL first

---

## Git Workflow

### Branch and Tag Strategy
- `main` is always the last **completed, working phase**
- Development happens directly on `main` for this solo project — no feature branches needed
- **Tag every phase completion:** `git tag phase-1-complete` before starting the next phase
- Tags are the rollback points — if a phase goes badly, `git checkout phase-N-complete` returns to a known-good state

### Commit Cadence
- Commit liberally during a phase (working checkpoint = commit)
- At phase completion: ensure all phase checklist items are done, then tag
- Design doc updates (lessons learned, decision changes) get their own commit with a clear message

### What Is and Isn't Committed
- **Committed:** all source code, design docs, `package.json`, `.env.example`, `Dockerfile`, `docker-compose.yml`
- **Never committed:** `.env` (secrets), `/data/` (SQLite DB file), `node_modules/`

### Rolling Back a Failed Phase
```bash
# See available phase tags
git tag

# Return to last good phase (discards all uncommitted changes)
git checkout phase-N-complete

# If you want to keep the bad phase for reference before rolling back
git branch failed-phase-2-attempt
git checkout phase-1-complete
```

### Lessons Learned Workflow
When a phase fails and you roll back:
1. Update the relevant design doc with what went wrong and why
2. Update `CLAUDE.md` if the architecture decision needs changing
3. Commit those doc changes with message: `docs: lessons learned from phase N attempt`
4. Then re-implement the phase with the corrected approach

---

## Asking for Clarification

If requirements are ambiguous, check `PROJECT_BRIEF.md` first. If still unclear, ask before implementing. Do not make architectural assumptions — the data model and API contracts in the design docs are considered final for each phase.