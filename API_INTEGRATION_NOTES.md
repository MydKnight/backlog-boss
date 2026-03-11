# Backlog Boss — API Integration Notes

## Steam API

**Base URL:** `https://api.steampowered.com`
**Auth:** API key (per user, stored in `users.steam_api_key`)
**Rate limit:** 100,000 requests/day — not a practical concern for this use case

### Endpoints Used

#### Get owned games
```
GET /IPlayerService/GetOwnedGames/v1/
  ?key={api_key}
  &steamid={steam_id}
  &include_appinfo=true
  &include_played_free_games=true
  &format=json
```
Returns: `appid`, `name`, `playtime_forever` (minutes), `rtime_last_played` (unix timestamp), `img_icon_url`

#### Get achievement completion %
```
GET /ISteamUserStats/GetPlayerAchievements/v1/
  ?key={api_key}
  &steamid={steam_id}
  &appid={app_id}
```
Returns per-achievement unlock status. Compute % in application layer.
**Note:** This is one request per game. For 500+ games, fetch lazily (on game open) not in bulk sync.

### Sync Strategy
- Full library pull on every sync (owned games list + playtime)
- Achievement % fetched lazily per game, cached on `user_games.achievement_pct`
- `playtime_source` set to `steam` for all Steam-synced records
- Last-write-wins: Steam playtime overwrites manual entry unless `playtime_source = 'manual'`

### Failure Handling
- Wrap in retry with exponential backoff (3 attempts)
- Log failures to `sync_log`
- Partial success is acceptable — update what succeeded, log what failed

---

## IGDB

**Base URL:** `https://api.igdb.com/v4`
**Auth:** Twitch OAuth2 client credentials (`client_id` + `client_secret` → bearer token)
**Token lifetime:** ~60 days. Cache token, refresh when expired.
**Rate limit:** 4 requests/second. Use request queue for bulk operations.

### Token Request
```
POST https://id.twitch.tv/oauth2/token
  ?client_id={client_id}
  &client_secret={client_secret}
  &grant_type=client_credentials
```

### Endpoints Used

#### Search games by name (for History/search UI)
```
POST /games
Body: fields id,name,cover.url,genres.name,themes.name,similar_games,first_release_date,platforms.name;
      search "{query}";
      limit 10;
```

#### Look up by Steam App ID
```
POST /games
Body: fields id,name,cover.url,genres.name,themes.name,similar_games;
      where external_games.uid = "{steam_app_id}" & external_games.category = 1;
```
Category 1 = Steam in IGDB's external game category enum.

#### Bulk enrich by IGDB IDs
```
POST /games
Body: fields id,name,cover.url,genres.name,themes.name,similar_games;
      where id = ({id1},{id2},{id3});
      limit 50;
```
Use for initial library enrichment — batch in groups of 50 to respect rate limits.

### Enrichment Strategy
- On first Steam sync: match each Steam app ID to IGDB record, create `games` row
- Unmatched games (IGDB has no Steam entry): log, surface in UI for manual match
- Re-enrich stale records (igdb_fetched_at > 90 days) in background

### Failure Handling
- IGDB occasionally returns no match for valid games — store `igdb_id = null`, retry later
- Token expiry: detect 401, refresh token, retry once
- Rate limit (429): back off 1 second, retry

---

## HLTB (Unofficial API)

**Package:** `howlongtobeat` on npm
**Status:** Community-maintained, not officially supported. Breaking changes possible.

### Abstraction Layer
All HLTB access goes through a single service module `src/services/hltb.js`. No direct package calls elsewhere in the codebase. When the package breaks, this is the only file to update.

```javascript
// src/services/hltb.js — interface contract
// These are the only functions the rest of the app calls

async function fetchByTitle(title) {
  // Returns: { hltb_id, main, mainExtras, completionist } or null
}

async function fetchByHltbId(hltbId) {
  // Returns: same shape, direct lookup
}
```

### Lookup Strategy
- Primary: search by game title
- Fuzzy match: HLTB titles sometimes differ from IGDB/Steam titles
- If multiple results: prefer exact title match, then closest string distance
- Cache result on `games` table — don't re-fetch unless `hltb_fetched_at` > 30 days
- If HLTB lookup fails: use `null`, do not block game display. Show "?" for completion %

