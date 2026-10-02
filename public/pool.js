// Pool calculator. It runs only in the viewer's browser: the app stores no money and no pool data.
// Anyone can model a real or pretend pool on top of the standings; the server never sees it.

export const DEFAULT_POOL = { unit: '$', entry: 5, payouts: [100], ties: 'tiebreak', exclude: [] };

export const PAYOUT_PRESETS = [
  { label: 'Winner takes all', payouts: [100] },
  { label: 'Top 2 · 70 / 30', payouts: [70, 30] },
  { label: 'Top 3 · 60 / 30 / 10', payouts: [60, 30, 10] },
  { label: 'Top 3 · 50 / 30 / 20', payouts: [50, 30, 20] },
];

// Cleans a pool from any source (a share link, storage, the commissioner) so bad input cannot break the board.
export function normalizePool(p) {
  const src = p && typeof p === 'object' ? p : {};
  let payouts = Array.isArray(src.payouts) ? src.payouts.map(Number).filter((x) => Number.isFinite(x) && x > 0).slice(0, 10) : [];
  if (!payouts.length) payouts = [100];
  const sum = payouts.reduce((a, b) => a + b, 0);
  payouts = payouts.map((x) => (x * 100) / sum); // always shares of 100%
  const entry = Number(src.entry);
  return {
    unit: String(src.unit ?? DEFAULT_POOL.unit).slice(0, 12),
    entry: Number.isFinite(entry) && entry >= 0 ? entry : DEFAULT_POOL.entry,
    payouts,
    ties: src.ties === 'split' ? 'split' : 'tiebreak',
    exclude: Array.isArray(src.exclude) ? src.exclude.map(Number).filter(Number.isInteger) : [],
  };
}

/**
 * Splits a pot over the standings.
 * standings: scoreWeek() output (rows sorted best-first, with wins and tbDiff).
 * ties 'tiebreak': players are separated by tiebreak distance once it is known.
 * ties 'split': equal wins share their places evenly, tiebreak ignored.
 * Tied players pool the payouts of every place they occupy and share it equally.
 */
export function calcPool(standings, pool) {
  const p = normalizePool(pool);
  const rows = standings.rows.filter((r) => !p.exclude.includes(r.player_id));
  const pot = p.entry * rows.length;
  const key = (r) => (p.ties === 'split' ? `${r.wins}` : `${r.wins}|${r.tbDiff ?? 'none'}`);
  const results = [];
  let slot = 0;
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j < rows.length && key(rows[j]) === key(rows[i])) j++;
    const group = rows.slice(i, j);
    const share = p.payouts.slice(slot, slot + group.length).reduce((a, b) => a + b, 0);
    const each = (pot * share) / 100 / group.length;
    for (const r of group) results.push({ player_id: r.player_id, place: slot + 1, amount: each, tied: group.length > 1 });
    slot += group.length;
    i = j;
  }
  return { pot, count: rows.length, final: standings.final, results };
}

// Share links carry the settings in the URL, so a pool can be passed around without storing it anywhere.
export const encodePool = (p) => btoa(unescape(encodeURIComponent(JSON.stringify(normalizePool(p))))).replace(/=+$/, '');
export function decodePool(s) {
  try { return normalizePool(JSON.parse(decodeURIComponent(escape(atob(s))))); } catch { return null; }
}
