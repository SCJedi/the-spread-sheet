// Pure scoring logic. No I/O, so it is unit-tested directly (test/scoring.test.js).

// The team that won a game, 'TIE' for a tie, or null while undecided.
// A commissioner's manual winner overrides the feed.
export function gameWinner(g) {
  if (g.manual_winner) return g.manual_winner;
  if (g.state === 'post') return g.winner || null;
  return null;
}

export function isFinal(g) {
  return gameWinner(g) !== null;
}

// A game locks at kickoff, or earlier if the feed says it has started.
export function isLocked(g, now = Date.now()) {
  return now >= g.kickoff || g.state !== 'pre';
}

// The tiebreak game is the week's last kickoff (Monday night) unless the commissioner picked one.
export function tiebreakGame(games, chosenId) {
  if (chosenId) {
    const g = games.find((x) => x.id === chosenId);
    if (g) return g;
  }
  return [...games].sort((a, b) => b.kickoff - a.kickoff || (a.id < b.id ? 1 : -1))[0] || null;
}

export function tiebreakActual(g) {
  if (!g || !isFinal(g) || g.home_score == null || g.away_score == null) return null;
  return Number(g.home_score) + Number(g.away_score);
}

/**
 * Scores one week.
 * entrants: [{id}] players who submitted at least one pick this week
 * picks:    [{player_id, game_id, team}]
 * tiebreakers: [{player_id, total}]
 * Returns rows sorted best-first, plus the winners once every game is final.
 */
export function scoreWeek({ games, entrants, picks, tiebreakers, tiebreakGameId }) {
  const winners = new Map(games.map((g) => [g.id, gameWinner(g)]));
  const tbGame = tiebreakGame(games, tiebreakGameId);
  const actual = tiebreakActual(tbGame);
  const tbBy = new Map(tiebreakers.map((t) => [t.player_id, t.total]));
  const picksBy = new Map();
  for (const p of picks) {
    if (!picksBy.has(p.player_id)) picksBy.set(p.player_id, new Map());
    picksBy.get(p.player_id).set(p.game_id, p.team);
  }

  const rows = entrants.map((e) => {
    const mine = picksBy.get(e.id) || new Map();
    let wins = 0, losses = 0, pending = 0;
    for (const g of games) {
      const w = winners.get(g.id);
      const pick = mine.get(g.id);
      if (w === null) { if (pick) pending++; continue; }
      if (pick && pick === w) wins++;
      else losses++; // a missed pick on a decided game counts as a loss, never a win
    }
    const tb = tbBy.has(e.id) ? tbBy.get(e.id) : null;
    const tbDiff = actual != null && tb != null ? Math.abs(tb - actual) : null;
    return { player_id: e.id, wins, losses, pending, max: wins + pending, tb, tbDiff };
  });

  const allFinal = games.length > 0 && games.every((g) => winners.get(g.id) !== null);
  const diffKey = (r) => (r.tbDiff == null ? Infinity : r.tbDiff);
  rows.sort((a, b) => b.wins - a.wins || diffKey(a) - diffKey(b) || a.player_id - b.player_id);

  const topWins = rows.length ? rows[0].wins : 0;
  for (const r of rows) r.alive = r.max >= topWins;

  // Rank: same wins and same tiebreak distance share a rank (once the tiebreak is known).
  let rank = 0;
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const same = prev && prev.wins === r.wins && (actual == null || diffKey(prev) === diffKey(r));
    rank = same ? rank : i + 1;
    r.rank = rank;
  });

  let weekWinners = [];
  if (allFinal && rows.length) {
    const best = rows.filter((r) => r.wins === topWins);
    const bestDiff = Math.min(...best.map(diffKey));
    weekWinners = best.filter((r) => diffKey(r) === bestDiff).map((r) => r.player_id);
  }

  return {
    rows,
    final: allFinal,
    winners: weekWinners,
    tiebreak: { game_id: tbGame ? tbGame.id : null, actual },
  };
}

/**
 * Season totals across weeks. weeks: [{ id, label, games, entrants, picks, tiebreakers, tiebreakGameId }]
 * in calendar order. Only decided games count; pending games are ignored until they finish.
 * Returns players ranked by total correct picks, then weeks won.
 */
export function seasonStats(weeks) {
  const by = new Map();
  const get = (id) => {
    if (!by.has(id)) by.set(id, { player_id: id, wins: 0, losses: 0, weeksPlayed: 0, weeksWon: 0, sharedWins: 0, weekly: {}, best: null, worst: null, longestStreak: 0, streak: 0 });
    return by.get(id);
  };
  const weekInfo = [];
  for (const w of weeks) {
    const sc = scoreWeek(w);
    weekInfo.push({ id: w.id, label: w.label, final: sc.final, winners: sc.winners });
    const picksBy = new Map(w.picks.map((p) => [`${p.player_id}:${p.game_id}`, p.team]));
    const ordered = [...w.games].sort((a, b) => a.kickoff - b.kickoff || (a.id < b.id ? -1 : 1));
    for (const r of sc.rows) {
      const s = get(r.player_id);
      s.wins += r.wins; s.losses += r.losses; s.weeksPlayed++;
      s.weekly[w.id] = { wins: r.wins, losses: r.losses, pending: r.pending, rank: r.rank, won: sc.winners.includes(r.player_id) };
      if (sc.winners.includes(r.player_id)) { s.weeksWon++; if (sc.winners.length > 1) s.sharedWins++; }
      // Best and worst only count finished weeks, so a half-played week can't look like a slump.
      if (sc.final) {
        const rec = { week: w.id, label: w.label, wins: r.wins, losses: r.losses };
        if (!s.best || r.wins > s.best.wins) s.best = rec;
        if (!s.worst || r.wins < s.worst.wins) s.worst = rec;
      }
      // Streak of correct picks in kickoff order across the season. A miss or a loss ends it.
      for (const g of ordered) {
        const win = gameWinner(g);
        if (win === null) continue;
        const pick = picksBy.get(`${r.player_id}:${g.id}`);
        if (pick && pick === win) { s.streak++; if (s.streak > s.longestStreak) s.longestStreak = s.streak; }
        else s.streak = 0;
      }
    }
  }
  const rows = [...by.values()].sort((a, b) => b.wins - a.wins || b.weeksWon - a.weeksWon || a.losses - b.losses || a.player_id - b.player_id);
  let rank = 0;
  rows.forEach((r, i) => { const p = rows[i - 1]; rank = p && p.wins === r.wins && p.weeksWon === r.weeksWon ? rank : i + 1; r.rank = rank; });
  return { weeks: weekInfo, rows };
}
