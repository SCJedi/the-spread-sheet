// ESPN's public scoreboard feed: one of the data sources in src/sources.js. Unofficial and keyless.
// Only facts are taken (teams, kickoff, score, status). No logos or other ESPN or team artwork.
export const ESPN_FEED = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export const weekId = (season, type, week) => `${season}-${type}-${week}`;

export function weekLabel(type, week) {
  if (type === 3) return ['Wild Card', 'Divisional', 'Conference', 'Pro Bowl', 'Championship'][week - 1] || `Playoffs ${week}`;
  if (type === 1) return `Preseason ${week}`;
  return `Week ${week}`;
}

export const isEspnShape = (data) => !!(data && Array.isArray(data.events) && data.week && data.season);

export function parseEspn(data) {
  const season = data.season.year, type = data.season.type, week = data.week.number;
  const games = (data.events || []).map((e) => {
    const c = e.competitions[0];
    const side = (h) => c.competitors.find((t) => t.homeAway === h);
    const home = side('home'), away = side('away');
    const state = e.status.type.state; // pre | in | post
    let winner = null;
    if (state === 'post') winner = home.winner ? home.team.abbreviation : away.winner ? away.team.abbreviation : 'TIE';
    return {
      id: e.id, kickoff: Date.parse(e.date),
      home: home.team.abbreviation, home_name: home.team.shortDisplayName || home.team.name || '', home_color: home.team.color || '',
      away: away.team.abbreviation, away_name: away.team.shortDisplayName || away.team.name || '', away_color: away.team.color || '',
      home_score: state === 'pre' ? null : Number(home.score), away_score: state === 'pre' ? null : Number(away.score),
      state, detail: e.status.type.shortDetail || '', winner,
    };
  });
  return { season, type, week, id: weekId(season, type, week), label: weekLabel(type, week), games };
}

export function espnUrl(opts = {}) {
  const u = new URL(ESPN_FEED);
  if (opts.week) { u.searchParams.set('week', opts.week); u.searchParams.set('seasontype', opts.type || 2); u.searchParams.set('dates', opts.season); }
  return u.toString();
}
