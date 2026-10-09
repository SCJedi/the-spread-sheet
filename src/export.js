// Spreadsheet-friendly exports of a week and a season. Pure functions over the views the API already builds.

// Names and labels are typed by users. A cell that starts with = + - @ (or a tab/return) would run as a formula
// when the file is opened in a spreadsheet, so it is prefixed with an apostrophe (OWASP "CSV injection").
export function csvCell(x) {
  let s = String(x ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
const line = (cells) => cells.map(csvCell).join(',');

// One row per player, one column per game, then tiebreak, wins and rank. A pick the viewer may not see yet is
// written as "hidden", exactly as the board shows it.
export function weekCsv(view) {
  const games = view.games;
  const pickOf = new Map(view.picks.map((p) => [`${p.player_id}:${p.game_id}`, p]));
  const tbOf = new Map(view.tiebreakers.map((t) => [t.player_id, t]));
  const who = new Map(view.players.map((p) => [p.id, p]));
  const out = [line(['Rank', 'Name', 'With', ...games.map((g) => `${g.away} @ ${g.home}`), 'Tiebreak', 'Wins', 'Losses', 'To play'])];
  out.push(line(['', 'Winning team', '', ...games.map((g) => g.manual_winner || (g.state === 'post' ? g.winner : '') || ''), view.standings.tiebreak.actual ?? '', '', '', '']));
  for (const r of view.standings.rows) {
    const p = who.get(r.player_id) || { name: '?', sponsor: '' };
    const pick = (gid) => { const x = pickOf.get(`${r.player_id}:${gid}`); return !x ? '' : x.hidden ? 'hidden' : x.team; };
    const tb = tbOf.get(r.player_id);
    out.push(line([r.rank, p.name, p.sponsor || '', ...games.map((g) => pick(g.id)), tb ? (tb.hidden ? 'hidden' : tb.total) : '', r.wins, r.losses, r.pending]));
  }
  return out.join('\r\n') + '\r\n';
}

export function seasonCsv(season) {
  const who = new Map(season.players.map((p) => [p.id, p]));
  const out = [line(['Rank', 'Name', 'Wins', 'Losses', 'Weeks won', 'Shared wins', 'Weeks played', 'Best week', 'Longest streak', 'Current streak', ...season.weeks.map((w) => w.label)])];
  for (const r of season.rows) {
    out.push(line([r.rank, who.get(r.player_id)?.name || '?', r.wins, r.losses, r.weeksWon, r.sharedWins, r.weeksPlayed,
      r.best ? `${r.best.label} (${r.best.wins}-${r.best.losses})` : '', r.longestStreak, r.streak,
      ...season.weeks.map((w) => (r.weekly[w.id] ? `${r.weekly[w.id].wins}-${r.weekly[w.id].losses}` : ''))]));
  }
  return out.join('\r\n') + '\r\n';
}

export const fileName = (s) => String(s).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
