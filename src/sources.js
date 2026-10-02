// Where games and scores come from. The commissioner picks one in Admin → Data source:
//   espn    ESPN's public scoreboard (unofficial, free, no key). The default.
//   custom  Any URL that returns the simple JSON format below (or ESPN's shape), with an optional API key.
//   manual  No feed. The commissioner types in games and scores.
//
// Custom feed format (documented for users in FEED.md):
//   { "season": 2026, "type": 2, "week": 5, "label": "Week 5",
//     "games": [ { "id": "g1", "kickoff": "2026-10-11T17:00:00Z", "away": "NE", "home": "BUF",
//                  "away_score": null, "home_score": null, "state": "pre", "detail": "" } ] }
// The URL may contain {season}, {week} and {type}. They are filled in when a specific week is loaded,
// and left empty when asking for the current week.
import { parseEspn, isEspnShape, espnUrl, weekId, weekLabel } from './espn.js';

export const SOURCES = ['espn', 'custom', 'manual'];
const STATES = ['pre', 'in', 'post'];

export class FeedError extends Error {}

const abbrOk = (s) => typeof s === 'string' && /^[A-Za-z0-9]{1,5}$/.test(s.trim());
const intOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);

// Works out the winner from the scores when a final game does not say.
export function winnerFrom(state, home, away, homeScore, awayScore, given) {
  if (state !== 'post') return null;
  if (given) return given;
  if (homeScore == null || awayScore == null) return null;
  return homeScore > awayScore ? home : awayScore > homeScore ? away : 'TIE';
}

// Validates and cleans a custom feed. Bad input is rejected with a message the commissioner can act on.
export function normalizeFeed(data) {
  if (isEspnShape(data)) return parseEspn(data);
  if (!data || typeof data !== 'object') throw new FeedError('The feed did not return a JSON object.');
  const season = Number(data.season), type = Number(data.type || 2), week = Number(data.week);
  if (!Number.isInteger(season) || season < 1900 || season > 3000) throw new FeedError('"season" must be a year like 2026.');
  if (!Number.isInteger(week) || week < 1 || week > 30) throw new FeedError('"week" must be a number from 1 to 30.');
  if (![1, 2, 3].includes(type)) throw new FeedError('"type" must be 1 (preseason), 2 (regular season) or 3 (playoffs).');
  if (!Array.isArray(data.games)) throw new FeedError('"games" must be a list.');
  if (data.games.length > 40) throw new FeedError('Too many games in one week (40 max).');
  const seen = new Set();
  const games = data.games.map((g, i) => {
    const where = `Game ${i + 1}`;
    if (!g || typeof g !== 'object') throw new FeedError(`${where} is not an object.`);
    const id = String(g.id ?? '').trim().slice(0, 64);
    if (!id) throw new FeedError(`${where} needs an "id".`);
    if (seen.has(id)) throw new FeedError(`${where}: the id "${id}" is used twice.`);
    seen.add(id);
    if (!abbrOk(g.home) || !abbrOk(g.away)) throw new FeedError(`${where}: "home" and "away" must be short team codes like "KC".`);
    const home = g.home.trim().toUpperCase(), away = g.away.trim().toUpperCase();
    if (home === away) throw new FeedError(`${where}: a team cannot play itself.`);
    const kickoff = typeof g.kickoff === 'number' ? g.kickoff : Date.parse(g.kickoff);
    if (!Number.isFinite(kickoff)) throw new FeedError(`${where}: "kickoff" must be a date like "2026-10-11T17:00:00Z".`);
    const state = STATES.includes(g.state) ? g.state : 'pre';
    const hs = intOrNull(g.home_score), as = intOrNull(g.away_score);
    if (Number.isNaN(hs) || Number.isNaN(as)) throw new FeedError(`${where}: scores must be numbers or null.`);
    const given = g.winner ? String(g.winner).toUpperCase() : null;
    if (given && ![home, away, 'TIE'].includes(given)) throw new FeedError(`${where}: "winner" must be the home team, the away team or "TIE".`);
    return {
      id: `c-${id}`, kickoff, home, away,
      home_name: String(g.home_name || '').slice(0, 30), away_name: String(g.away_name || '').slice(0, 30),
      home_color: /^#?[0-9a-f]{6}$/i.test(g.home_color || '') ? g.home_color.replace('#', '') : '',
      away_color: /^#?[0-9a-f]{6}$/i.test(g.away_color || '') ? g.away_color.replace('#', '') : '',
      home_score: state === 'pre' ? null : hs, away_score: state === 'pre' ? null : as,
      state, detail: String(g.detail || '').slice(0, 40), winner: winnerFrom(state, home, away, hs, as, given),
    };
  });
  return { season, type, week, id: weekId(season, type, week), label: String(data.label || weekLabel(type, week)).slice(0, 40), games };
}

