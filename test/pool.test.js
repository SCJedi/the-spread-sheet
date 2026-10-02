import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcPool, normalizePool, encodePool, decodePool } from '../public/pool.js';

const st = (rows, final = true) => ({ final, rows });
const amounts = (r) => Object.fromEntries(r.results.map((x) => [x.player_id, Math.round(x.amount * 100) / 100]));

test('winner takes all: entry x players', () => {
  const r = calcPool(st([{ player_id: 1, wins: 10, tbDiff: 2 }, { player_id: 2, wins: 9, tbDiff: 0 }]), { entry: 5, payouts: [100] });
  assert.equal(r.pot, 10);
  assert.deepEqual(amounts(r), { 1: 10, 2: 0 });
});

test('tiebreak separates equal wins; split mode shares them', () => {
  const rows = [{ player_id: 1, wins: 10, tbDiff: 1 }, { player_id: 2, wins: 10, tbDiff: 3 }, { player_id: 3, wins: 8, tbDiff: 0 }];
  assert.deepEqual(amounts(calcPool(st(rows), { entry: 10, payouts: [100], ties: 'tiebreak' })), { 1: 30, 2: 0, 3: 0 });
  assert.deepEqual(amounts(calcPool(st(rows), { entry: 10, payouts: [100], ties: 'split' })), { 1: 15, 2: 15, 3: 0 });
});

test('tied players pool the places they occupy', () => {
  // 70/30 with a two-way tie for first: each gets (70+30)/2 of the pot
  const rows = [{ player_id: 1, wins: 10, tbDiff: 2 }, { player_id: 2, wins: 10, tbDiff: 2 }, { player_id: 3, wins: 5, tbDiff: 0 }];
  const r = calcPool(st(rows), { entry: 10, payouts: [70, 30] });
  assert.deepEqual(amounts(r), { 1: 15, 2: 15, 3: 0 });
  assert.equal(r.results.find((x) => x.player_id === 3).place, 3);
});

test('excluded players are out of the pot and the places', () => {
  const rows = [{ player_id: 1, wins: 10, tbDiff: 0 }, { player_id: 2, wins: 9, tbDiff: 0 }];
  const r = calcPool(st(rows), { entry: 5, payouts: [100], exclude: [1] });
  assert.equal(r.pot, 5);
  assert.deepEqual(amounts(r), { 2: 5 });
});

test('payout shares are rescaled to 100% and the pot is fully paid out', () => {
  assert.deepEqual(normalizePool({ payouts: [2, 1, 1] }).payouts, [50, 25, 25]);
  const rows = [1, 2, 3, 4].map((id) => ({ player_id: id, wins: 10 - id, tbDiff: 0 }));
  const r = calcPool(st(rows), { entry: 7, payouts: [60, 30, 10] });
  assert.equal(Math.round(r.results.reduce((a, x) => a + x.amount, 0) * 100) / 100, r.pot);
});

test('bad input falls back to safe defaults', () => {
  const p = normalizePool({ entry: -3, payouts: 'x', ties: 'weird', exclude: 'no' });
  assert.deepEqual(p, { unit: '$', entry: 5, payouts: [100], ties: 'tiebreak', exclude: [] });
});

test('share links round-trip, including non-ASCII units', () => {
  const p = { unit: '🍺', entry: 2, payouts: [70, 30], ties: 'split', exclude: [4] };
  assert.deepEqual(decodePool(encodePool(p)), normalizePool(p));
  assert.equal(decodePool('not base64!!'), null);
});
