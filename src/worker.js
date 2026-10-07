import { hashPin, verifyPin, signSession, readSession, randomToken } from './auth.js';
import { fetchWeekFrom, saveWeek, upsertGame, winnerFrom, feedUrlOk, FeedError, SOURCES } from './sources.js';
import { weekId, weekLabel } from './espn.js';
import { TEAMS } from '../public/teams.js';
import { isDemo, seedDemo, DEMO_RESET_MS, DEMO_BLOCKED, DEMO_PLAYER, DEMO_COMMISH } from './demo.js';
import { scoreWeek, isLocked, tiebreakGame, seasonStats } from './scoring.js';
import { normalizePool } from '../public/pool.js';

// Schema applies itself on first request, so deploying needs no migration step.
// One statement per string: D1 batches prepared statements, not scripts.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, sponsor TEXT DEFAULT '', pin_hash TEXT NOT NULL, is_admin INTEGER DEFAULT 0, active INTEGER DEFAULT 1, failed INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0, session_ver INTEGER DEFAULT 1, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS weeks (id TEXT PRIMARY KEY, season INTEGER, season_type INTEGER, week INTEGER, label TEXT, message TEXT DEFAULT '', tiebreak_game TEXT, synced_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, week_id TEXT NOT NULL, kickoff INTEGER, home TEXT, home_name TEXT, home_color TEXT, away TEXT, away_name TEXT, away_color TEXT, home_score INTEGER, away_score INTEGER, state TEXT, detail TEXT, winner TEXT, manual_winner TEXT)`,
  `CREATE INDEX IF NOT EXISTS games_week ON games(week_id)`,
  `CREATE TABLE IF NOT EXISTS picks (player_id INTEGER NOT NULL, game_id TEXT NOT NULL, week_id TEXT NOT NULL, team TEXT NOT NULL, updated_at INTEGER, PRIMARY KEY (player_id, game_id))`,
  `CREATE INDEX IF NOT EXISTS picks_week ON picks(week_id)`,
  `CREATE TABLE IF NOT EXISTS tiebreakers (player_id INTEGER NOT NULL, week_id TEXT NOT NULL, total INTEGER NOT NULL, updated_at INTEGER, PRIMARY KEY (player_id, week_id))`,
  `CREATE TABLE IF NOT EXISTS snapshots (week_id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at INTEGER, actor_id INTEGER, player_id INTEGER, week_id TEXT, action TEXT, detail TEXT)`,
];

// The app stores picks, games and messages only. Pools are modelled in the browser (public/pool.js);
// calc_preset is just the commissioner's suggested calculator settings, never money or payment data.
const DEFAULTS = { league_name: 'The Spread Sheet', hide_picks: '1', join_code: '', current_week: '', last_sync: '0', calc_preset: '', default_theme: '',
  // Data source: 'espn' | 'custom' | 'manual'. feed_key is a secret and never leaves the server.
  source: 'espn', feed_url: '', feed_key: '',
  // Which weeks are open for picks: 'current' | 'next' (next week opens once this week's last game kicks off) | 'season'.
  open_mode: 'next', season_sync: '0',
  // Season tab and its parts, each switchable by the commissioner.
  season_tab: '1', season_weeks_won: '1', season_weekly: '1', season_best_worst: '1', season_streaks: '1' };
const OPEN_MODES = ['current', 'next', 'season'];
const SEASON_KEYS = ['season_tab', 'season_weeks_won', 'season_weekly', 'season_best_worst', 'season_streaks'];
const REGULAR_WEEKS = 18;
const DAY_MS = 24 * 60 * 60 * 1000;

// The week after (season, type, week): preseason runs into the regular season, which runs into the playoffs.
function nextWeekOf(season, type, week) {
  if (type === 1) return week < 4 ? { season, type: 1, week: week + 1 } : { season, type: 2, week: 1 };
  if (type === 2) return week < REGULAR_WEEKS ? { season, type: 2, week: week + 1 } : { season, type: 3, week: 1 };
  return week < 5 ? { season, type: 3, week: week + 1 } : null;
}

// Opens upcoming weeks according to open_mode, and keeps their kickoff times fresh (kickoff is what locks picks).
async function openAhead(db, settings, w) {
  const mode = OPEN_MODES.includes(settings.open_mode) ? settings.open_mode : 'next';
  if (mode === 'current' || !w.games.length) return;
  const save = (opts) => fetchWeekFrom(settings, opts).then((x) => (x.games.length ? saveWeek(db, x, [(id) => snapshotStmt(db, id)]) : null)).catch((e) => console.log('open ahead', opts, e.message));
  const next = nextWeekOf(w.season, w.type, w.week);
  if (!next) return;
  const allKicked = Math.max(...w.games.map((g) => g.kickoff)) <= Date.now();
  const haveNext = await one(db, 'SELECT 1 AS x FROM weeks WHERE id = ?1', weekId(next.season, next.type, next.week));
  if (mode === 'season' || allKicked || haveNext) await save(next); // once open, refreshed on every sync
  if (mode === 'season' && w.type === 2 && Date.now() - Number(settings.season_sync || 0) > DAY_MS) {
    await setSetting(db, 'season_sync', Date.now());
    for (let wk = next.week + 1; wk <= REGULAR_WEEKS; wk++) await save({ season: w.season, type: 2, week: wk });
  }
}
const SESSION_DAYS = 60;
const SYNC_EVERY_MS = 5 * 60 * 1000;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

