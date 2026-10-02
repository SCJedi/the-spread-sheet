# SportsPicks

The Spread Sheet: a weekly pick'em site that replaces a shared picks spreadsheet. Made by Infinite Visions AI. It runs on Cloudflare Workers + D1 (free tier) with no build step.

## Layout
- `src/worker.js`: API routes, auth checks, week snapshots, and the cron sync entry point. The schema applies itself on first request (`SCHEMA`).
- `src/scoring.js`: pure scoring rules (wins, locks, tiebreak). All rule changes go here, with a test.
- `src/sources.js`: data sources (`espn` | `custom` feed URL with a Bearer key | `manual`), feed validation (`normalizeFeed`) and game upserts. Format for users: `FEED.md`. Id prefixes: ESPN ids are bare, custom feeds use `c-`, manual games use `m-`.
- `src/espn.js`: ESPN scoreboard parsing only. Week ids are `season-seasontype-week` (for example `2026-2-4`).
- `src/auth.js`: PBKDF2 PIN hashes and HMAC session cookies. The secret is generated into `settings` on first use.
- `public/`: vanilla JS single-page app (`app.js`), the browser-only pool calculator (`pool.js`), the theme engine (`theme.js`, OKLCH plus WCAG contrast fitting) and the team color data (`teams.js`, generated from ESPN's teams feed), with hash routes `#/`, `#/picks`, `#/admin`, `#/login`.
- `reference/` (local only, gitignored): an example of the spreadsheet this replaced. It never ships.
- `public/brand.js`: product name, maker credit, call-to-action links and UTM tagging. Every credit in the app reads from it.

## Legal boundary (giveaway-safe)
- No team logos, league or ESPN artwork, or team names in themes. Themes are our own names plus a colors label plus a city (`public/teams.js`). Teams in games render as `teamBadge` (code on team colors).
- Team names and codes are used only to identify games. The footer disclaimer, `NOTICE.md` and the README disclaimer stay in sync.
- The font is bundled (`public/fonts/`, OFL). Icons are original. Nothing loads from third-party hosts at runtime except the configured score feed.

## Product boundary
The site is a picks communication tool. It stores no money, payments, balances or pool data. Pools are modelled only in the viewer's browser by `public/pool.js` (tested in `test/pool.test.js`), and they're shared through URL links. The single exception is the `calc_preset` setting: the commissioner's suggested calculator settings, normalized by the same `normalizePool`.

## Rules that must hold
- Every write that changes a week goes through `writeWeek(db, wid, stmts)`, or passes `snapshotStmt` to `saveWeek`. The snapshot row is what every page load reads, so a write that bypasses it leaves the board stale.
- Locks and team validity are enforced server-side in `savePicks`. Only `/admin/picks` may pass `override`.
- Other players' picks are hidden in `weekView` until that game locks. The client never receives them.
- Every color the UI shows comes from `buildTheme`. `test/theme.test.js` requires 4.5:1 contrast for text and 3:1 for UI parts in every theme and mode, and requires that each team's hue is kept. A new color token needs a row in that test.
- Board: `board()` renders `standingsView` (default) or `gamesView`, chosen in `sp_board_view`. Rank, W, TB, $ and In stay visible at every width. Never bring back a horizontally scrolling table. Every pick state comes from `pickState()` and has its own glyph or strike-through.
- Styles use the `--fs-*` type scale and `--sp-*` spacing tokens in `style.css`. Check new class names against existing global selectors (`.bar`, `.empty` and `.card` are taken).
- Mobile: tap targets are at least 44px, inputs at least 16px, and the bottom nav sits under 720px wide. Win/loss colors stay fixed across themes, and losses are also struck through.

## Build, test, run
- `npm test`: scoring, pool-calculator and theme-contrast unit tests (node:test).
- `npm run dev`: local server on :8787 with local D1. `--test-scheduled` exposes `/__scheduled` for the cron.
- End-to-end: start the dev server, then run an API script (signup, join code, lock rejection, privacy, calc_preset, no money fields, override, lockout, CSV). The last one used is in the session scratchpad. Rewrite it if needed; it is about 60 lines.
- Deploy: `npx wrangler d1 create sportspicks`, paste the id into `wrangler.toml`, then `npx wrangler deploy`.
