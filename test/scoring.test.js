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