// https only. Plain http is allowed for localhost so a feed can be tested on your own computer.
export const feedUrlOk = (u) => /^https:\/\/[^\s]+$/i.test(u || '') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u || '');

export function fillUrl(template, opts = {}) {
  return template.replace(/\{(season|week|type)\}/g, (_, k) => (opts[k] != null ? encodeURIComponent(opts[k]) : ''));
}

async function getJson(url, key) {
  const headers = { 'user-agent': 'picks-pool/1.0', accept: 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  let res;
  try { res = await fetch(url, { headers }); } catch (e) { throw new FeedError(`Could not reach the feed (${e.message}).`); }
  if (!res.ok) throw new FeedError(`The feed answered ${res.status}${res.status === 401 || res.status === 403 ? ': check the API key' : ''}.`);
  try { return await res.json(); } catch { throw new FeedError('The feed did not return valid JSON.'); }
}

// Fetches one week from the configured source. opts = {} means "the current week".
export async function fetchWeekFrom(settings, opts = {}) {
  const source = settings.source || 'espn';
  if (source === 'manual') throw new FeedError('Manual mode has no feed. Add games in Admin → This week.');
  if (source === 'custom') {
    if (!feedUrlOk(settings.feed_url)) throw new FeedError('Set a feed URL that starts with https://');
    return normalizeFeed(await getJson(fillUrl(settings.feed_url, opts), settings.feed_key));
  }
  return parseEspn(await getJson(espnUrl(opts)));
}

// Upserts one week. Leaves commissioner settings and manual winners alone.
// `after` builds extra statements (the week snapshot refresh) that run in the same transaction.
export async function saveWeek(db, w, after = []) {
  const now = Date.now();
  const stmts = [
    db.prepare(`INSERT INTO weeks (id, season, season_type, week, label, synced_at) VALUES (?1,?2,?3,?4,?5,?6)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label, synced_at=excluded.synced_at`)
      .bind(w.id, w.season, w.type, w.week, w.label, now),
  ];
  for (const g of w.games) stmts.push(upsertGame(db, w.id, g));
  await db.batch([...stmts, ...after.map((f) => f(w.id))]);
  return w;
}

export function upsertGame(db, wid, g) {
  return db.prepare(`INSERT INTO games (id, week_id, kickoff, home, home_name, home_color, away, away_name, away_color, home_score, away_score, state, detail, winner)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
    ON CONFLICT(id) DO UPDATE SET week_id=excluded.week_id, kickoff=excluded.kickoff, home=excluded.home, home_name=excluded.home_name,
      home_color=excluded.home_color, away=excluded.away, away_name=excluded.away_name, away_color=excluded.away_color,
      home_score=excluded.home_score, away_score=excluded.away_score, state=excluded.state, detail=excluded.detail, winner=excluded.winner`)
    .bind(g.id, wid, g.kickoff, g.home, g.home_name || '', g.home_color || '', g.away, g.away_name || '', g.away_color || '',
      g.home_score ?? null, g.away_score ?? null, g.state, g.detail || '', g.winner ?? null);
}
