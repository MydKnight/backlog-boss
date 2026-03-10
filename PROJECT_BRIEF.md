# Backlog Boss — Project Brief

## What This Is

A personal game backlog manager with a taste-aware suggestion engine. The core problem it solves: given a Steam library of 500+ games plus years of gaming history across platforms, surface the right game to play next — and keep momentum toward completing games already in flight.

This is a personal tool first. It is not a social platform. Multi-user support is designed in from day one at the data layer but not built out at MVP.

---

## Core Views

| View | Purpose |
|---|---|
| **Now** | In-progress games, sorted by proximity to completion (playtime vs. HLTB benchmark) |
| **Next** | Prioritized backlog queue, informed by the taste engine |
| **Done** | Completed games with ratings, debrief notes, and guide references |
| **History** | All games ever played regardless of ownership or platform — the taste engine's foundation |

**History** is a first-class section, not just an onboarding flow. First launch surfaces it prominently to seed the taste engine. It remains permanently accessible to catalog games at any time.

---

## Data Sources

| Source | What It Provides | Notes |
|---|---|---|
| **Steam API** | Library, playtime, last-played date, achievement % | Requires user's Steam API key. Ownership is a flag — all games visible. |
| **IGDB** | Canonical game records, genres, themes, similar games, full catalog search | Free, Twitch-owned, well-maintained. Primary game database backbone. |
| **HLTB (unofficial npm)** | Main+Extras completion benchmarks | Wrapped in an abstraction layer for resilience when API breaks. |
| **Ollama (local LLM)** | Taste-based suggestions in the Next view | Periodic inference over user's full taste profile. Not conversational — batch query. |

IGDB is the canonical game record for all games in the system. Steam ownership and HLTB benchmarks are data layered on top of IGDB records.

---

## Taste Engine

The suggestion engine is the differentiating feature. It works across several signal types:

**Signals fed to the LLM:**
- Star rating on completed games
- Structured exit interview tags (completed and retired)
- Free-text debrief notes (summarized before storage)
- Historical game log ratings (can predate the app by decades)
- Retired game reasons (informs what *not* to surface)
- Playtime vs. HLTB ratio per game (engagement proxy)

**How suggestions work:**
On demand (or periodically), the app assembles a taste profile context payload and queries Ollama. The model ranks unplayed/stalled games from the user's library and returns prioritized picks with plain-language explanations. Output is cached and displayed in the Next view.

**Key design principle:** The taste engine is aware of *all games*, not just owned ones. A PS5 game played years ago, rated in History, influences what gets surfaced from the Steam library today.

---

## Exit States

Every game reaches one of two exits:

### Completed
Triggered manually ("I'm done with this game").
- Star rating (1–5)
- Optional structured tags: *Great story / Loved the gameplay / Hidden gem / Overhyped / Would replay / Recommend to others*
- Optional free text debrief

### Retired
Triggered manually ("I'm not going back to this").
- Reason tags: *Felt repetitive / Too difficult / Lost interest / Life got busy / Not my genre / Other*
- Optional free text
- Game is removed from the Next view and its signal informs the taste engine negatively

Both flows use the same interview component. Historical games in the History section use a lighter version of the same flow.

---

## Guide Reader

Per-game feature for attaching and reading walkthrough guides offline.

- User provides a URL while online
- App fetches and parses the page using Mozilla Readability (same engine as Firefox Reader Mode)
- Cleaned content stored locally — available offline after first fetch
- Scroll position persisted per game — reopening a guide returns to exactly where you left off
- GameFAQs plain-text FAQs and structured HTML guides (IGN, etc.) both supported
- Chapter/section parsing is a future enhancement, not MVP

---

## Stack Decisions

| Layer | Choice | Rationale |
|---|---|---|
| **Runtime** | Node.js | Existing expertise |
| **Frontend** | React PWA | Mobile-first, installable, offline-capable without App Store |
| **Database** | SQLite via `node:sqlite` (Node 22 built-in) | Zero dependencies, synchronous API, local-first. No native compilation required. |
| **LLM** | Ollama (Qwen 2.5 14B) | Already available locally, sufficient for batch taste inference |
| **Hosting** | QNAP NAS Docker container | Existing infrastructure |
| **Exposure** | Cloudflare Zero Trust tunnel | Existing setup, vanity URL, no open ports |
| **Styling** | Tailwind CSS | Mobile-first utility classes |

---

## Sync Strategy