### Empty Result TTL Handling
- Empty result array = valid "no match" response. Always set `hltb_fetched_at` so the game retries in 30 days, not every sync.
- Throttling manifests as HTTP 403/429 or network errors, which land in `catch` and skip TTL (retries next sync).
- Progressive backoff on consecutive empties (500ms → 1500ms → 3000ms) as a courtesy to the API, but does not affect TTL decision.
- This prevents GOTY/enhanced/special editions that don't fuzzy-match from being retried on every sync indefinitely.

### Manual HLTB ID Override (Future — Phase 5+)
Many special editions, GOTY editions, and enhanced ports have slightly different names on HLTB
(e.g. "Batman: Arkham Asylum GOTY Edition" vs. "Batman: Arkham Asylum"). These will never fuzzy-match correctly.

Planned: per-game UI in settings to manually set `games.hltb_id`. When set:
- Sync skips title-based search for that game
- Calls `fetchByHltbId(hltb_id)` directly (or stores data already looked up manually)
- Field: `games.hltb_id` (already in schema, nullable integer)
- Exposing this: game detail view → "Fix HLTB data" → enter HLTB URL or ID → server resolves and stores

### Failure Handling
- Wrap all calls in try/catch
- Log failures silently — HLTB unavailability should not break the app
- Fallback: `hltb_main_extras = null` → completion % shown as unknown in UI

---

## Ollama (Local LLM)

**Default endpoint:** `http://localhost:11434`
**Model:** `qwen2.5:14b`
**Configurable:** per user in `users.ollama_endpoint` and `users.ollama_model`

### Suggestion Query

```javascript
// POST http://localhost:11434/api/generate
{
  "model": "qwen2.5:14b",
  "prompt": buildTastePrompt(contextPayload),
  "stream": false,
  "format": "json"
}
```

### Prompt Template

```
You are a game recommendation engine. Based on the user's gaming history below, 
rank the candidate games by predicted enjoyment. Return ONLY valid JSON.

USER HISTORY:
- Completed games with ratings and notes: {completed_games}
- Retired games with reasons: {retired_games}

CANDIDATE GAMES TO RANK (from user's unplayed library):
{candidate_games}

Return a JSON array ordered by predicted enjoyment (highest first):
[
  {
    "igdb_id": number,
    "title": string,
    "rank": number,
    "explanation": "1-2 sentence plain language explanation"
  }
]

Return ONLY the JSON array. No preamble, no markdown.
```

### Invocation Strategy
- **Not real-time.** Runs on demand via "Refresh Suggestions" button or when taste profile changes (new completion, new retirement, new history entry)
- Context hash: SHA256 of the input payload. If hash matches last snapshot, skip inference.
- Timeout: 120 seconds (local LLM can be slow on first token)
- Result stored in `taste_snapshots`, displayed in Next view until next refresh

### Failure Handling
- Ollama not running: show last cached snapshot with "Suggestions may be outdated" notice
- Invalid JSON response: retry once with stricter prompt, then fall back to cached snapshot
- Model not found: surface clear error in settings UI with model name

---

## Guide Source Search

Three Tier-1 guide sites are searched in parallel server-side. All use full browser header
fingerprint (same as readability.js). Each search function fails gracefully and returns `[]`
on any error — a blocked or unresponsive site never breaks results from other sites.

### Site Coverage

| Site | What it provides | Search pattern |
|---|---|---|
| StrategyWiki | Wiki walkthroughs, strong retro/classic coverage | MediaWiki `Special:Search` |
| TrueAchievements | Xbox achievement walkthroughs | Search → game page → `/walkthrough` |
| TrueTrophies | PS trophy guides | Search → game page → `/guide` |
| GameFAQs | Not in search — bot protection blocks server-side fetch | Manual paste only |

### Search Endpoint

```
GET /api/guides/search?title={title}
```

