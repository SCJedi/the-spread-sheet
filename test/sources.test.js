import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeed, winnerFrom, fillUrl, FeedError } from '../src/sources.js';

const game = (over = {}) => ({ id: 'g1', home: 'BUF', away: 'NE', kickoff: '2026-10-11T17:00:00Z', ...over });
const feed = (games, over = {}) => ({ season: 2026, type: 2, week: 5, games, ...over });

test('a valid custom feed becomes a week', () => {
  const w = normalizeFeed(feed([game(), game({ id: 'g2', home: 'kc', away: 'lv', state: 'post', home_score: 24, away_score: 24 })]));
  assert.equal(w.id, '2026-2-5');
  assert.equal(w.label, 'Week 5');
  assert.equal(w.games[0].id, 'c-g1'); // namespaced so feed ids never collide with ESPN or manual ids
  assert.equal(w.games[0].state, 'pre');
  assert.equal(w.games[0].home_score, null);
  assert.equal(w.games[1].home, 'KC'); // codes are upper-cased
  assert.equal(w.games[1].winner, 'TIE');
});

test('bad feeds are rejected with a message the commissioner can act on', () => {
  const bad = [
    [null, /JSON object/],
    [feed([game()], { season: 'x' }), /season/],
    [feed([game()], { week: 99 }), /week/],
    [feed([game()], { type: 7 }), /type/],
    [feed('nope'), /list/],
    [feed([game({ id: '' })]), /needs an "id"/],
    [feed([game(), game()]), /used twice/],
    [feed([game({ home: 'Buffalo Bills' })]), /short team codes/],
    [feed([game({ home: 'NE' })]), /cannot play itself/],
    [feed([game({ kickoff: 'soon' })]), /kickoff/],
    [feed([game({ state: 'post', home_score: 'lots' })]), /numbers/],
    [feed([game({ state: 'post', winner: 'KC' })]), /winner/],
  ];
  for (const [input, msg] of bad) assert.throws(() => normalizeFeed(input), (e) => e instanceof FeedError && msg.test(e.message), String(msg));
});

test('winner comes from the scores when the feed does not say', () => {
  assert.equal(winnerFrom('post', 'BUF', 'NE', 20, 17), 'BUF');
  assert.equal(winnerFrom('post', 'BUF', 'NE', 10, 17), 'NE');
  assert.equal(winnerFrom('post', 'BUF', 'NE', 17, 17), 'TIE');
  assert.equal(winnerFrom('in', 'BUF', 'NE', 20, 17), null);
  assert.equal(winnerFrom('post', 'BUF', 'NE', null, 17), null);
  assert.equal(winnerFrom('post', 'BUF', 'NE', 0, 17, 'BUF'), 'BUF'); // an explicit winner wins
});

test('ESPN-shaped JSON is recognised from a custom URL too', () => {
  const espn = { season: { year: 2026, type: 2 }, week: { number: 4 }, events: [{ id: '9', date: '2026-10-02T00:15Z',
    status: { type: { state: 'post', shortDetail: 'Final' } },
    competitions: [{ competitors: [
      { homeAway: 'home', score: '27', winner: true, team: { abbreviation: 'CLE', shortDisplayName: 'Browns', color: '472a08' } },
      { homeAway: 'away', score: '24', winner: false, team: { abbreviation: 'PIT', shortDisplayName: 'Steelers', color: '000000' } },
    ] }] }] };
  const w = normalizeFeed(espn);
  assert.equal(w.id, '2026-2-4');
  assert.equal(w.games[0].winner, 'CLE');
  assert.ok(!('home_logo' in w.games[0]), 'no logos are carried');
});

test('URL placeholders fill for a chosen week and empty for the current week', () => {
  const t = 'https://x.test/nfl?season={season}&week={week}&type={type}';
  assert.equal(fillUrl(t, { season: 2026, week: 5, type: 2 }), 'https://x.test/nfl?season=2026&week=5&type=2');
  assert.equal(fillUrl(t, {}), 'https://x.test/nfl?season=&week=&type=');
});

test('feed URLs must be https, except localhost for testing', async () => {
  const { feedUrlOk } = await import('../src/sources.js');
  for (const u of ['https://a.com/x', 'http://localhost:8799/f.json', 'http://127.0.0.1/x']) assert.equal(feedUrlOk(u), true, u);
  for (const u of ['http://example.com/x', 'ftp://x', 'https://', '', 'javascript:alert(1)']) assert.equal(feedUrlOk(u), false, u);
});