- **Trigger:** On app open + manual sync button in UI
- **Steam data:** Playtime, last-played, library pulled fresh each sync
- **HLTB data:** Fetched once per game, cached, refreshed periodically (not every sync)
- **Conflict resolution:** Last-write-wins. Offline edits (e.g., marking a game beaten while offline) overwrite server state on next sync. Conflicts from offline use are expected to be rare.

---

## Multi-User Design

All database tables include a `user_id` foreign key from day one. At MVP, only the owner account exists. Expanding to a small trusted circle (friends/family) later requires:
- Simple auth layer (username/password or Steam OAuth)
- Each user provides their own Steam API key
- Taste engine and library are fully isolated per user

No social feed, visibility flags, or shared data at any phase of this plan.

---

## Phase Plan

### Phase 1 — Core Library Sync
- Docker container setup (Node.js + SQLite)
- Steam API integration: pull library, playtime, last-played, achievements
- IGDB integration: enrich each Steam game with canonical record
- HLTB integration: fetch Main+Extras benchmark per game, abstraction layer
- Basic data model established

### Phase 2 — The Four Views
- React PWA scaffold, mobile-first, Tailwind
- Now view: in-progress games sorted by time-invested ratio (playtime ÷ HLTB), displayed as a progress bar — not labeled as "% complete" since HLTB is a population average, not a personal benchmark
- Next view: backlog queue (static sort initially, taste engine wired in Phase 4)
- Done view: completed game list with ratings
- History view: search any game via IGDB, log it with rating and light interview
- Manual sync button
- "Mark beaten" and "Mark retired" flows with full exit interview

### Phase 3 — Game Status & Curation
Adds two new statuses that require proper persistence across Steam syncs, and
makes the Now view threshold a reliable curation tool.

**New statuses (both additive DB changes — safe to add):**

`ongoing` — games with no completion state (live service, board game apps, sandboxes)
- Now: shown in a separate "Always On" section, no HLTB bar
- Next: excluded — already in rotation, not backlog
- Done: excluded — never "done"
- Taste engine: playtime and last-played are still valid signals
- Flow: "Mark as Ongoing" — no interview, just status change
- Exit: `retired` (existing flow)
- Auto-detection heuristic: surface candidates where HLTB is null AND playtime > 10h

`backburner` — games the user has explicitly pushed out of Now
- Survives Steam sync (added to protected statuses — sync will not overwrite)
- Now: excluded, even if playtime is above the threshold
- Next: shown alongside unplayed games, optionally with a visual indicator
- Flow: the "→ Next" quick action on Now cards sets this status (replaces the
  current temporary `unplayed` approach which doesn't survive re-sync)
- Exit: user can "Move to Now" to restore `in_progress`, or retire it

**Now view threshold (already implemented in Phase 2):**
- 60-minute default — games below this land in Next automatically
- `backburner` status makes explicit user deferral persistent across syncs
- Threshold constant lives in `queries.js` (`NOW_THRESHOLD_MINUTES`)

### Phase 4 — Taste Engine
- Ollama integration (Qwen 2.5 14B)
- Taste profile context builder: assembles ratings, tags, notes, playtime signals
- `ongoing` games included as a signal category in the context payload
- Batch inference query + response parser
- Next view updated to show LLM-ranked suggestions with explanations
- "Refresh Suggestions" button triggers new snapshot if context changed
- Retired and ongoing games correctly excluded from candidates

### Phase 5 — Guide Reader
- URL ingestion + Readability parsing
- Local storage of cleaned guide content
- Mobile reader UI with scroll position persistence
- Offline access after first fetch

### Phase 6 — Multi-User
- Auth layer
- Per-user Steam API key storage
- User-scoped all queries
- Basic account management

---

## Out of Scope (MVP)
- Social features / shared profiles
- Native iOS/Android app (PWA covers the need)
- Switch/PS5 automatic sync (manual History entry is the workaround)
- Chapter-level guide navigation
- Real-time sync / websockets
- Game price tracking or deal alerts

---

## Post-MVP Revisit: Now View Completion Signal

The Now view currently uses playtime ÷ HLTB as a sorting proxy and progress bar,
explicitly not labeled as "% complete" (HLTB is a population average, not personal).

A better hybrid signal is worth revisiting after MVP:

1. **Manual override** — user sets their own % on a per-game basis (`completion_pct_override` already in DB)
2. **Achievement %** — fetch lazily from Steam where available; a real per-user signal for games that support it
3. **Priority order:** manual override → achievement % → HLTB ratio (soft indicator only)

The architecture already supports this: `completion_pct_override` is on `user_games`,
and `fetchAchievementPct()` exists in `src/server/services/steam.js`. Wiring it up
is a UI + lazy-fetch task, not a data model change.