// ---------- small helpers ----------
const recoveryPin = (env) => (env && /^\d{4,8}$/.test(String(env.RECOVERY_PIN || '')) ? String(env.RECOVERY_PIN) : null);
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const fail = (msg, status = 400) => json({ error: msg }, status);
const nameKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 40);
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();

async function getSettings(db) {
  const rows = await all(db, 'SELECT key, value FROM settings');
  const s = { ...DEFAULTS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}
const setSetting = (db, k, v) => run(db, 'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));

async function sessionSecret(db) {
  const row = await one(db, "SELECT value FROM settings WHERE key = 'session_secret'");
  if (row) return row.value;
  const secret = randomToken(32);
  await run(db, "INSERT OR IGNORE INTO settings (key, value) VALUES ('session_secret', ?1)", secret);
  return (await one(db, "SELECT value FROM settings WHERE key = 'session_secret'")).value;
}

function cookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function currentPlayer(req, db) {
  const s = await readSession(await sessionSecret(db), cookie(req, 'sp_session'));
  if (!s) return null;
  const p = await one(db, 'SELECT id, name, sponsor, is_admin, active, session_ver FROM players WHERE id = ?1', s.id);
  return p && p.active && p.session_ver === s.v ? p : null;
}

async function sessionCookie(db, p) {
  const token = await signSession(await sessionSecret(db), { id: p.id, v: p.session_ver, exp: Date.now() + SESSION_DAYS * 864e5 });
  return `sp_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

const audit = (db, actorId, playerId, weekIdV, action, detail) =>
  run(db, 'INSERT INTO audit (at, actor_id, player_id, week_id, action, detail) VALUES (?1,?2,?3,?4,?5,?6)',
    Date.now(), actorId, playerId, weekIdV, action, typeof detail === 'string' ? detail : JSON.stringify(detail));

// ---------- sync ----------
async function syncCurrent(db, settings) {
  if (settings.source === 'manual') return settings.current_week; // nothing to fetch; the commissioner enters games
  const w = await fetchWeekFrom(settings);
  await saveWeek(db, w, [(id) => snapshotStmt(db, id)]);
  await setSetting(db, 'current_week', w.id);
  await setSetting(db, 'last_sync', Date.now());
  // Finish any earlier week that still has games in flight (MNF can end after the feed rolls over).
  const stale = await all(db, `SELECT DISTINCT w.season, w.season_type, w.week FROM games g JOIN weeks w ON w.id = g.week_id
    WHERE g.state != 'post' AND g.manual_winner IS NULL AND g.kickoff < ?1 AND g.week_id != ?2 AND g.id NOT LIKE 'm-%'`, Date.now(), w.id);
  for (const s of stale) await saveWeek(db, await fetchWeekFrom(settings, { season: s.season, type: s.season_type, week: s.week }), [(id) => snapshotStmt(db, id)]);
  await openAhead(db, settings, w);
  return w.id;
}

async function syncIfStale(db, settings, ctx) {
  if (settings.source === 'manual') return;
  if (Date.now() - Number(settings.last_sync) < SYNC_EVERY_MS) return;
  await setSetting(db, 'last_sync', Date.now()); // claim it so concurrent requests do not all fetch
  const p = syncCurrent(db, settings).catch((e) => console.log('sync failed', e.message));
  if (settings.current_week) ctx.waitUntil(p); else await p; // first run waits so there is something to show
}

// ---------- week snapshots ----------
// Every page load needs a whole week (about 1,000 rows at 60 players). D1's free tier counts rows read,
// so each week is kept as one precomputed JSON row. The snapshot is built by a single SQL statement
// placed in the same batch as every write, so it is always exactly as fresh as the data.
const SNAPSHOT_SQL = `INSERT OR REPLACE INTO snapshots (week_id, data) SELECT ?1, json_object(
  'week', json((SELECT json_object('id', id, 'label', label, 'season', season, 'message', message, 'tiebreak_game', tiebreak_game) FROM weeks WHERE id = ?1)),
  'games', json((SELECT json_group_array(json_object('id', id, 'kickoff', kickoff, 'home', home, 'home_name', home_name, 'home_color', home_color, 'away', away, 'away_name', away_name, 'away_color', away_color, 'home_score', home_score, 'away_score', away_score, 'state', state, 'detail', detail, 'winner', winner, 'manual_winner', manual_winner)) FROM games WHERE week_id = ?1)),
  'picks', json((SELECT json_group_array(json_array(player_id, game_id, team)) FROM picks WHERE week_id = ?1)),
  'tbs', json((SELECT json_group_array(json_array(player_id, total)) FROM tiebreakers WHERE week_id = ?1)),
  'players', json((SELECT json_group_array(json_array(id, name, sponsor)) FROM players WHERE id IN (SELECT player_id FROM picks WHERE week_id = ?1 UNION SELECT player_id FROM tiebreakers WHERE week_id = ?1)))
) WHERE EXISTS (SELECT 1 FROM weeks WHERE id = ?1)`;
const snapshotStmt = (db, wid) => db.prepare(SNAPSHOT_SQL).bind(wid);
// Runs writes and the snapshot refresh as one transaction.
const writeWeek = (db, wid, stmts) => db.batch([...stmts, snapshotStmt(db, wid)]);
// Player renames touch every week; dropping snapshots makes each rebuild on next view.
const dropSnapshots = (db) => run(db, 'DELETE FROM snapshots');

async function loadWeek(db, wid) {
  let row = await one(db, 'SELECT data FROM snapshots WHERE week_id = ?1', wid);
  if (!row) { await snapshotStmt(db, wid).run(); row = await one(db, 'SELECT data FROM snapshots WHERE week_id = ?1', wid); }
  if (!row) return null;
  const d = JSON.parse(row.data);
  return {
    week: d.week,
    games: d.games.sort((a, b) => a.kickoff - b.kickoff || (a.id < b.id ? -1 : 1)),
    picks: d.picks.map(([player_id, game_id, team]) => ({ player_id, game_id, team })),
    tbs: d.tbs.map(([player_id, total]) => ({ player_id, total })),
    players: d.players.map(([id, name, sponsor]) => ({ id, name, sponsor })),
  };
}

// ---------- demo ----------
// Loads the previous week too (so a finished week with a winner shows), then seeds made-up players and picks.
async function maybeSeedDemo(db, env) {
  if (!isDemo(env)) return;
  const s = await getSettings(db);
  const fresh = Date.now() - Number(s.demo_reset || 0) < DEMO_RESET_MS && (await one(db, 'SELECT 1 AS x FROM players LIMIT 1'));
  if (fresh) return;
  await setSetting(db, 'demo_reset', Date.now()); // claim it so concurrent requests do not all reseed
  if (!s.current_week) await syncCurrent(db, s);
  const s2 = await getSettings(db);
  const weeks = await all(db, 'SELECT id FROM weeks');
  if (weeks.length < 2 && s2.current_week) {
    const [season, type, week] = s2.current_week.split('-').map(Number);
    if (week > 1) await saveWeek(db, await fetchWeekFrom(s2, { season, type, week: week - 1 }), [(id) => snapshotStmt(db, id)]).catch((e) => console.log('demo prev week', e.message));
  }
  await seedDemo(db, { writeWeekStmts: (wid) => [snapshotStmt(db, wid)] });
}

// ---------- week view ----------
async function weekView(db, settings, wid, me) {
  const raw = await loadWeek(db, wid);
  if (!raw) return null;
  const { week, games, picks, tbs, players } = raw;
  const now = Date.now();
  const score = scoreWeek({ games, entrants: players, picks, tiebreakers: tbs, tiebreakGameId: week.tiebreak_game });
  const tbGame = tiebreakGame(games, week.tiebreak_game);
  const hide = settings.hide_picks === '1';
  const lockedIds = new Set(games.filter((g) => isLocked(g, now)).map((g) => g.id));
  const tbLocked = tbGame ? lockedIds.has(tbGame.id) : true;
  const mine = (pid) => me && me.id === pid;
  return {
    week: { id: week.id, label: week.label, season: week.season, message: week.message, tiebreak_game: tbGame ? tbGame.id : null },
    games: games.map((g) => ({ ...g, locked: lockedIds.has(g.id) })),
    players,
    // Before kickoff, other people's picks show only as "picked" so nobody can copy.
    picks: picks.map((p) => (!hide || lockedIds.has(p.game_id) || mine(p.player_id) ? p : { player_id: p.player_id, game_id: p.game_id, hidden: true })),
    tiebreakers: tbs.map((t) => (!hide || tbLocked || mine(t.player_id) ? t : { player_id: t.player_id, hidden: true })),
    standings: score,
  };
}

async function lastWinners(db, weeks, wid) {
  const prev = weeks[weeks.findIndex((w) => w.id === wid) - 1];
  if (!prev) return null;
  const v = await weekView(db, { hide_picks: '0' }, prev.id, null);
  if (!v || !v.standings.final || !v.standings.winners.length) return null;
  const names = v.standings.winners.map((id) => v.players.find((p) => p.id === id)?.name).filter(Boolean);
  return { week: v.week.label, names };
}

// ---------- saving picks ----------
async function savePicks(db, { actor, playerId, wid, picks = {}, tiebreak, override = false }) {
  const games = await all(db, 'SELECT * FROM games WHERE week_id = ?1', wid);
  const week = await one(db, 'SELECT * FROM weeks WHERE id = ?1', wid);
  if (!week) return { error: 'Unknown week' };
  const now = Date.now();
  const byId = new Map(games.map((g) => [g.id, g]));
  const existing = new Map((await all(db, 'SELECT game_id, team FROM picks WHERE player_id = ?1 AND week_id = ?2', playerId, wid)).map((p) => [p.game_id, p.team]));
  const stmts = [], changed = [], rejected = [];
  for (const [gid, team] of Object.entries(picks)) {
    const g = byId.get(gid);
    if (!g) { rejected.push({ game_id: gid, reason: 'not in this week' }); continue; }
    if ((existing.get(gid) || '') === (team || '')) continue;
    if (!override && isLocked(g, now)) { rejected.push({ game_id: gid, reason: 'locked' }); continue; }
    if (team && team !== g.home && team !== g.away) { rejected.push({ game_id: gid, reason: 'not a team in this game' }); continue; }
    if (team) stmts.push(db.prepare('INSERT INTO picks (player_id, game_id, week_id, team, updated_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(player_id, game_id) DO UPDATE SET team = excluded.team, updated_at = excluded.updated_at').bind(playerId, gid, wid, team, now));
    else stmts.push(db.prepare('DELETE FROM picks WHERE player_id = ?1 AND game_id = ?2').bind(playerId, gid));
    changed.push(`${g.away}@${g.home}: ${existing.get(gid) || '-'} -> ${team || '-'}`);
  }
  if (tiebreak !== undefined) {
    const tbGame = tiebreakGame(games, week.tiebreak_game);
    const old = await one(db, 'SELECT total FROM tiebreakers WHERE player_id = ?1 AND week_id = ?2', playerId, wid);
    const val = tiebreak === '' || tiebreak === null ? null : Math.round(Number(tiebreak));
    if ((old ? old.total : null) !== val) {
      if (val !== null && (!Number.isFinite(val) || val < 0 || val > 200)) rejected.push({ game_id: 'tiebreak', reason: 'enter a total between 0 and 200' });
      else if (!override && tbGame && isLocked(tbGame, now)) rejected.push({ game_id: 'tiebreak', reason: 'locked' });
      else {
        stmts.push(val === null
          ? db.prepare('DELETE FROM tiebreakers WHERE player_id = ?1 AND week_id = ?2').bind(playerId, wid)
          : db.prepare('INSERT INTO tiebreakers (player_id, week_id, total, updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(player_id, week_id) DO UPDATE SET total = excluded.total, updated_at = excluded.updated_at').bind(playerId, wid, val, now));
        changed.push(`tiebreak: ${old ? old.total : '-'} -> ${val ?? '-'}`);
      }
    }
  }
  if (stmts.length) {
    await writeWeek(db, wid, stmts);
    await audit(db, actor.id, playerId, wid, override && actor.id !== playerId ? 'admin_picks' : 'picks', changed.join('; '));
  }
  return { saved: changed.length, rejected };
}

// ---------- routes ----------
async function api(req, env, ctx, url) {
  const db = env.DB;
  await ensureSchema(db);
  const settings = await getSettings(db);
  const me = await currentPlayer(req, db);
  const path = url.pathname.replace(/^\/api/, '');
  const method = req.method;

  if (method === 'POST' && !(req.headers.get('content-type') || '').includes('application/json')) return fail('JSON only', 415);
  const body = method === 'POST' ? await req.json().catch(() => ({})) : {};

  if (method === 'POST' && isDemo(env) && DEMO_BLOCKED.includes(path)) return fail("That's switched off in the demo so it stays nice for the next visitor. Get your own free copy to try everything.", 403);

  if (method === 'POST' && path === '/demo-login') {
    if (!isDemo(env)) return fail('Not found', 404);
    const p = await one(db, 'SELECT * FROM players WHERE name_key = ?1', (body.role === 'commish' ? DEMO_COMMISH : DEMO_PLAYER).toLowerCase());
    if (!p) return fail('The demo is resetting. Try again in a few seconds.', 503);
    return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(db, p) });
  }

  if (method === 'GET' && path === '/state') {
    await syncIfStale(db, settings, ctx);
    await maybeSeedDemo(db, env);
    const s = await getSettings(db);
    const weeks = await all(db, 'SELECT id, label, season FROM weeks ORDER BY season, season_type, week');
    // The earliest week that still has a game open for picks; the Picks page opens there.
    const openRow = await one(db, `SELECT w.id FROM games g JOIN weeks w ON w.id = g.week_id WHERE g.kickoff > ?1 AND g.state = 'pre'
      ORDER BY w.season, w.season_type, w.week LIMIT 1`, Date.now());
    let wid = url.searchParams.get('week') || s.current_week || (weeks.at(-1) || {}).id;
    if (wid && !weeks.find((w) => w.id === wid)) wid = s.current_week;
    const view = wid ? await weekView(db, s, wid, me) : null;
    const anyPlayer = await one(db, 'SELECT 1 AS x FROM players LIMIT 1');
    return json({
      league: { name: s.league_name, hide_picks: s.hide_picks === '1', current_week: s.current_week, needs_setup: !anyPlayer && !isDemo(env), default_theme: s.default_theme, source: s.source,
        open_week: openRow ? openRow.id : s.current_week, open_mode: s.open_mode,
        season_cfg: Object.fromEntries(SEASON_KEYS.map((k) => [k.replace('season_', ''), s[k] !== '0'])),
        demo: isDemo(env) ? { reset_at: Number(s.demo_reset || 0), every_ms: DEMO_RESET_MS } : null,
        recovery_pin_set: !!(me && me.is_admin && recoveryPin(env)), calc_preset: s.calc_preset ? JSON.parse(s.calc_preset) : null, last_sync: Number(s.last_sync) },
      me: me ? { id: me.id, name: me.name, is_admin: !!me.is_admin } : null,
      weeks, view, last_winners: wid ? await lastWinners(db, weeks, wid) : null, now: Date.now(),
    });
  }

  if (method === 'GET' && path === '/season') {
    if (settings.season_tab === '0') return fail('The Season tab is switched off for this pool.', 404);
    const season = Number(url.searchParams.get('season')) || Number((settings.current_week || '').split('-')[0]);
    const ids = await all(db, 'SELECT id FROM weeks WHERE season = ?1 ORDER BY season_type, week', season);
    const weeks = [], names = new Map();
    for (const { id } of ids) {
      const raw = await loadWeek(db, id);
      if (!raw || !raw.games.length) continue;
      raw.players.forEach((p) => names.set(p.id, p));
      if (!raw.players.length) continue;
      weeks.push({ id, label: raw.week.label, games: raw.games, entrants: raw.players, picks: raw.picks, tiebreakers: raw.tbs, tiebreakGameId: raw.week.tiebreak_game });
    }
    // Only totals leave the server: no picks, so nothing hidden before kickoff is revealed.
    const st = seasonStats(weeks);
    return json({ season, weeks: st.weeks, rows: st.rows, players: [...names.values()] });
  }

  if (method === 'POST' && path === '/signup') {
    const name = cleanName(body.name), pin = String(body.pin || '');
    const first = !(await one(db, 'SELECT 1 AS x FROM players LIMIT 1'));
    if (!first && (!settings.join_code || String(body.code || '').trim().toLowerCase() !== settings.join_code.toLowerCase())) return fail('That join code is not right. Ask the commissioner for it.', 403);
    if (!name) return fail('Pick a display name.');
    if (!/^\d{4,8}$/.test(pin)) return fail('PIN must be 4 to 8 digits.');
    if (await one(db, 'SELECT id FROM players WHERE name_key = ?1', nameKey(name))) return fail('That name is taken. Add an initial or a number.');
    const r = await run(db, 'INSERT INTO players (name, name_key, pin_hash, is_admin, created_at) VALUES (?1,?2,?3,?4,?5)', name, nameKey(name), await hashPin(pin), first ? 1 : 0, Date.now());
    if (first) await setSetting(db, 'join_code', randomToken(4).replace(/[-_]/g, 'x').slice(0, 6).toLowerCase());
    const p = await one(db, 'SELECT * FROM players WHERE id = ?1', r.meta.last_row_id);
    await audit(db, p.id, p.id, null, 'signup', first ? 'first player, made commissioner' : '');
    return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(db, p) });
  }

  if (method === 'POST' && path === '/login') {
    const p = await one(db, 'SELECT * FROM players WHERE name_key = ?1', nameKey(body.name));
    if (!p || !p.active) return fail('No player by that name.', 404);
    // Owner-only recovery: whoever controls the Cloudflare account can set RECOVERY_PIN, and a commissioner who
    // logs in with it gets it as their new PIN. The site nags until the variable is deleted.
    const rec = recoveryPin(env);
    if (rec && p.is_admin && String(body.pin || '') === rec) {
      await run(db, 'UPDATE players SET pin_hash = ?1, failed = 0, locked_until = 0, session_ver = session_ver + 1 WHERE id = ?2', await hashPin(rec), p.id);
      await audit(db, p.id, p.id, null, 'pin_recovery', 'commissioner PIN reset with RECOVERY_PIN');
      const fresh = await one(db, 'SELECT * FROM players WHERE id = ?1', p.id);
      return json({ ok: true, recovered: true }, 200, { 'set-cookie': await sessionCookie(db, fresh) });
    }
    if (p.locked_until > Date.now()) return fail('Too many wrong PINs. Try again in 15 minutes, or ask the commissioner to reset it.', 429);
    if (!(await verifyPin(String(body.pin || ''), p.pin_hash))) {
      const failed = p.failed + 1;
      await run(db, 'UPDATE players SET failed = ?1, locked_until = ?2 WHERE id = ?3', failed >= 5 ? 0 : failed, failed >= 5 ? Date.now() + 15 * 60e3 : 0, p.id);
      return fail('Wrong PIN.', 401);
    }
    await run(db, 'UPDATE players SET failed = 0, locked_until = 0 WHERE id = ?1', p.id);
    return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(db, p) });
  }

  if (method === 'POST' && path === '/logout') return json({ ok: true }, 200, { 'set-cookie': 'sp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });

  if (!me) return fail('Log in first.', 401);

  if (method === 'POST' && path === '/picks') {
    const r = await savePicks(db, { actor: me, playerId: me.id, wid: body.week_id, picks: body.picks, tiebreak: body.tiebreak });
    return r.error ? fail(r.error) : json(r);
  }

  if (method === 'POST' && path === '/pin') {
    const p = await one(db, 'SELECT * FROM players WHERE id = ?1', me.id);
    if (!(await verifyPin(String(body.old || ''), p.pin_hash))) return fail('Current PIN is wrong.', 401);
    if (!/^\d{4,8}$/.test(String(body.pin || ''))) return fail('PIN must be 4 to 8 digits.');
    await run(db, 'UPDATE players SET pin_hash = ?1, session_ver = session_ver + 1 WHERE id = ?2', await hashPin(String(body.pin)), me.id);
    const fresh = await one(db, 'SELECT * FROM players WHERE id = ?1', me.id);
    return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(db, fresh) });
  }

  // ----- commissioner only below -----
  if (!me.is_admin) return fail('Commissioner only.', 403);

  if (method === 'GET' && path === '/admin') {
    const wid = url.searchParams.get('week') || settings.current_week;
    const players = await all(db, 'SELECT id, name, sponsor, is_admin, active, created_at FROM players ORDER BY name_key');
    const picks = await all(db, 'SELECT player_id, game_id, team FROM picks WHERE week_id = ?1', wid);
    const tbs = await all(db, 'SELECT player_id, total FROM tiebreakers WHERE week_id = ?1', wid);
    const log = await all(db, `SELECT a.at, a.action, a.detail, a.week_id, ap.name AS actor, pp.name AS player FROM audit a
      LEFT JOIN players ap ON ap.id = a.actor_id LEFT JOIN players pp ON pp.id = a.player_id ORDER BY a.id DESC LIMIT 200`);
    const source = { source: settings.source, feed_url: settings.feed_url, has_key: !!settings.feed_key, key_hint: settings.feed_key ? `…${settings.feed_key.slice(-4)}` : '' };
    return json({ settings: { league_name: settings.league_name, hide_picks: settings.hide_picks === '1', join_code: settings.join_code, open_mode: settings.open_mode, ...Object.fromEntries(SEASON_KEYS.map((k) => [k, settings[k] !== '0'])) }, source, teams: TEAMS.map((t) => ({ abbr: t.abbr, name: t.name })), players, picks, tiebreakers: tbs, log, week_id: wid });
  }

  if (method === 'POST' && path === '/admin/settings') {
    if (body.league_name !== undefined) await setSetting(db, 'league_name', cleanName(body.league_name) || 'The Spread Sheet');
    if (body.hide_picks !== undefined) await setSetting(db, 'hide_picks', body.hide_picks ? '1' : '0');
    if (body.calc_preset !== undefined) await setSetting(db, 'calc_preset', body.calc_preset ? JSON.stringify(normalizePool(body.calc_preset)) : '');
    if (body.open_mode !== undefined && OPEN_MODES.includes(body.open_mode)) { await setSetting(db, 'open_mode', body.open_mode); await setSetting(db, 'last_sync', '0'); await setSetting(db, 'season_sync', '0'); }
    for (const k of SEASON_KEYS) if (body[k] !== undefined) await setSetting(db, k, body[k] ? '1' : '0');
    if (body.default_theme !== undefined) await setSetting(db, 'default_theme', /^[A-Z]{2,3}$/.test(body.default_theme) ? body.default_theme : '');
    if (body.join_code !== undefined) await setSetting(db, 'join_code', String(body.join_code).trim().slice(0, 30));
    await audit(db, me.id, null, null, 'settings', body);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/admin/week') {
    const w = await one(db, 'SELECT * FROM weeks WHERE id = ?1', body.week_id);
    if (!w) return fail('Unknown week');
    await writeWeek(db, w.id, [db.prepare('UPDATE weeks SET message = ?1, tiebreak_game = ?2 WHERE id = ?3')
      .bind(String(body.message || '').slice(0, 500), body.tiebreak_game || null, w.id)]);
    await audit(db, me.id, null, w.id, 'week', body);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/admin/picks') {
    const r = await savePicks(db, { actor: me, playerId: Number(body.player_id), wid: body.week_id, picks: body.picks, tiebreak: body.tiebreak, override: true });
    return r.error ? fail(r.error) : json(r);
  }

  if (method === 'POST' && path === '/admin/player') {
    const p = await one(db, 'SELECT * FROM players WHERE id = ?1', Number(body.id));
    if (!p) return fail('Unknown player');
    if (p.id === me.id && (body.is_admin === false || body.active === false)) return fail('You cannot remove your own commissioner access.');
    const name = body.name !== undefined ? cleanName(body.name) : p.name;
    if (!name) return fail('Name cannot be blank.');
    const clash = await one(db, 'SELECT id FROM players WHERE name_key = ?1 AND id != ?2', nameKey(name), p.id);
    if (clash) return fail('Another player already has that name.');
    let pinHash = p.pin_hash, ver = p.session_ver;
    if (body.pin) {
      if (!/^\d{4,8}$/.test(String(body.pin))) return fail('PIN must be 4 to 8 digits.');
      pinHash = await hashPin(String(body.pin)); ver++;
    }
    await run(db, 'UPDATE players SET name = ?1, name_key = ?2, sponsor = ?3, is_admin = ?4, active = ?5, pin_hash = ?6, session_ver = ?7, failed = 0, locked_until = 0 WHERE id = ?8',
      name, nameKey(name), body.sponsor !== undefined ? String(body.sponsor).slice(0, 40) : p.sponsor,
      body.is_admin !== undefined ? (body.is_admin ? 1 : 0) : p.is_admin,
      body.active !== undefined ? (body.active ? 1 : 0) : p.active, pinHash, ver, p.id);
    if (name !== p.name || body.sponsor !== undefined) await dropSnapshots(db);
    await audit(db, me.id, p.id, null, 'player', { ...body, pin: body.pin ? '(reset)' : undefined });
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/admin/add-player') {
    // For people who text their picks in and never log in themselves.
    const name = cleanName(body.name);
    if (!name) return fail('Pick a display name.');
    if (await one(db, 'SELECT id FROM players WHERE name_key = ?1', nameKey(name))) return fail('That name is taken.');
    const pin = /^\d{4,8}$/.test(String(body.pin || '')) ? String(body.pin) : String(Math.floor(1000 + Math.random() * 9000));
    const r = await run(db, 'INSERT INTO players (name, name_key, sponsor, pin_hash, created_at) VALUES (?1,?2,?3,?4,?5)', name, nameKey(name), String(body.sponsor || '').slice(0, 40), await hashPin(pin), Date.now());
    await audit(db, me.id, r.meta.last_row_id, null, 'add_player', name);
    return json({ ok: true, id: r.meta.last_row_id, pin });
  }

  if (method === 'POST' && path === '/admin/game') {
    const g = await one(db, 'SELECT * FROM games WHERE id = ?1', body.game_id);
    if (!g) return fail('Unknown game');
    const w = body.manual_winner || null;
    if (w && ![g.home, g.away, 'TIE'].includes(w)) return fail('Winner must be one of the two teams or TIE');
    await writeWeek(db, g.week_id, [db.prepare('UPDATE games SET manual_winner = ?1 WHERE id = ?2').bind(w, g.id)]);
    await audit(db, me.id, null, g.week_id, 'game_winner', `${g.away}@${g.home}: ${w || 'use feed'}`);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/admin/sync') {
    try {
      if (body.week) {
        const w = await fetchWeekFrom(settings, { season: Number(body.season), type: Number(body.type || 2), week: Number(body.week) });
        await saveWeek(db, w, [(id) => snapshotStmt(db, id)]);
        return json({ ok: true, week_id: w.id });
      }
      return json({ ok: true, week_id: await syncCurrent(db, settings) });
    } catch (e) {
      return fail(e instanceof FeedError ? e.message : `Could not load the schedule: ${e.message}`, 502);
    }
  }

  // ----- data source -----
  // A blank feed_key keeps the saved key; clear_key removes it. The key is never sent back to the browser.
  const sourceFrom = (b) => ({
    source: SOURCES.includes(b.source) ? b.source : settings.source,
    feed_url: b.feed_url !== undefined ? String(b.feed_url).trim().slice(0, 500) : settings.feed_url,
    feed_key: b.clear_key ? '' : b.feed_key ? String(b.feed_key).trim().slice(0, 500) : settings.feed_key,
  });

  if (method === 'POST' && path === '/admin/source/test') {
    try {
      const w = await fetchWeekFrom(sourceFrom(body), body.week ? { season: Number(body.season), type: Number(body.type || 2), week: Number(body.week) } : {});
      return json({ ok: true, week: { id: w.id, label: w.label, season: w.season }, games: w.games.slice(0, 40).map((g) => ({ away: g.away, home: g.home, kickoff: g.kickoff, state: g.state, away_score: g.away_score, home_score: g.home_score })) });
    } catch (e) {
      return fail(e instanceof FeedError ? e.message : `Test failed: ${e.message}`, 400);
    }
  }

  if (method === 'POST' && path === '/admin/source') {
    const next = sourceFrom(body);
    if (next.source === 'custom' && !feedUrlOk(next.feed_url)) return fail('A custom feed URL must start with https://');
    for (const k of ['source', 'feed_url', 'feed_key']) await setSetting(db, k, next[k]);
    await setSetting(db, 'last_sync', '0'); // fetch from the new source on the next page view
    await audit(db, me.id, null, null, 'source', { source: next.source, feed_url: next.feed_url, key: next.feed_key ? 'set' : 'none' });
    return json({ ok: true });
  }

  // ----- manual games: work in every mode, but a feed overwrites its own games on the next sync -----
  if (method === 'POST' && path === '/admin/manual/week') {
    const season = Number(body.season), type = Number(body.type || 2), week = Number(body.week);
    if (!Number.isInteger(season) || season < 1900 || !Number.isInteger(week) || week < 1 || week > 30 || ![1, 2, 3].includes(type)) return fail('Enter a season year and a week number from 1 to 30.');
    const id = weekId(season, type, week);
    const label = String(body.label || weekLabel(type, week)).trim().slice(0, 40);
    await writeWeek(db, id, [db.prepare('INSERT INTO weeks (id, season, season_type, week, label, synced_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET label = excluded.label')
      .bind(id, season, type, week, label, Date.now())]);
    if (body.make_current !== false) await setSetting(db, 'current_week', id);
    await audit(db, me.id, null, id, 'manual_week', label);
    return json({ ok: true, week_id: id });
  }

  if (method === 'POST' && path === '/admin/manual/game') {
    const w = await one(db, 'SELECT id FROM weeks WHERE id = ?1', body.week_id);
    if (!w) return fail('Unknown week');
    const code = (x) => String(x || '').trim().toUpperCase();
    const home = code(body.home), away = code(body.away);
    if (!/^[A-Z0-9]{1,5}$/.test(home) || !/^[A-Z0-9]{1,5}$/.test(away)) return fail('Teams must be short codes like "KC".');
    if (home === away) return fail('A team cannot play itself.');
    const kickoff = Number(body.kickoff);
    if (!Number.isFinite(kickoff)) return fail('Set a kickoff date and time.');
    const state = ['pre', 'in', 'post'].includes(body.state) ? body.state : 'pre';
    const num = (v) => (v === '' || v == null ? null : Math.max(0, Math.round(Number(v))));
    const hs = state === 'pre' ? null : num(body.home_score), as = state === 'pre' ? null : num(body.away_score);
    if (Number.isNaN(hs) || Number.isNaN(as)) return fail('Scores must be numbers.');
    if (state === 'post' && (hs == null || as == null)) return fail('A final game needs both scores.');
    const id = body.id && String(body.id).startsWith('m-') ? String(body.id) : `m-${randomToken(6)}`;
    const team = (abbr) => TEAMS.find((t) => t.abbr === abbr);
    const g = {
      id, kickoff, home, away, state, home_score: hs, away_score: as,
      home_name: team(home)?.short || '', away_name: team(away)?.short || '',
      home_color: (team(home)?.color || '').replace('#', ''), away_color: (team(away)?.color || '').replace('#', ''),
      detail: state === 'post' ? 'Final' : state === 'in' ? 'In progress' : '', winner: winnerFrom(state, home, away, hs, as),
    };
    await writeWeek(db, w.id, [upsertGame(db, w.id, g)]);
    await audit(db, me.id, null, w.id, 'manual_game', `${away}@${home} ${state}${state !== 'pre' ? ` ${as}-${hs}` : ''}`);
    return json({ ok: true, id });
  }

  if (method === 'POST' && path === '/admin/manual/game-delete') {
    const g = await one(db, 'SELECT * FROM games WHERE id = ?1', body.game_id);
    if (!g) return fail('Unknown game');
    if (!String(g.id).startsWith('m-')) return fail('Only games you added by hand can be deleted. Feed games come back on the next sync.');
    await writeWeek(db, g.week_id, [db.prepare('DELETE FROM picks WHERE game_id = ?1').bind(g.id), db.prepare('DELETE FROM games WHERE id = ?1').bind(g.id)]);
    await audit(db, me.id, null, g.week_id, 'manual_game_delete', `${g.away}@${g.home}`);
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/admin/export.csv') {
    const wid = url.searchParams.get('week') || settings.current_week;
    const v = await weekView(db, { hide_picks: '0' }, wid, null);
    if (!v) return fail('Unknown week', 404);
    const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const head = ['Name', 'With', ...v.games.map((g) => `${g.away} @ ${g.home}`), 'Tiebreak', 'Wins', 'Rank'];
    const lines = [head.map(esc).join(',')];
    const winRow = ['Winning team', '', ...v.games.map((g) => g.manual_winner || g.winner || ''), v.standings.tiebreak.actual ?? '', '', ''];
    lines.push(winRow.map(esc).join(','));
    for (const r of v.standings.rows) {
      const p = v.players.find((x) => x.id === r.player_id);
      const pk = (gid) => (v.picks.find((x) => x.player_id === r.player_id && x.game_id === gid) || {}).team || '';
      lines.push([p.name, p.sponsor, ...v.games.map((g) => pk(g.id)), r.tb ?? '', r.wins, r.rank].map(esc).join(','));
    }
    return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${v.week.label.replace(/\W+/g, '-')}.csv"` } });
  }

  return fail('Not found', 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, env, ctx, url);
      } catch (e) {
        console.log('error', e.stack || e.message);
        return fail('Something went wrong on the server.', 500);
      }
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(event, env, ctx) {
    await ensureSchema(env.DB);
    const settings = await getSettings(env.DB);
    if (settings.source !== 'manual') ctx.waitUntil(syncCurrent(env.DB, settings).catch((e) => console.log('cron sync failed', e.message)));
    if (isDemo(env)) ctx.waitUntil(maybeSeedDemo(env.DB, env).catch((e) => console.log('demo reset failed', e.message)));
  },
};

