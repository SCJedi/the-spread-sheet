// Demo mode: a public showcase with made-up players and picks that resets itself.
// Turned on by the DEMO variable (see wrangler.demo.toml). Never used by a normal install.
import { hashPin } from './auth.js';

export const isDemo = (env) => env && String(env.DEMO || '') === '1';
export const DEMO_RESET_MS = 60 * 60 * 1000;
export const DEMO_PLAYER = 'You (demo)';
export const DEMO_COMMISH = 'Demo Commish';

// Invented nicknames. None refers to a real person.
const NAMES = [
  'Couch Coach', 'Blitz Bunny', 'Lucky Socks', 'Hail Mary Hank', 'Gridiron Gran', 'Two-Minute Tina', 'Snack Captain',
  'Upset Ursula', 'Fourth & Long', 'The Commentator', 'Big Play Benny', 'Nacho Average Joe', 'Red Zone Rita', 'Overtime Otis',
  'Pick Six Pam', 'Tailgate Tony', 'Coin Flip Carl', 'Sideline Sue', 'Fantasy Phil', 'Cousin Eddie T.', 'Huddle Hannah',
  'Punt Pete', 'Mascot Mike', 'Grandpa Gus', 'Office Oracle', 'Rookie Rae', 'Endzone Ed', 'Wildcard Wendy',
];
const SPONSORS = ['', '', '', 'Ryan', '', 'Jo', '', ''];

// Small deterministic random generator, so one reset produces one consistent set of picks.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Builds the demo league: players, picks for every loaded week, tiebreak guesses. Picks for games that
// already started are still made up (as if entered before kickoff), so finished games score right away.
export async function seedDemo(db, { writeWeekStmts }) {
  const now = Date.now();
  const pin = await hashPin(String(100000 + Math.floor(Math.random() * 899999))); // nobody needs it; demo login skips PINs
  const stmts = [
    db.prepare('DELETE FROM picks'), db.prepare('DELETE FROM tiebreakers'), db.prepare('DELETE FROM audit'), db.prepare('DELETE FROM players'),
    db.prepare('DELETE FROM snapshots'),
    db.prepare("INSERT INTO settings (key, value) VALUES ('hide_picks', '0') ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
    db.prepare("INSERT INTO settings (key, value) VALUES ('league_name', 'Demo League') ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
    db.prepare("INSERT INTO settings (key, value) VALUES ('join_code', 'demo') ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
  ];
  const people = [DEMO_COMMISH, DEMO_PLAYER, ...NAMES];
  people.forEach((name, i) => stmts.push(db.prepare('INSERT INTO players (id, name, name_key, sponsor, pin_hash, is_admin, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)')
    .bind(i + 1, name, name.toLowerCase(), SPONSORS[i % SPONSORS.length], pin, name === DEMO_COMMISH ? 1 : 0, now)));
  await db.batch(stmts);

  const weeks = (await db.prepare('SELECT id FROM weeks ORDER BY season, season_type, week').all()).results.slice(-2);
  const random = rng(Math.floor(now / DEMO_RESET_MS));
  for (const { id: wid } of weeks) {
    const games = (await db.prepare('SELECT * FROM games WHERE week_id = ?1 ORDER BY kickoff').bind(wid).all()).results;
    if (!games.length) continue;
    const w = [];
    people.forEach((_, i) => {
      const pid = i + 1;
      if (pid === 2) return; // the visitor's own sheet starts empty so they can try picking
      const skill = 0.45 + random() * 0.3; // how often this player sides with the eventual winner
      for (const g of games) {
        const winner = g.manual_winner || g.winner;
        const fav = winner && winner !== 'TIE' ? winner : (random() < 0.55 ? g.home : g.away);
        const other = fav === g.home ? g.away : g.home;
        const team = random() < skill ? fav : other;
        w.push(db.prepare('INSERT INTO picks (player_id, game_id, week_id, team, updated_at) VALUES (?1,?2,?3,?4,?5)').bind(pid, g.id, wid, team, now));
      }
      w.push(db.prepare('INSERT INTO tiebreakers (player_id, week_id, total, updated_at) VALUES (?1,?2,?3,?4)').bind(pid, wid, 30 + Math.floor(random() * 32), now));
    });
    for (let i = 0; i < w.length; i += 90) await db.batch(w.slice(i, i + 90));
    await db.batch(writeWeekStmts(wid));
  }
  await db.prepare("INSERT INTO settings (key, value) VALUES ('demo_reset', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(now)).run();
}

// What a visitor may not change in the demo (it would spoil it for the next person).
export const DEMO_BLOCKED = ['/signup', '/pin', '/admin/settings', '/admin/source', '/admin/player', '/admin/add-player', '/admin/manual/week', '/admin/manual/game', '/admin/manual/game-delete'];
