import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreWeek, isLocked, gameWinner, tiebreakGame } from '../src/scoring.js';

const g = (id, kickoff, extra = {}) => ({ id, kickoff, state: 'pre', winner: null, manual_winner: null, home_score: null, away_score: null, ...extra });

test('undecided games never count as wins (the sheet\'s blank==blank bug)', () => {
  const games = [g('a', 1, { state: 'post', winner: 'CLE' }), g('b', 2)];
  const r = scoreWeek({ games, entrants: [{ id: 1 }], picks: [], tiebreakers: [] });
  assert.equal(r.rows[0].wins, 0);
  assert.equal(r.rows[0].losses, 1);
  assert.equal(r.final, false);
  assert.deepEqual(r.winners, []);
});

test('counts wins, losses, pending and max possible', () => {
  const games = [g('a', 1, { state: 'post', winner: 'CLE' }), g('b', 2, { state: 'post', winner: 'BUF' }), g('c', 3)];
  const picks = [
    { player_id: 1, game_id: 'a', team: 'CLE' }, { player_id: 1, game_id: 'b', team: 'NE' }, { player_id: 1, game_id: 'c', team: 'X' },
    { player_id: 2, game_id: 'a', team: 'CLE' }, { player_id: 2, game_id: 'b', team: 'BUF' },
  ];
  const r = scoreWeek({ games, entrants: [{ id: 1 }, { id: 2 }], picks, tiebreakers: [] });
  const p1 = r.rows.find((x) => x.player_id === 1), p2 = r.rows.find((x) => x.player_id === 2);
  assert.deepEqual([p1.wins, p1.losses, p1.pending, p1.max], [1, 1, 1, 2]);
  assert.deepEqual([p2.wins, p2.losses, p2.pending, p2.max], [2, 0, 0, 2]);
  assert.equal(r.rows[0].player_id, 2);
  assert.equal(p1.alive, true); // can still tie 2
});

test('tiebreak: closest to MNF total wins, over or under does not matter, exact ties split', () => {
  const games = [g('a', 1, { state: 'post', winner: 'CLE' }), g('mnf', 9, { state: 'post', winner: 'NO', home_score: 24, away_score: 20 })];
  const picks = [1, 2, 3, 4].flatMap((id) => [{ player_id: id, game_id: 'a', team: 'CLE' }, { player_id: id, game_id: 'mnf', team: 'NO' }]);
  const tiebreakers = [{ player_id: 1, total: 43 }, { player_id: 2, total: 45 }, { player_id: 3, total: 50 }];
  const r = scoreWeek({ games, entrants: [1, 2, 3, 4].map((id) => ({ id })), picks, tiebreakers });
  assert.equal(r.final, true);
  assert.equal(r.tiebreak.actual, 44);
  assert.deepEqual(r.winners.sort(), [1, 2]);
  assert.equal(r.rows.find((x) => x.player_id === 4).rank, 4); // no tiebreak entered ranks last
});

test('a tied NFL game credits nobody', () => {
  const games = [g('a', 1, { state: 'post', winner: 'TIE' })];
  const r = scoreWeek({ games, entrants: [{ id: 1 }], picks: [{ player_id: 1, game_id: 'a', team: 'CLE' }], tiebreakers: [] });
  assert.equal(r.rows[0].wins, 0);
});

test('manual winner overrides the feed and decides a game', () => {
  assert.equal(gameWinner(g('a', 1, { manual_winner: 'PIT' })), 'PIT');
  assert.equal(gameWinner(g('a', 1, { state: 'post', winner: 'CLE', manual_winner: 'PIT' })), 'PIT');
  assert.equal(gameWinner(g('a', 1, { state: 'in' })), null);
});

test('locks at kickoff or once the feed says the game started', () => {
  assert.equal(isLocked(g('a', 1000), 999), false);
  assert.equal(isLocked(g('a', 1000), 1000), true);
  assert.equal(isLocked(g('a', 5000, { state: 'in' }), 1000), true);
});

test('tiebreak game defaults to the last kickoff', () => {
  const games = [g('tnf', 1), g('mnf', 9), g('sun', 5)];
  assert.equal(tiebreakGame(games).id, 'mnf');
  assert.equal(tiebreakGame(games, 'sun').id, 'sun');
});

import { seasonStats } from '../src/scoring.js';

test('season: totals, weeks won (shared ties count), best/worst only from finished weeks, streaks across weeks', () => {
  const fin = (id, k, winner) => g(id, k, { state: 'post', winner });
  const wk1 = { id: 'w1', label: 'Week 1', games: [fin('a', 1, 'A'), fin('b', 2, 'B')], entrants: [{ id: 1 }, { id: 2 }],
    picks: [{ player_id: 1, game_id: 'a', team: 'A' }, { player_id: 1, game_id: 'b', team: 'B' }, { player_id: 2, game_id: 'a', team: 'A' }, { player_id: 2, game_id: 'b', team: 'X' }], tiebreakers: [] };
  // Week 2: both go 1-1, no tiebreak guesses -> they share the week
  const wk2 = { id: 'w2', label: 'Week 2', games: [fin('c', 3, 'C'), fin('d', 4, 'D')], entrants: [{ id: 1 }, { id: 2 }],
    picks: [{ player_id: 1, game_id: 'c', team: 'X' }, { player_id: 1, game_id: 'd', team: 'D' }, { player_id: 2, game_id: 'c', team: 'C' }, { player_id: 2, game_id: 'd', team: 'X' }], tiebreakers: [] };
  // Week 3 in progress: one decided game, one pending; must not set best/worst
  const wk3 = { id: 'w3', label: 'Week 3', games: [fin('e', 5, 'E'), g('f', 6)], entrants: [{ id: 1 }, { id: 2 }],
    picks: [{ player_id: 1, game_id: 'e', team: 'E' }, { player_id: 2, game_id: 'e', team: 'X' }], tiebreakers: [] };
  const s = seasonStats([wk1, wk2, wk3]);
  const p1 = s.rows.find((r) => r.player_id === 1), p2 = s.rows.find((r) => r.player_id === 2);
  assert.deepEqual([p1.wins, p1.losses, p1.weeksWon, p1.sharedWins], [4, 1, 2, 1]);
  assert.deepEqual([p2.wins, p2.losses, p2.weeksWon, p2.sharedWins], [2, 3, 1, 1]);
  assert.equal(s.rows[0].player_id, 1);
  assert.deepEqual([p1.best.week, p1.worst.week], ['w1', 'w2']); // w3 unfinished, ignored
  assert.equal(p1.longestStreak, 2); // a,b then miss on c, then d,e = 2
  assert.equal(p1.streak, 2);        // d, e (pending f ignored)
  assert.equal(p2.longestStreak, 1);
  assert.equal(p2.streak, 0);
  assert.deepEqual(s.weeks.map((w) => w.final), [true, true, false]);
  assert.equal(p1.weekly.w3.pending, 0); // no pick on the pending game
});

test('season: equal wins and weeks won share a rank', () => {
  const wk = { id: 'w', label: 'W', games: [g('a', 1, { state: 'post', winner: 'A' })], entrants: [{ id: 1 }, { id: 2 }],
    picks: [{ player_id: 1, game_id: 'a', team: 'A' }, { player_id: 2, game_id: 'a', team: 'A' }], tiebreakers: [] };
  const s = seasonStats([wk]);
  assert.deepEqual(s.rows.map((r) => r.rank), [1, 1]);
});
