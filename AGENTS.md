# AGENTS.md: The Spread Sheet

Guide for AI coding agents and developers. Read this before changing code. `CLAUDE.md` holds the same rules in short form; if the two ever disagree, the code and its tests are the truth, and both documents get fixed.

Built by Infinite Visions AI. Custom builds: [Schedule a 20-min discovery call](https://www.infinitevisionsaiagents.com/schedule.html?utm_source=the-spread-sheet&utm_medium=agents&utm_campaign=giveaway).

## What this is

A weekly straight-up pick'em site that replaces a shared picks spreadsheet. Anyone can view the board; players log in with a name and a 4-8 digit PIN and edit only their own picks; picks lock at kickoff; scores, winners and the tiebreak are computed automatically. It stores no money, payments, balances or pool data.

Stack: one Cloudflare Worker (`src/worker.js`) plus a D1 (SQLite) database bound as `DB`, and static files in `public/` served through the `[assets]` binding (`env.ASSETS`). Plain ES modules, no build step, no runtime dependencies. The only dev dependency is `wrangler`.

## Architecture map

| File | Responsibility |
|---|---|
| `src/worker.js` | Entry point. `fetch` routes `/api/*` to `api()` and everything else to `env.ASSETS`. `scheduled` runs the cron sync. Holds `SCHEMA` (applied by `ensureSchema` on first request), `DEFAULTS` (settings), sessions (`currentPlayer`, `sessionCookie`), sync (`syncCurrent`, `syncIfStale`), snapshots (`SNAPSHOT_SQL`, `snapshotStmt`, `writeWeek`, `dropSnapshots`, `loadWeek`), the privacy filter (`weekView`), pick writes (`savePicks`), the audit log (`audit`) and commissioner recovery (`recoveryPin`). |
| `src/scoring.js` | Pure rules, no I/O: `gameWinner`, `isFinal`, `isLocked`, `tiebreakGame`, `tiebreakActual`, `scoreWeek`. Every rule change goes here, with a test in `test/scoring.test.js`. |
| `src/sources.js` | Data sources. `SOURCES = ['espn', 'custom', 'manual']`, `fetchWeekFrom` (one week from the configured source), `normalizeFeed` (validates a custom feed, throws `FeedError` with a commissioner-readable message), `feedUrlOk`, `fillUrl` (`{season}` `{week}` `{type}` placeholders), `winnerFrom`, `saveWeek` (upserts a week and its games, plus an `after` hook), `upsertGame`. |
| `src/espn.js` | ESPN scoreboard parsing only: `ESPN_FEED`, `parseEspn`, `isEspnShape`, `espnUrl`, `weekId`, `weekLabel`. |
| `src/auth.js` | `hashPin` / `verifyPin` (PBKDF2), `signSession` / `readSession` (HMAC cookies), `randomToken`. The HMAC secret is generated into `settings.session_secret` on first use. |
| `public/index.html` | Shell. Paints the cached theme (`sp_theme_vars`) before any script loads, then loads `app.js`. |
| `public/app.js` | Vanilla JS single-page app. Hash routes `#/`, `#/picks`, `#/admin`, `#/login`, `#/account`, `#/about`. Board: `board()` renders `standingsView` (default) or `gamesView`, choice stored in `sp_board_view`. Pick glyphs come from `pickState()`. Admin tabs: This week, Players, Enter picks, Data source, Change log, Settings. Footer credit: `makerCredit()`, `disclaimer()`. |
| `public/theme.js` | Theme engine: OKLCH color math plus WCAG contrast fitting (`contrast`, `fitContrast`, `toOklch`, `oklch`, `mix`). `buildTheme(themeId, mode)` returns every CSS variable the UI uses. `THEMES` = `DEFAULT_THEME` (Neon Kickoff) + `IV_THEME` (Infinite Blue) + one per entry in `TEAMS` (34 total). `teamBadge`, `teamEdge`, `applyTheme`, `loadChoice` / `saveChoice` (`sp_theme`). |
| `public/teams.js` | `TEAMS`: 32 entries of `abbr`, `name`, `short`, `city`, our own `theme` name, a `colors` label, `color`, `alt`. Names identify games only; they never appear in themes. |
| `public/pool.js` | Browser-only pool calculator: `normalizePool`, `calcPool`, `encodePool` / `decodePool` (share links), `DEFAULT_POOL`, `PAYOUT_PRESETS`. The worker imports only `normalizePool` (for `calc_preset`). |
| `public/brand.js` | `BRAND` (product name, tagline, maker, CTA, repo, maker colors) and `brandLink(url, spot)`, which adds `utm_source=the-spread-sheet&utm_medium=app&utm_campaign=giveaway&utm_content=<spot>`. Every in-app credit reads from here. |
| `public/style.css` | Styles. `--fs-*` type scale and `--sp-*` spacing tokens; colors come only from `buildTheme` variables. |
| `public/fonts/` | Bundled Barlow Condensed (OFL, `OFL.txt`). Nothing loads from third-party hosts at runtime except the configured score feed. |
| `public/setup-guide.html` | Picture-by-picture setup guide served at `/setup-guide.html`. Steps come from `docs/GUIDE-FACTS.md`. |
| `docs/GUIDE-FACTS.md` | Single source for every user-facing guide: steps, names, links, recovery, troubleshooting, disclaimer. |
| `test/*.test.js` | `node:test` suites: `scoring`, `pool`, `theme`, `sources`. |
| `wrangler.toml` | Worker `the-spread-sheet`, `main = "src/worker.js"`, assets from `./public`, D1 binding `DB` (database `the-spread-sheet`), cron `*/10 * * * *`. |

## Data model

Tables (all created by `SCHEMA` in `src/worker.js`, `CREATE TABLE IF NOT EXISTS`, so deploys need no migration step):

| Table | Key | Notes |
|---|---|---|
| `settings` | `key` | `league_name`, `hide_picks` (`'1'`/`'0'`), `join_code`, `current_week`, `last_sync`, `calc_preset`, `default_theme`, `source`, `feed_url`, `feed_key`, `session_secret`. Defaults in `DEFAULTS`. `feed_key` never leaves the server (the admin API returns only `has_key` and a last-4 `key_hint`). |
| `players` | `id` INTEGER | `name`, `name_key` (lower-cased, unique), `sponsor` (the "with" label), `pin_hash`, `is_admin`, `active`, `failed`, `locked_until`, `session_ver` (bumped to invalidate cookies). |
| `weeks` | `id` TEXT | `season-seasontype-week`, for example `2026-2-4` (`weekId`). `label`, `message`, `tiebreak_game`, `synced_at`. |
| `games` | `id` TEXT | `week_id`, `kickoff` (ms), `home`/`away` codes, names, colors, scores, `state` (`pre`/`in`/`post`), `detail`, `winner` (from the feed), `manual_winner` (commissioner override, wins over `winner` in `gameWinner`). |
| `picks` | (`player_id`, `game_id`) | `week_id`, `team`, `updated_at`. |
| `tiebreakers` | (`player_id`, `week_id`) | `total` (0-200). |
| `snapshots` | `week_id` | `data`: one JSON row holding the whole week (week, games, picks, tiebreakers, players who entered). |
| `audit` | `id` | The change log: `at`, `actor_id`, `player_id`, `week_id`, `action`, `detail`. |

Game id prefixes:
- ESPN ids are bare (`401...`).
- Custom feed ids are prefixed `c-` by `normalizeFeed` (feed id `g1` becomes `c-g1`).
- Manual games are `m-<random>`, created in `/admin/manual/game`. Only `m-` games can be deleted (`/admin/manual/game-delete`), and the stale-week resync in `syncCurrent` skips them (`g.id NOT LIKE 'm-%'`).

### The snapshot row, and why every week write goes through it

Every page load needs a whole week. D1's free tier counts rows read, so each week is kept as one precomputed JSON row in `snapshots`, built by the single statement `SNAPSHOT_SQL`. `loadWeek` reads only that row (rebuilding it if missing); `weekView` and the CSV export read through `loadWeek`.

The snapshot is placed in the **same D1 batch** as every write, so it is always exactly as fresh as the data. Therefore:

- Every write that changes a week goes through `writeWeek(db, wid, stmts)`, which appends `snapshotStmt(db, wid)` to the batch, **or** through `saveWeek(db, w, [(id) => snapshotStmt(db, id)])` (the `after` hook) for feed syncs.
- A write that bypasses both leaves the board stale until something else rewrites that week.
- Player renames and "with" label changes touch every week, so `/admin/player` calls `dropSnapshots(db)` and each week rebuilds on its next view.

## Request flow

**Read API and exports.** `GET /api/export` (JSON or `format=csv`) and `GET /api/season?format=csv` go through `weekView()` and `seasonStats()`, so they show exactly what the viewer's board shows. CSV text comes from `src/export.js`, which defuses formula-looking cells; tested in `test/export.test.js`. The public contract is in `API.md`; add fields freely, but bump `api` before changing or removing one. Printed pages are the `#/print?what=board|sheet|tally` route in `printView()`, black on white on every theme.

**Open weeks and season totals.**
- The `open_mode` setting is `current`, `next` (the default) or `season`. `openAhead()` in `src/worker.js` applies it after each sync.
  - `next` opens the following week once every game of the current week has kicked off, and refreshes it every sync.
  - `season` loads the rest of the regular season and refreshes it daily, because kickoff times move and kickoff is what locks picks.
- `/api/state` returns `league.open_week`, the earliest week with an open game, and the Picks page opens there.
- `/api/season?season=YYYY` returns totals only, from `seasonStats()` in `src/scoring.js`: never picks, so nothing hidden before kickoff leaks.
- Each part of the Season tab can be switched off with `season_tab`, `season_weeks_won`, `season_weekly`, `season_best_worst` and `season_streaks`.

1. `fetch(req, env, ctx)`: paths starting `/api/` go to `api()`; everything else is `env.ASSETS.fetch(req)`. Uncaught errors become a 500 JSON error.
2. `api()`: `ensureSchema(db)` → `getSettings(db)` → `currentPlayer(req, db)` (reads the `sp_session` cookie, checks `active` and `session_ver`). POSTs must be `application/json` (else 415).
3. Public routes: `GET /api/state` (calls `syncIfStale`, then returns league settings, `me`, the week list, `weekView` for the requested or current week, and last week's winners), `POST /api/signup` (first player becomes commissioner and a join code is generated; later players need the join code), `POST /api/login`, `POST /api/logout`.
4. Logged-in routes: `POST /api/picks` (own picks via `savePicks`), `POST /api/pin` (change own PIN).
5. Commissioner routes (`is_admin`): `GET /api/admin`, `POST /api/admin/settings`, `/admin/week` (message, tiebreak game), `/admin/picks` (enter picks for someone, `override: true`), `/admin/player`, `/admin/add-player`, `/admin/game` (manual winner), `/admin/sync` (current week, or a specific week for "Load next week early"), `/admin/source/test`, `/admin/source`, `/admin/manual/week`, `/admin/manual/game`, `/admin/manual/game-delete`, `GET /api/admin/export.csv`.
6. Sync: `scheduled` runs `syncCurrent` every 10 minutes unless the source is `manual`. `syncIfStale` also syncs on a `/api/state` view when `last_sync` is older than 5 minutes (`SYNC_EVERY_MS`); it claims `last_sync` first so concurrent requests don't all fetch, and only blocks the response on the very first run. `syncCurrent` also re-fetches earlier weeks that still have unfinished, non-manual games (late games after the feed rolls over).
7. Login lockout: five wrong PINs set `locked_until` 15 minutes ahead.

## Invariants that must never break

1. **Kickoff locks are server-side.** `savePicks` rejects changes to a game where `isLocked(g, now)` is true (kickoff passed, or the feed says the game started), and rejects a tiebreak change once the tiebreak game locks. It also rejects teams not in the game. Only `/admin/picks` may pass `override`.
2. **Hidden picks never reach the client.** With `hide_picks` on, `weekView` replaces other players' picks and tiebreak totals with `{ hidden: true }` until that game (or the tiebreak game) locks. Never send the raw picks and hide them in the browser.
3. **No money or pool data on the server.** The site stores no money, payments, balances or pool data. Pools are modelled only in the viewer's browser by `public/pool.js` (tested in `test/pool.test.js`) and shared through URL links. The single exception is the `calc_preset` setting (the commissioner's suggested calculator settings), normalized by the same `normalizePool`.
4. **No team logos, league or ESPN artwork, or team names in themes.** Themes are our own name, a colors label and a city (`public/teams.js`). Teams in games render as `teamBadge` (code on team colors). `test/theme.test.js` checks that theme names are unique and never contain the team's nickname (`short`). The footer disclaimer, `NOTICE.md` and the README disclaimer stay in sync.
5. **Theme contrast test.** Every color the UI shows comes from `buildTheme`. `test/theme.test.js` requires 4.5:1 for text and 3:1 for UI parts in every theme and mode, and that each team's hue is kept. A new color token needs a row in that test.
6. **Tap targets of at least 44px**, inputs at least 16px (no iOS zoom), bottom nav under 720px wide. Win/loss colors stay fixed across themes, and losses are also struck through.
7. **Board layout.** `board()` renders `standingsView` or `gamesView`. Rank, W, TB, $ and In stay visible at every width. Never bring back a horizontally scrolling table. Every pick state comes from `pickState()` and has its own glyph or strike-through.
8. **Class-name collisions.** Styles use the `--fs-*` and `--sp-*` tokens in `public/style.css`. Check any new class name against existing global selectors: `.bar`, `.empty` and `.card` are taken.
9. **Snapshot hook.** Every week write goes through `writeWeek` or `saveWeek`'s `after` hook (see Data model).
10. **Brand credit retained.** Keep the footer credit (`makerCredit`) and `public/brand.js` as the single source for credits and CTA links. The MIT copyright line in `LICENSE` must stay.
11. **No third-party runtime loads** except the configured score feed. Fonts and icons are bundled.

## Run, test, deploy

```bash
npm install
npm run dev          # wrangler dev: http://localhost:8787 with a local D1
npm test             # node --test: scoring, pool, theme, sources
```

`npx wrangler dev --test-scheduled` exposes `/__scheduled` so you can fire the cron locally.

**Fresh test servers (Windows):** `powershell -File scripts/fresh-dev.ps1 -Port 8788` starts a dev server on an empty database and refuses to report READY unless the port held the server it just started and the database has no players (`-Config wrangler.demo.toml -Demo` for the demo, `-Vars "RECOVERY_PIN:4321"` for variables, `-Stop` to free a port). Use it for every end-to-end run. A leftover dev server keeps its port and its data, and later tests then fail in misleading ways ("join code is not right", D1 internal errors, weeks that shouldn't exist). The script's readiness checks use `127.0.0.1`, because wrangler listens on IPv4 only.

**End-to-end API check.** With the dev server running, script the API: signup (first player is commissioner), join code required for the second player, lock rejection after kickoff, hidden picks not in `/api/state` for other players, `calc_preset` round-trip, no money fields in any response, `/admin/picks` override, the five-PIN lockout, and the CSV export. No such script is committed; write one (about 60 lines of `fetch` calls).

**Browser checks** (manual, at 375px and at desktop width, light and dark): nothing scrolls sideways except where intended, the bottom nav appears under 720px, every tap target is at least 44px, inputs don't zoom on iPhone, the theme picker applies every theme, and the footer credit shows.

**Deploy.**
- One-click: the "Deploy to Cloudflare" button in `README.md` copies the repo to the user's GitHub and provisions the Worker and D1 database.
- CLI: `npx wrangler login`, `npx wrangler d1 create the-spread-sheet`, paste the printed `database_id` into `wrangler.toml` (the committed value is a zero placeholder), then `npx wrangler deploy`.

## Extending

**Add a data source.** Add its id to `SOURCES` in `src/sources.js` and a branch in `fetchWeekFrom` that returns the same week shape `normalizeFeed` returns: `{ season, type, week, id: weekId(...), label, games: [{ id, kickoff, home, away, home_name, away_name, home_color, away_color, home_score, away_score, state, detail, winner }] }`. Give its game ids a unique prefix so they can't collide with ESPN (bare), `c-` or `m-`. Add it to the Data source tab in `public/app.js` (`adminSource`) and to `SOURCE_LABEL` for the footer. Add tests to `test/sources.test.js`. Often you don't need a new source at all: a small proxy that emits the custom feed JSON works with `custom`.

**Add a theme.** Non-team themes go next to `DEFAULT_THEME` / `IV_THEME` in `public/theme.js` and into `THEMES`: `{ abbr, theme, colors, city, color, alt }` (optional `spark` for a third accent). Use an original name, never a team name. Run `npm test`: the contrast, hue and distinctness tests cover it automatically. Note that `/admin/settings` accepts `default_theme` only if it matches `/^[A-Z]{2,3}$/`.

**Add a sport.** No code change is needed for a different league: use **Manual** (commissioner types weeks and games; team codes are 1-5 letters or digits) or a **custom feed** in the FEED.md format. Unknown team codes get a neutral badge, or the feed can send `home_color` / `away_color`. Tiebreak totals are capped at 0-200 in `savePicks`; week numbers at 1-30.

**Change a rule.** Edit `src/scoring.js` only, and add or update a test in `test/scoring.test.js`. The front end and CSV read the results of `scoreWeek`; don't re-implement rules in `public/app.js`.

## Custom feed JSON

Full format, URL placeholders and API-key behavior: [FEED.md](FEED.md). Validation lives in `normalizeFeed` (max 40 games; `season` 1900-3000; `week` 1-30; `type` 1/2/3; unique ids; 1-5 character codes; `kickoff` ISO string or ms; `winner` must be home, away or `TIE`). ESPN-shaped JSON is also accepted from a custom URL. The API key is sent as `Authorization: Bearer <key>`. URLs must be `https://` (plain `http://` is allowed only for `localhost` / `127.0.0.1`).

Minimal example:

```json
{
  "season": 2026,
  "week": 5,
  "games": [
    { "id": "g1", "kickoff": "2026-10-11T17:00:00Z", "away": "NE", "home": "BUF", "state": "pre" }
  ]
}
```

## Commissioner recovery: `RECOVERY_PIN`

If the commissioner forgets their PIN, the Cloudflare account owner sets a Worker variable `RECOVERY_PIN` (4-8 digits). `recoveryPin(env)` in `src/worker.js` reads it. In `/api/login`, a commissioner (`is_admin`) who logs in with that value has it hashed in as their new PIN, `failed`/`locked_until` cleared and `session_ver` bumped; the event is written to `audit` as `pin_recovery`, and this check runs before the lockout check. While the variable is set, `/api/state` returns `recovery_pin_set: true` to commissioners and `public/app.js` shows a banner telling them to delete it. User-facing steps: `docs/GUIDE-FACTS.md` and `README.md`.

---

Built by Infinite Visions AI, custom builds: <https://www.infinitevisionsaiagents.com/schedule.html?utm_source=the-spread-sheet&utm_medium=agents&utm_campaign=giveaway>