Runs all three site searches in parallel (`Promise.allSettled`). Returns:
```json
{
  "results": [
    { "title": "...", "url": "...", "site": "strategywiki", "type": "walkthrough" },
    { "title": "...", "url": "...", "site": "trueachievements", "type": "walkthrough" },
    ...
  ]
}
```

Client groups results by `site` for display. Importing a result calls `POST /api/guides` with
the URL — uses the existing ingest pipeline; may still fail (403 etc.) for individual pages.

### StrategyWiki Selectors
- Search URL: `https://strategywiki.org/wiki/Special:Search?search={q}&fulltext=1`
- Result links: `.mw-search-result-heading a` (MediaWiki standard)
- Filters out `Special:` and `Talk:` namespace links

### TrueAchievements Selectors
- Search URL: `https://www.trueachievements.com/search?searchkey={q}`
- Game links matched by regex: `/^\/game\/[^/]+\/?$/`
- Walkthrough URL: `{gamePath}/walkthrough`

### TrueTrophies Selectors
- Search URL: `https://www.truetrophies.com/search?searchkey={q}`
- Same link pattern as TrueAchievements
- Guide URL: `{gamePath}/guide`

---

## Paste Content Ingestion

Users can paste raw HTML page source (Ctrl+U → Ctrl+A → Ctrl+C) to bypass bot-blocked sites.

### How it works
- `POST /api/guides` accepts either `{ igdbId, url }` (fetch from URL) or
  `{ igdbId, pastedContent, title, sourceUrl? }` (skip fetch, process locally)
- `sourceUrl` optional: used as the Readability base URL for resolving relative image paths,
  and stored as `source_url` so the "open in browser" link still works
- Auto-detection: if `pastedContent` matches HTML tag patterns → Readability parse → `content_type: html`;
  otherwise → stored as-is → `content_type: text`
- Same Readability pipeline as URL fetch; same storage path

### Images in pasted content
Images rendered from pasted HTML reference the original site's CDN. They display while online
but fail offline. Downloading and embedding images (base64 inline) is a post-MVP feature.

---

## Mozilla Readability (Guide Ingestion)

**Package:** `@mozilla/readability` + `jsdom` for server-side parsing

### Ingestion Flow
```javascript
// 1. Fetch URL content server-side (avoids CORS)
const html = await fetch(url).then(r => r.text());

// 2. Parse with jsdom + Readability
const dom = new JSDOM(html, { url });
const reader = new Readability(dom.window.document);
const article = reader.parse();
// article.content = cleaned HTML
// article.title = page title
// article.textContent = plain text fallback

// 3. Store cleaned content in guides table
```

### Special Cases
- **GameFAQs plain text FAQs:** Readability may strip too much. Detect `text/plain` content type and store raw text directly.
- **Content behind JS rendering:** Readability operates on static HTML only. If a page requires JS to render (some IGN pages), content may be partial. Surface a warning to the user.
- **Very long guides:** No practical size limit — store full content. SQLite handles multi-MB text fields fine.

### Failure Handling
- Fetch fails (404, timeout): surface error to user, do not create guide record
- Readability returns null (can't parse): fall back to storing raw HTML with a warning
- All guide content is stored locally after first fetch — subsequent reads are offline

---

## Environment Variables

```env
# Steam
STEAM_API_KEY=                    # Can be overridden per-user in DB

# IGDB / Twitch
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=

# Ollama
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b

# App
DATABASE_PATH=./data/backlog.db
PORT=3000
NODE_ENV=production

# Optional: Turso (if migrating SQLite to cloud later)
# TURSO_DATABASE_URL=
# TURSO_AUTH_TOKEN=
```

---

## Docker Compose (QNAP NAS)

```yaml
version: '3.8'
services:
  backlog-boss:
    image: backlog-boss:latest
    container_name: backlog-boss
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /share/Container/backlog-boss/data:/app/data
      - /share/Container/backlog-boss/.env:/app/.env
    environment:
      - NODE_ENV=production
    # Ollama assumed running on NAS host or separate container
    # OLLAMA_ENDPOINT should point to host IP, not localhost, from inside container
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

**Note on Ollama endpoint from Docker:** Use `http://host.docker.internal:11434` as `OLLAMA_ENDPOINT` when running in Docker, not `localhost`.