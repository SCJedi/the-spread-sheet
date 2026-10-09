import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, weekCsv, seasonCsv, fileName } from '../src/export.js';

test('CSV cells are quoted, and formula-looking text is defused', () => {
  assert.equal(csvCell('Bob'), '"Bob"');
  assert.equal(csvCell('Say "hi"'), '"Say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  for (const s of ['+1', '-2', '@SUM(A1)']) assert.ok(csvCell(s).startsWith('"\''), s);
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(7), '"7"');
});

const view = {
  games: [{ id: 'g1', away: 'PIT', home: 'CLE', state: 'post', winner: 'CLE' }, { id: 'g2', away: 'NE', home: 'BUF', state: 'pre', winner: null }],
  players: [{ id: 1, name: 'Ann', sponsor: '' }, { id: 2, name: '=evil', sponsor: 'Ryan' }],
  picks: [{ player_id: 1, game_id: 'g1', team: 'CLE' }, { player_id: 1, game_id: 'g2', team: 'BUF' }, { player_id: 2, game_id: 'g1', team: 'PIT' }, { player_id: 2, game_id: 'g2', hidden: true }],
  tiebreakers: [{ player_id: 1, total: 44 }, { player_id: 2, hidden: true }],
  standings: { tiebreak: { actual: null }, rows: [{ player_id: 1, rank: 1, wins: 1, losses: 0, pending: 1 }, { player_id: 2, rank: 2, wins: 0, losses: 1, pending: 0 }] },
};

test('week CSV: winners row, picks per game, hidden stays hidden, names defused', () => {
  const rows = weekCsv(view).trim().split('\r\n');
  assert.equal(rows.length, 4);
  assert.equal(rows[0], '"Rank","Name","With","PIT @ CLE","NE @ BUF","Tiebreak","Wins","Losses","To play"');
  assert.equal(rows[1], '"","Winning team","","CLE","","","","",""');
  assert.equal(rows[2], '"1","Ann","","CLE","BUF","44","1","0","1"');
  assert.equal(rows[3], '"2","\'=evil","Ryan","PIT","hidden","hidden","0","1","0"');
});

test('season CSV: totals and a column per week', () => {
  const season = { players: [{ id: 1, name: 'Ann' }], weeks: [{ id: 'w4', label: 'Week 4' }, { id: 'w5', label: 'Week 5' }],
    rows: [{ player_id: 1, rank: 1, wins: 20, losses: 12, weeksWon: 1, sharedWins: 0, weeksPlayed: 2, best: { label: 'Week 4', wins: 12, losses: 4 }, longestStreak: 7, streak: 2, weekly: { w4: { wins: 12, losses: 4 }, w5: { wins: 8, losses: 8 } } }] };
  const rows = seasonCsv(season).trim().split('\r\n');
  assert.match(rows[0], /"Week 4","Week 5"$/);
  assert.equal(rows[1], '"1","Ann","20","12","1","0","2","Week 4 (12-4)","7","2","12-4","8-8"');
});

test('file names are safe', () => {
  assert.equal(fileName('Sunday Picks Pool / Week 4'), 'Sunday-Picks-Pool-Week-4');
  assert.equal(fileName('***'), 'export');
});
