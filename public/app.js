// Single-page front end. No build step: plain ES modules served as static files.
import { DEFAULT_POOL, PAYOUT_PRESETS, normalizePool, calcPool, encodePool, decodePool } from './pool.js';
import { BRAND, brandLink } from './brand.js';
import { THEMES, findTheme, buildTheme, applyTheme, loadChoice, saveChoice, teamEdge, teamBadge } from './theme.js';
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let S = null;          // last /api/state response
let A = null;          // last /api/admin response
let adminTab = 'week';
let pollTimer = null;

// ---------- utilities ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// replaceChildren() turns null into the text "null" and arrays into "[object …]" text, so every
// conditional or list child goes through this.
function setKids(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false && k !== ''));
}

async function api(path, body) {
  const res = await fetch('/api' + path, body === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  $toast.textContent = msg;
  $toast.className = err ? 'err' : '';
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), err ? 4500 : 1800);
}

// Amounts in whatever unit the viewer's pool uses: "$12.50", "€3", "40 pts", "2 🍺".
function amt(n, unit) {
  const cash = /^[$€£¥]$/.test(unit);
  const v = Number(n || 0);
  const num = v.toLocaleString(undefined, { minimumFractionDigits: cash && !Number.isInteger(v) ? 2 : 0, maximumFractionDigits: 2 });
  return cash ? unit + num : unit ? `${num} ${unit}` : num;
}
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const kick = (g) => `${dayFmt.format(g.kickoff)} ${timeFmt.format(g.kickoff)}`;
const winnerOf = (g) => g.manual_winner || (g.state === 'post' ? g.winner : null);

function route() {
  const [path, q] = location.hash.replace(/^#/, '').split('?');
  return { path: path || '/', week: new URLSearchParams(q || '').get('week') };
}
function go(path, week) {
  calc.custom = false;
  const w = week || (S && S.view && S.view.week.id);
  location.hash = path + (w && S && w !== S.league.current_week ? `?week=${w}` : '');
}

// ---------- data ----------
async function load() {
  const r = route();
  S = await api('/state' + (r.week ? `?week=${encodeURIComponent(r.week)}` : ''));
  if (!themeChoice.id) paintTheme();
  if (r.path === '/admin' && S.me && S.me.is_admin) A = await api('/admin' + (S.view ? `?week=${S.view.week.id}` : ''));
  render();
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const live = S && S.view && S.view.games.some((g) => g.state === 'in');
  pollTimer = setTimeout(async () => {
    if (route().path === '/' && document.visibilityState === 'visible') await load().catch(() => {});
    else schedulePoll();
  }, live ? 60e3 : 300e3);
}

// ---------- themes ----------
// The viewer's own choice wins; otherwise the commissioner's site default; otherwise Neon Kickoff.
let themeChoice = loadChoice(); // { id, mode: 'auto' | 'light' | 'dark' }
const themeId = () => themeChoice.id || (S && S.league.default_theme) || 'DEFAULT';
const themeMode = () => themeChoice.mode || 'auto';
function paintTheme() { applyTheme(themeId(), themeMode()); }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeMode() === 'auto') { paintTheme(); if (S) render(); } });
paintTheme();

function setTheme(next) {
  themeChoice = { ...themeChoice, ...next };
  saveChoice(themeChoice);
  paintTheme();
  render();
  openThemes(); // redraw the sheet with the new selection
}

const $themes = document.getElementById('themes');
function openThemes() {
  const cur = themeId(), mode = themeMode();
  const swatch = (t) => {
    const v = buildTheme(t.abbr, 'light').vars;
    return h('button', {
      class: 'swatch' + (t.abbr === cur ? ' on' : ''), style: `--a:${v['--top']};--b:${v['--top-2']};--s:${v['--stripe']}`,
      'aria-pressed': t.abbr === cur ? 'true' : 'false', 'aria-label': `${t.theme}: ${t.colors}${t.city ? `, ${t.city}` : ''}`, onclick: () => setTheme({ id: t.abbr }),
    }, h('i', { class: 'spark' }), h('b', {}, t.theme), h('small', {}, t.colors), t.city ? h('small', { class: 'city' }, t.city) : null);
  };
  $themes.replaceChildren(
    h('div', { class: 'sheet-head' },
      h('h2', { id: 'themesTitle' }, 'Theme'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Light or dark' },
        [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => h('button', { class: mode === k ? 'on' : '', 'aria-pressed': mode === k ? 'true' : 'false', onclick: () => setTheme({ mode: k }) }, l))),
      h('button', { class: 'iconbtn', style: 'color:var(--ink)', 'aria-label': 'Close', autofocus: true, onclick: () => $themes.close() }, '✕')),
    h('div', { class: 'sheet-body' },
      h('p', { class: 'muted small', style: 'margin:0' }, 'Pick a color theme. Every theme is tuned so text stays easy to read in light and dark. Saved on this device only.',
        themeChoice.id ? [' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); themeChoice = { mode: themeChoice.mode }; saveChoice(themeChoice); paintTheme(); render(); openThemes(); } }, 'Use the site default')] : null),
      h('div', { class: 'swatches' }, THEMES.map(swatch))));
  if (!$themes.open) $themes.showModal();
}
document.getElementById('themeBtn').addEventListener('click', openThemes);
$themes.addEventListener('click', (e) => { if (e.target === $themes) $themes.close(); }); // tap outside to close

// ---------- shell ----------
// Our own simple line icons.
const ICONS = {
  board: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M3 15h18M9.5 4v16"/>',
  picks: '<ellipse cx="12" cy="12" rx="9.5" ry="5.6" transform="rotate(-35 12 12)"/><path d="M9.3 14.7l5.4-5.4M10.6 11.6l1.8 1.8M12.4 9.8l1.8 1.8"/>',
  admin: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  me: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20.5c.9-3.7 3.7-6 7-6s6.1 2.3 7 6"/>',
};
const icon = (name) => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor'); el.setAttribute('stroke-width', '2'); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = ICONS[name]; return el; };

function render() {
  // The product brand stays at the top of every page; the pool's own name sits beside it (unless it is the default).
  const ownName = S.league.name && S.league.name !== BRAND.product;
  document.title = ownName ? `${S.league.name} · ${BRAND.product}` : BRAND.product;
  setKids(document.getElementById('brand'),
    h('span', { class: 'wordmark hdr', 'aria-hidden': 'true' }, wordmark()),
    h('span', { class: 'sr' }, BRAND.product),
    ownName ? h('span', { class: 'league' }, S.league.name) : null);
  document.getElementById('footer').replaceChildren(disclaimer());
  const r = route();
  const link = (href, ic, long, short = long) => h('a', { href: '#' + href, class: r.path === href ? 'on' : '', 'aria-current': r.path === href ? 'page' : null },
    icon(ic), h('span', { class: 'lbl-long' }, long), h('span', { class: 'lbl-short' }, short));
  $nav.replaceChildren(...[
    link('/', 'board', 'Board'),
    link('/picks', 'picks', 'My picks', 'Picks'),
    S.me && S.me.is_admin ? link('/admin', 'admin', 'Admin') : null,
    S.me ? link('/account', 'me', S.me.name, 'Me') : link('/login', 'me', 'Log in'),
  ].filter(Boolean));
  const view = { '/': board, '/picks': picks, '/admin': admin, '/login': login, '/account': account, '/about': about }[r.path] || board;
  $app.replaceChildren(view());
  measureSticky();
  if (view === board && boardView === 'games' && boardFilter) applyFilter();
}

// Sticky offsets for the board header and the viewer's own row, measured rather than guessed.
function measureSticky() {
  const top = document.querySelector('.top');
  if (top) document.documentElement.style.setProperty('--hdr-h', `${top.offsetHeight}px`);
  const head = document.querySelector('.lb-head');
  if (head) document.documentElement.style.setProperty('--lbh-h', `${head.offsetHeight}px`);
}
window.addEventListener('resize', measureSticky);

const SOURCE_LABEL = { espn: "ESPN's public scoreboard (unofficial)", custom: 'a custom data feed', manual: 'the commissioner, by hand' };
function disclaimer() {
  return h('div', {}, makerCredit('footer'), h('p', {},
    h('b', {}, 'Just for fun. '), 'No money is handled here. Not affiliated with, endorsed by or sponsored by the NFL, any team, or ESPN. ',
    'Team names and codes are used only to identify real games, and colors only to describe themes. ',
    `Scores come from ${SOURCE_LABEL[S.league.source] || SOURCE_LABEL.espn}. `, h('a', { href: '#/about' }, 'About'), '.'));
}

// The maker credit. MIT-licensed: please keep it, it is how people who like this find the people who built it.
function makerCredit(spot) {
  return h('p', { class: 'credit' },
    h('a', { class: 'wordmark sm', href: '#/about', 'aria-label': `${BRAND.product}: about` }, wordmark()),
    h('span', {}, ' · free and open source · made by ', h('a', { class: 'iv-mark', href: brandLink(BRAND.site, spot), target: '_blank', rel: 'noopener' }, ivMark())),
    h('a', { class: 'credit-cta', href: brandLink(BRAND.schedule, spot), target: '_blank', rel: 'noopener' }, 'Want software like this? Let’s talk →'));
}
// Text logo until a final logo file exists: "THE SPREAD" over "SHEET", with the theme stripe.
// The maker's text logo, as on infinitevisionsaiagents.com.
const ivMark = () => ['Infinite Visions ', h('span', { class: 'iv-ai' }, 'AI')];
const wordmark = () => [h('span', { class: 'wm-1' }, 'The Spread'), h('span', { class: 'wm-2' }, 'Sheet')];

function makerCard(spot, title, body) {
  return h('div', { class: 'card maker' },
    h('p', { class: 'micro' }, 'Built by ', h('span', { class: 'iv-mark' }, ivMark())),
    h('h2', {}, title),
    h('p', {}, body),
    h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: brandLink(BRAND.schedule, spot), target: '_blank', rel: 'noopener' }, BRAND.cta),
      h('a', { class: 'btn', href: brandLink(BRAND.site, spot), target: '_blank', rel: 'noopener' }, 'See what we build')));
}

function about() {
  return h('div', { class: 'about' },
    h('div', { class: 'card hero' },
      h('div', { class: 'wordmark lg', role: 'img', 'aria-label': BRAND.product }, wordmark()),
      h('p', { class: 'hero-tag' }, BRAND.tagline),
      h('p', { class: 'muted' }, BRAND.promise),
      h('ul', { class: 'feats' },
        h('li', {}, h('b', {}, 'Everyone sees the board, anytime.'), ' No logins needed to look.'),
        h('li', {}, h('b', {}, 'Your picks are yours.'), ' Each player edits only their own row, and picks lock at kickoff.'),
        h('li', {}, h('b', {}, 'Scores fill in by themselves.'), ' Wins, ties and the tiebreaker are worked out for you.'),
        h('li', {}, h('b', {}, 'Free to run.'), ' Hosts on a free account, with nothing to look after.')),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: brandLink(BRAND.repo, 'about-repo'), target: '_blank', rel: 'noopener' }, 'Get your own copy, free'))),
    makerCard('about', BRAND.makerLine,
      `${BRAND.product} is a free giveaway from ${BRAND.maker}, a small Sarasota, Florida studio that builds custom software and AI agents for businesses. If you like how this works and want something built for your business, club or team, we'd love to hear about it.`),
    h('div', { class: 'card' }, h('h2', {}, 'Fine print'), disclaimerText()));
}
const disclaimerText = () => h('p', { class: 'muted small' },
  'Just for fun: no money is handled and nothing here is betting. Not affiliated with, endorsed by or sponsored by the NFL, any team, or ESPN. ',
  'Team names and codes are used only to identify real games, and colors only to describe themes. ',
  `Provided as-is under the MIT License, © ${new Date().getFullYear()} ${BRAND.makerLegal}.`);

const paletteIcon = () => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('width', '18'); el.setAttribute('height', '18'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor'); el.setAttribute('stroke-width', '2'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = '<circle cx="9" cy="9.5" r="5.2"/><circle cx="15" cy="9.5" r="5.2"/><circle cx="12" cy="14.6" r="5.2"/>'; return el; };

function account() {
  if (!S.me) { setTimeout(() => go('/login')); return h('p', {}, 'Not logged in.'); }
  return h('div', { class: 'auth' },
    h('div', { class: 'card' }, h('h2', {}, S.me.name), h('p', { class: 'muted' }, S.me.is_admin ? 'Commissioner' : 'Player'),
      h('div', { class: 'row' },
        h('button', { onclick: openThemes }, paletteIcon(), 'Theme'),
        h('button', { onclick: async () => { await api('/logout', {}); go('/'); await load(); } }, 'Log out'))),
    h('div', { class: 'card' }, h('h2', {}, 'Change my PIN'), pinForm()),
    h('p', { class: 'muted small' }, h('a', { href: '#/about' }, `About ${BRAND.product}`)));
}

function weekNav(path) {
  if (!S.weeks.length) return null;
  const cur = S.view ? S.view.week.id : '';
  const i = S.weeks.findIndex((w) => w.id === cur);
  const step = (d) => { const w = S.weeks[i + d]; if (w) go(path, w.id); };
  return h('div', { class: 'weeknav' },
    h('button', { onclick: () => step(-1), disabled: i <= 0, 'aria-label': 'Previous week' }, '‹'),
    h('select', { onchange: (e) => go(path, e.target.value), 'aria-label': 'Week' },
      S.weeks.map((w) => h('option', { value: w.id, selected: w.id === cur }, `${w.season} · ${w.label}`))),
    h('button', { onclick: () => step(1), disabled: i < 0 || i >= S.weeks.length - 1, 'aria-label': 'Next week' }, '›'),
  );
}

function banners() {
  const out = [];
  if (S.league.demo) {
    const mins = Math.max(1, Math.round((S.league.demo.reset_at + S.league.demo.every_ms - Date.now()) / 60000));
    out.push(h('div', { class: 'banner demo' }, h('b', {}, 'Live demo. '), `Made-up players and picks, resetting in about ${mins} min. `,
      S.me ? null : [h('a', { href: '#/login' }, 'Try it as a player'), '. '],
      h('a', { href: brandLink(BRAND.repo, 'demo-banner') , target: '_blank', rel: 'noopener' }, 'Get your own free copy →')));
  }
  if (S.league.recovery_pin_set) out.push(h('div', { class: 'banner warn' }, h('b', {}, 'RECOVERY_PIN is still set. '), 'Delete it in the Cloudflare dashboard (Workers & Pages → your project → Settings → Variables and Secrets), so nobody else can use it.'));
  if (S.last_winners) out.push(h('div', { class: 'banner' }, `🏆 Congratulations to ${S.last_winners.week}'s winner${S.last_winners.names.length > 1 ? 's' : ''}: `, h('b', {}, S.last_winners.names.join(' & '))));
  if (S.view && S.view.week.message) out.push(h('div', { class: 'banner' }, S.view.week.message));
  return out;
}

// ---------- pool calculator ----------
// Just math in the viewer's browser. Nothing about a pool is stored on the server or sent anywhere,
// except the commissioner's optional suggested settings.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const calc = { open: !!store.get('sp_calc_open'), pool: null, custom: false, expanded: store.get('sp_calc_expanded') ?? undefined };
function initCalc() {
  if (calc.pool) return;
  const shared = new URLSearchParams(location.hash.split('?')[1] || '').get('pool');
  const fromLink = shared && decodePool(shared);
  if (fromLink) { calc.pool = fromLink; calc.open = true; toast('Loaded a shared pool calculation'); return; }
  calc.pool = normalizePool(store.get('sp_pool') || S.league.calc_preset || DEFAULT_POOL);
}
function setPool(next) {
  calc.pool = normalizePool({ ...calc.pool, ...next });
  store.set('sp_pool', calc.pool);
  render();
}
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const placeGroups = (rs) => rs.reduce((gs, r) => { const g = gs.at(-1); if (g && g[0].place === r.place) g.push(r); else gs.push([r]); return gs; }, []);
const sameShares = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 0.01);
const poolSummary = (p) => `${amt(p.entry, p.unit)} each · ${p.payouts.map((x) => Math.round(x)).join('/')} · ${p.ties === 'split' ? 'ties split' : 'tiebreak decides'}`;

function calcPanel(result, byPlayer) {
  const p = calc.pool;
  const preset = PAYOUT_PRESETS.findIndex((x) => sameShares(normalizePool(x).payouts, p.payouts));
  const custom = calc.custom || preset < 0;
  const paid = result.results.filter((r) => r.amount > 0);
  const share = async () => {
    const url = `${location.origin}${location.pathname}#/?${new URLSearchParams({ ...(S.view.week.id !== S.league.current_week ? { week: S.view.week.id } : {}), pool: encodePool(p) })}`;
    try { await navigator.clipboard.writeText(url); toast('Share link copied'); } catch { prompt('Copy this link', url); }
  };
  const summary = [
    h('b', {}, `Pot ${amt(result.pot, p.unit)}`), ` · ${result.count} in${p.exclude.length ? ` (${p.exclude.length} left out)` : ''} · `,
    result.final ? 'Final: ' : 'If it ended now: ',
    paid.length ? placeGroups(paid).slice(0, 3).map((g, i) => [i ? ' · ' : '', ordinal(g[0].place), ' ',
      g.length === 1 ? h('b', {}, byPlayer.get(g[0].player_id)?.name || '?') : h('b', {}, `${g.length} tied`),
      ` ${amt(g[0].amount, p.unit)}${g.length > 1 ? ' each' : ''}`]) : 'nobody yet',
  ];
  // Collapsible so the board stays above the fold on phones. Open by default on wide screens.
  const expanded = calc.expanded ?? window.matchMedia('(min-width: 721px)').matches;
  return h('details', { class: 'card calc', open: expanded, ontoggle: (e) => { calc.expanded = e.target.open; store.set('sp_calc_expanded', calc.expanded); } },
    h('summary', { class: 'calc-sum' }, h('span', { class: 'micro calc-title' }, 'Pool calculator'), h('span', {}, summary)),
    h('div', { class: 'calc-body' },
      h('div', { class: 'row calc-fields' },
        h('label', {}, 'Per entry', h('input', { type: 'number', min: 0, step: 'any', value: p.entry, onchange: (e) => setPool({ entry: e.target.value }) })),
        h('label', {}, 'Unit', h('input', { value: p.unit, maxlength: 12, placeholder: '$, pts, 🍺', onchange: (e) => setPool({ unit: e.target.value }) })),
        h('label', {}, 'Payout', h('select', { onchange: (e) => { const i = Number(e.target.value); calc.custom = i < 0; if (i >= 0) setPool({ payouts: PAYOUT_PRESETS[i].payouts }); else render(); } },
          PAYOUT_PRESETS.map((x, i) => h('option', { value: i, selected: !custom && i === preset }, x.label)),
          h('option', { value: -1, selected: custom }, 'Custom split…'))),
        custom ? h('label', {}, 'Split (%)', h('input', { value: p.payouts.map((x) => Math.round(x * 100) / 100).join(', '), placeholder: '50, 30, 20', onchange: (e) => setPool({ payouts: e.target.value.split(/[ ,/]+/) }) })) : null,
        h('label', {}, 'Ties', h('select', { onchange: (e) => setPool({ ties: e.target.value }) },
          h('option', { value: 'tiebreak', selected: p.ties === 'tiebreak' }, 'Tiebreak decides'),
          h('option', { value: 'split', selected: p.ties === 'split' }, 'Split evenly')))),
      h('div', { class: 'row' },
        S.league.calc_preset ? h('button', { onclick: () => { calc.custom = false; setPool({ ...S.league.calc_preset, exclude: [] }); toast("Using the commissioner's suggestion"); } }, "Use commissioner's suggestion") : null,
        h('button', { onclick: share }, 'Copy share link'),
        p.exclude.length ? h('button', { onclick: () => setPool({ exclude: [] }) }, 'Include everyone') : null,
        S.me && S.me.is_admin ? h('button', { onclick: () => act('/admin/settings', { calc_preset: { ...p, exclude: [] } }, 'Saved as the suggestion for everyone') }, 'Save as suggestion for everyone') : null),
      h('p', { class: 'muted small' },
        S.league.calc_preset ? `Commissioner's suggestion: ${poolSummary(normalizePool(S.league.calc_preset))}. ` : '',
        'Untick a player in the In column to leave them out. Try any pool, real or pretend: this is math in your browser only, and nothing is saved to the site or sent to anyone.')));
}

// ---------- board ----------
// Two views of the same week. Standings: a ranked list where rank, name, W, TB and the pool columns are
// always visible, with a per-game result strip in each row (tap a row for that player's picks).
// Games: how the group split on each game (tap a game for who picked what).
let boardFilter = '';
let boardView = store.get('sp_board_view') === 'games' ? 'games' : 'standings';
const boardOpen = new Set(); // expanded player rows; kept across the live re-render
const gameOpen = new Set();  // expanded game cards
let boardWeek = null;

const LIVE_GLYPH = { lead: '▲', trail: '▼', even: '=' };
function liveSide(g, team) {
  const mine = team === g.home ? g.home_score : g.away_score;
  const other = team === g.home ? g.away_score : g.home_score;
  return mine > other ? 'lead' : mine < other ? 'trail' : 'even';
}
// Every pick has one state. Each state has its own glyph or strike-through, so none relies on color.
function pickState(pk, g) {
  const w = winnerOf(g);
  if (!pk) return w ? { s: 'miss', glyph: '–', code: '—', label: 'No pick (counts as a miss)' } : { s: 'none', glyph: '', code: '', label: 'No pick yet' };
  if (pk.hidden) return { s: 'hidden', glyph: '•', code: null, label: 'Picked. Hidden until kickoff' };
  if (w) return w === pk.team ? { s: 'win', glyph: '✓', code: `${pk.team}✓`, label: `${pk.team}, won` } : { s: 'loss', glyph: '✕', code: pk.team, label: `${pk.team}, lost` };
  if (g.state === 'in') {
    const side = liveSide(g, pk.team);
    return { s: side, glyph: LIVE_GLYPH[side], code: `${pk.team}${LIVE_GLYPH[side]}`, label: `${pk.team}, ${side === 'lead' ? 'leading' : side === 'trail' ? 'trailing' : 'tied'} now` };
  }
  return { s: 'pend', glyph: '•', code: pk.team, label: `${pk.team}, not started` };
}
const lockIcon = (label) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('class', 'lock'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor'); el.setAttribute('stroke-width', '2.2');
  if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); } else el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
  return el;
};
const gameStatus = (g) => (g.state === 'in' ? `${g.away_score}–${g.home_score} · ${g.detail}` : winnerOf(g) ? `Final ${g.away_score ?? ''}–${g.home_score ?? ''}`.replace(/ –$/, '') : kick(g));

function board() {
  const v = S.view;
  if (!v) return h('div', { class: 'card empty' }, h('h2', {}, 'No games loaded yet'), h('p', { class: 'muted' }, 'The schedule loads automatically. Refresh in a minute.'));
  if (v.week.id !== boardWeek) { boardOpen.clear(); gameOpen.clear(); boardWeek = v.week.id; }
  const st = v.standings;
  initCalc();
  const result = calc.open ? calcPool(st, calc.pool) : null;
  const rankCount = st.rows.reduce((m, r) => m.set(r.rank, (m.get(r.rank) || 0) + 1), new Map());
  const ctx = {
    v, st, result,
    byPlayer: new Map(v.players.map((p) => [p.id, p])),
    rowBy: new Map(st.rows.map((r) => [r.player_id, r])),
    pickMap: new Map(v.picks.map((p) => [`${p.player_id}:${p.game_id}`, p])),
    tbMap: new Map(v.tiebreakers.map((t) => [t.player_id, t])),
    champs: new Set(st.winners),
    payoutBy: result ? new Map(result.results.map((r) => [r.player_id, r])) : null,
    me: S.me ? S.me.id : null,
    rankText: (r) => (rankCount.get(r.rank) > 1 ? `T${r.rank}` : `${r.rank}`),
    rankLabel: (r) => (rankCount.get(r.rank) > 1 ? `tied for ${ordinal(r.rank)}` : ordinal(r.rank)),
  };
  const finals = v.games.filter((g) => winnerOf(g)).length;
  const live = v.games.filter((g) => g.state === 'in' && !winnerOf(g)).length;
  const leader = st.rows[0];
  const myRow = S.me && ctx.rowBy.get(S.me.id);
  const leaders = leader ? st.rows.filter((r) => r.rank === leader.rank).length : 0;

  const stats = h('div', { class: 'stats' },
    h('div', { class: 'stat' }, h('b', {}, st.rows.length), h('span', {}, 'Entries')),
    h('div', { class: 'stat' }, h('b', {}, `${finals}/${v.games.length}`), h('span', {}, live ? `Games final · ${live} live` : 'Games final')),
    h('div', { class: 'stat' },
      h('b', { class: st.final && st.winners.length ? 'names' : null }, st.final ? st.winners.map((id) => ctx.byPlayer.get(id)?.name).join(' & ') || '—' : leader ? `${leader.wins} win${leader.wins === 1 ? '' : 's'}` : '—'),
      h('span', {}, st.final ? (st.winners.length > 1 ? 'Winners (tied)' : 'Winner') : leaders > 1 ? `Leading · ${leaders} tied` : 'Leading')),
    myRow ? h('div', { class: 'stat' }, h('b', {}, ctx.rankText(myRow)), h('span', {}, `You · ${myRow.wins} W${!st.final ? ` · can reach ${myRow.max}` : ''}`)) : null);
  // Phones get a two-line summary instead of four tiles, so the board starts above the fold.
  const bsum = h('div', { class: 'bsum' },
    myRow ? h('p', {}, h('b', {}, `You ${ctx.rankText(myRow)}`), ` of ${st.rows.length} · ${myRow.wins} W`, !st.final ? ` · can reach ${myRow.max}` : '', !st.final && !myRow.alive ? ' · out of reach' : '') : null,
    h('p', {}, st.final && st.winners.length ? [h('b', {}, `🏆 ${st.winners.map((id) => ctx.byPlayer.get(id)?.name).join(' & ')}`), ' won the week']
      : [h('b', {}, `Leader ${leader ? leader.wins : 0} W`), leaders > 1 ? ` (${leaders} tied)` : '', ` · ${finals}/${v.games.length} final`, live ? ` · ${live} live` : '']));

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Board view' },
    [['standings', 'Standings'], ['games', 'Games']].map(([k, l]) => h('button', { class: boardView === k ? 'on' : '', 'aria-pressed': boardView === k ? 'true' : 'false', onclick: () => setBoardView(k) }, l)));
  const search = h('input', { type: 'search', placeholder: 'Find a player', value: boardFilter, 'aria-label': 'Find a player', oninput: (e) => { boardFilter = e.target.value; applyFilter(); } });

  return h('div', {},
    h('div', { class: 'bar' },
      weekNav('/'), seg, h('div', { class: 'spacer' }), search,
      h('button', { class: 'toggle' + (calc.open ? ' on' : ''), 'aria-pressed': calc.open ? 'true' : 'false', onclick: () => { calc.open = !calc.open; store.set('sp_calc_open', calc.open); render(); } }, calc.open ? 'Hide pool calculator' : 'Pool calculator'),
      S.me && !myRow ? h('a', { class: 'btn primary', href: '#/picks' }, 'Make your picks') : null),
    banners(), stats, bsum,
    result ? calcPanel(result, ctx.byPlayer) : null,
    st.rows.length
      ? (boardView === 'games' ? gamesView(ctx) : standingsView(ctx))
      : h('div', { class: 'card empty' }, h('p', {}, 'Nobody has picked yet this week.'), h('a', { class: 'btn primary', href: '#/picks' }, 'Be the first')),
    h('p', { class: 'lb-none card', hidden: true }),
    h('p', { class: 'muted small legend' },
      h('b', {}, 'Key: '), '✓ won · ✕ lost · – no pick · ▲▼ leading or trailing live · • to play', S.league.hide_picks ? ' · ' : '', S.league.hide_picks ? [lockIcon(), ' hidden until kickoff'] : '', '. ',
      'Ties are broken by the combined score of the tiebreak game: closest wins, over or under, and an exact tie shares the place. ',
      `Scores update automatically${S.league.last_sync ? `, last checked ${timeFmt.format(S.league.last_sync)}` : ''}.`));
}

function setBoardView(k, scrollToGame) {
  boardView = k;
  store.set('sp_board_view', k);
  render();
  // Switching views starts at the top. Tapping a pick tile is the one exception: it jumps straight to that game.
  const target = scrollToGame && document.getElementById(`g-${scrollToGame}`);
  if (target) target.scrollIntoView({ block: 'start' }); else window.scrollTo({ top: 0 });
}

// Search filters in place: no re-render, so typing never loses focus and ranks never renumber.
function applyFilter() {
  const q = boardFilter.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('.lb-row').forEach((li) => { const hit = !q || li.dataset.name.includes(q); li.hidden = !hit; if (hit) shown++; });
  document.querySelectorAll('.gv [data-name]').forEach((el) => el.classList.toggle('hit', !!q && el.dataset.name.includes(q)));
  const none = document.querySelector('.lb-none');
  if (none) { none.hidden = !(q && boardView === 'standings' && shown === 0); none.textContent = `No player matches "${boardFilter.trim()}".`; }
  if (boardView === 'games') document.querySelectorAll('.g-who').forEach((el) => el.replaceChildren());
  if (boardView === 'games' && q) {
    const matches = S.view.players.filter((p) => p.name.toLowerCase().includes(q));
    if (matches.length === 1) document.querySelectorAll('.g-who').forEach((el) => fillWho(el, matches[0]));
  }
}

// ----- standings -----
function standingsView(ctx) {
  const { v, st, result } = ctx;
  const head = h('div', { class: 'lb-head' },
    h('div', { class: 'lb-hmain' },
      h('span', { class: 'c-rank' }, '#'), h('span', { class: 'c-name' }, 'Player'),
      h('button', { class: 'strip strip-head', 'aria-label': 'Show the games view', onclick: () => setBoardView('games') },
        v.games.map((g) => {
          const w = winnerOf(g);
          const cls = w ? 'gs-final' : g.state === 'in' ? 'gs-live' : 'gs-pre';
          const side = (team) => h('span', { class: w ? (w === team ? 'won' : 'lost') : '' }, team, w === team ? '✓' : '');
          return h('span', { class: `chip ${cls}`, title: `${g.away} at ${g.home} · ${gameStatus(g)}${g.id === v.week.tiebreak_game ? ' · tiebreak game' : ''}` },
            h('b', { class: 'g' }, w ? 'F' : g.state === 'in' ? '●' : '○'),
            h('b', { class: 'cd' }, side(g.away), side(g.home), h('small', {}, w ? 'F' : g.state === 'in' ? g.detail.split(' ')[0] || 'Live' : timeFmt.format(g.kickoff).replace(/:00| /g, '').toLowerCase())));
        })),
      h('span', { class: 'c-w' }, 'W'),
      h('span', { class: 'c-tb', title: 'Tiebreak: combined points in the tiebreak game. Closest wins, over or under.' }, 'TB', st.tiebreak.actual != null ? h('small', {}, st.tiebreak.actual) : null),
      result ? h('span', { class: 'c-pay' }, calc.pool.unit || 'Pool') : null),
    result ? h('span', { class: 'c-inc' }, 'In') : null);
  const list = h('ol', { class: 'lb-list' }, st.rows.map((r) => standingsRow(ctx, r)));
  const q = boardFilter.trim().toLowerCase();
  if (q) list.querySelectorAll('.lb-row').forEach((li) => { li.hidden = !li.dataset.name.includes(q); });
  return h('section', { class: 'lb', 'data-calc': result ? '1' : null, style: `--n:${v.games.length}` }, head, list);
}

function standingsRow(ctx, r) {
  const { v, st, result } = ctx;
  const p = ctx.byPlayer.get(r.player_id);
  const isMe = ctx.me === p.id, out = !st.final && !r.alive, champ = ctx.champs.has(p.id), open = boardOpen.has(p.id);
  const tb = ctx.tbMap.get(p.id);
  const states = v.games.map((g) => pickState(ctx.pickMap.get(`${p.id}:${g.id}`), g));
  const toggle = () => { if (boardOpen.has(p.id)) boardOpen.delete(p.id); else boardOpen.add(p.id); render(); };
  const main = h('button', { class: 'lb-main', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': `lbx-${p.id}`, onclick: toggle },
    h('span', { class: 'c-rank', 'aria-label': ctx.rankLabel(r) }, ctx.rankText(r)),
    h('span', { class: 'c-name' },
      h('span', { class: 'nm' }, champ ? h('span', { role: 'img', 'aria-label': 'Week winner' }, '🏆 ') : null, p.name, isMe ? h('span', { class: 'sr' }, ' (you)') : null),
      p.sponsor ? h('span', { class: 'sponsor' }, `w/ ${p.sponsor}`) : null,
      out ? h('span', { class: 'tag-out', title: 'Can no longer catch the leader' }, 'OUT') : null),
    h('span', { class: 'strip', 'aria-hidden': 'true' }, states.map((s) => h('i', { class: `chip s-${s.s}` }, h('b', { class: 'g' }, s.glyph), h('b', { class: 'cd' }, s.code === null ? lockIcon() : s.code)))),
    h('span', { class: 'sr' }, `${r.wins} won, ${r.losses} lost${r.pending ? `, ${r.pending} to play` : ''}`),
    h('span', { class: 'c-w' }, r.wins),
    h('span', { class: 'c-tb' }, tb ? (tb.hidden ? lockIcon('Hidden until the tiebreak game kicks off') : tb.total) : '—'),
    result ? payText(p, ctx.payoutBy.get(p.id)) : null);
  return h('li', { class: ['lb-row', isMe ? 'me' : '', out ? 'out' : '', champ ? 'champ' : '', open ? 'open' : ''].join(' ').trim(), 'data-pid': p.id, 'data-name': p.name.toLowerCase() },
    main, result ? incBox(p) : null, open ? expansion(ctx, r, p, states) : null);
}

function payText(p, res) {
  if (calc.pool.exclude.includes(p.id)) return h('span', { class: 'c-pay excl' }, 'excl.');
  return h('span', { class: 'c-pay' + (res && res.amount > 0 ? ' won' : '') }, res && res.amount > 0 ? amt(res.amount, calc.pool.unit) : '–');
}
function incBox(p) {
  const inPool = !calc.pool.exclude.includes(p.id);
  return h('label', { class: 'c-inc' }, h('input', { type: 'checkbox', checked: inPool, 'aria-label': `Include ${p.name} in your pool`,
    onchange: (e) => setPool({ exclude: e.target.checked ? calc.pool.exclude.filter((x) => x !== p.id) : [...calc.pool.exclude, p.id] }) }));
}

function expansion(ctx, r, p, states) {
  const { v, st } = ctx;
  const tb = ctx.tbMap.get(p.id);
  const isMe = ctx.me === p.id;
  const tbText = !tb ? 'no tiebreak guess' : tb.hidden ? 'TB hidden until kickoff' : `TB ${tb.total}${st.tiebreak.actual != null ? ` (actual ${st.tiebreak.actual}, off by ${Math.abs(tb.total - st.tiebreak.actual)})` : ''}`;
  const tied = st.rows.filter((x) => x.rank === r.rank).length;
  const leader = st.rows[0];
  const note = ctx.champs.has(p.id) ? 'Won the week.'
    : !st.final && !r.alive ? `Out of reach: can reach ${r.max}, the leader has ${leader.wins}.`
    : tied > 1 ? `Tied for ${ordinal(r.rank)} with ${tied - 1} other${tied > 2 ? 's' : ''}${st.tiebreak.actual == null ? '. The tiebreak decides once its game is final.' : '.'}` : '';
  // Compare with the viewer (or, on the viewer's own row, with the leader): the quickest "can they catch me" read.
  const otherId = isMe ? (leader && leader.player_id !== p.id ? leader.player_id : null) : ctx.me;
  let differs = 0, differsOpen = 0, comparable = 0;
  const diffAt = new Set();
  if (otherId != null) v.games.forEach((g) => {
    const a = ctx.pickMap.get(`${p.id}:${g.id}`), b = ctx.pickMap.get(`${otherId}:${g.id}`);
    if (a && b && !a.hidden && !b.hidden) { comparable++; if (a.team !== b.team) { differs++; diffAt.add(g.id); if (!winnerOf(g)) differsOpen++; } }
  });
  const otherName = otherId != null ? (isMe ? 'the leader' : 'you') : null;
  return h('div', { class: 'lb-x', id: `lbx-${p.id}` },
    h('p', { class: 'x-sum' }, h('b', {}, `${r.wins}–${r.losses}`), r.pending ? ` · ${r.pending} to play · can reach ${r.max}` : '', ` · ${tbText}`, note ? h('span', { class: 'x-note' }, note) : null),
    h('div', { class: 'tiles' }, v.games.map((g, i) => {
      const s = states[i];
      const mineOther = otherId != null ? ctx.pickMap.get(`${otherId}:${g.id}`) : null;
      return h('button', { class: `tile s-${s.s}`, onclick: () => { gameOpen.add(g.id); setBoardView('games', g.id); }, 'aria-label': `${g.away} at ${g.home}: ${s.label}. Show this game.` },
        h('span', { class: 't-m' }, `${g.away}@${g.home}`),
        h('span', { class: 't-p' }, s.s === 'hidden' ? [lockIcon(), ' Hidden'] : s.s === 'none' ? 'No pick yet' : s.s === 'miss' ? 'No pick' : [h('span', { class: 't-team' }, ctx.pickMap.get(`${p.id}:${g.id}`).team), ' ', s.glyph]),
        g.state === 'in' || !winnerOf(g) ? h('span', { class: 't-s' }, gameStatus(g)) : null,
        diffAt.has(g.id) ? h('span', { class: 't-diff', title: `${otherName === 'you' ? 'You' : 'The leader'} picked ${mineOther.team}` }, '≠') : null);
    })),
    otherId != null ? h('p', { class: 'muted small' }, comparable === 0 ? `Nothing to compare with ${otherName} yet: picks stay hidden until kickoff.`
      : `Differs from ${otherName} on ${differs} of ${comparable} visible game${comparable === 1 ? '' : 's'}${differsOpen ? ` (${differsOpen} still to play)` : ''}.`) : null);
}

// ----- games -----
function gamesView(ctx) {
  const { v, st } = ctx;
  const order = new Map(st.rows.map((r, i) => [r.player_id, i]));
  const byRank = (a, b) => order.get(a) - order.get(b);
  return h('section', { class: 'gv' }, v.games.map((g) => {
    const away = [], home = [], hidden = [];
    for (const r of st.rows) {
      const pk = ctx.pickMap.get(`${r.player_id}:${g.id}`);
      if (!pk) continue;
      if (pk.hidden) hidden.push(r.player_id); else if (pk.team === g.away) away.push(r.player_id); else if (pk.team === g.home) home.push(r.player_id);
    }
    const picked = new Set([...away, ...home, ...hidden]);
    const none = st.rows.map((r) => r.player_id).filter((id) => !picked.has(id));
    [away, home, hidden, none].forEach((a) => a.sort(byRank));
    const w = winnerOf(g), isLive = g.state === 'in' && !w, isTb = g.id === v.week.tiebreak_game, open = gameOpen.has(g.id);
    const revealed = hidden.length === 0;
    const total = away.length + home.length;
    const pct = (n) => (total ? Math.round((100 * n) / total) : 0);
    const mark = (team) => (w ? (w === team ? ' ✓' : '') : isLive ? ` ${LIVE_GLYPH[liveSide(g, team)]}` : '');
    const sideCls = (team) => (w ? (w === team ? 'won' : 'lost') : '');
    const myPk = ctx.me != null ? ctx.pickMap.get(`${ctx.me}:${g.id}`) : null;
    const myState = ctx.me != null ? pickState(myPk, g) : null;
    const nameItem = (id) => {
      const p = ctx.byPlayer.get(id), r = ctx.rowBy.get(id);
      return h('li', { 'data-name': p.name.toLowerCase(), class: id === ctx.me ? 'me' : '' },
        h('span', { class: 'r' }, ctx.rankText(r)), ' ', ctx.champs.has(id) ? '🏆 ' : '', p.name, id === ctx.me ? ' (you)' : '', !st.final && !r.alive ? h('span', { class: 'tag-out' }, 'OUT') : null);
    };
    const badge = (abbr, color) => { const bd = teamBadge(abbr, color); return h('span', { class: 'tbadge sm', style: `--b:${bd.bg};--r:${bd.ring};--i:${bd.ink}`, 'aria-hidden': 'true' }, abbr); };
    const split = revealed && total
      ? h('div', { class: 'g-split', role: 'img', 'aria-label': `${away.length} picked ${g.away}, ${home.length} picked ${g.home}${none.length ? `, ${none.length} no pick` : ''}` },
          h('div', { class: 'g-lbl' },
            h('span', { class: `a ${sideCls(g.away)}` }, `${g.away}${mark(g.away)} `, h('b', {}, away.length), ` · ${pct(away.length)}%`),
            h('span', { class: `h ${sideCls(g.home)}` }, `${pct(home.length)}% · `, h('b', {}, home.length), ` ${g.home}${mark(g.home)}`)),
          h('div', { class: 'gbar' }, h('i', { class: `a ${sideCls(g.away)}`, style: `flex:${away.length || 0.0001}` }), h('i', { class: `h ${sideCls(g.home)}`, style: `flex:${home.length || 0.0001}` })))
      : h('div', { class: 'g-split pending' },
          h('div', { class: 'g-lbl' }, h('span', {}, `${picked.size} of ${st.rows.length} picked`), h('span', { class: 'muted' }, revealed ? '' : 'split shown at kickoff')),
          h('div', { class: 'gbar blank' }));
    const tbList = () => {
      const actual = st.tiebreak.actual != null ? st.tiebreak.actual : isLive ? (g.home_score || 0) + (g.away_score || 0) : null;
      const guesses = v.tiebreakers.filter((t) => !t.hidden);
      if (!guesses.length) return null;
      guesses.sort((a, b) => (actual == null ? a.total - b.total : Math.abs(a.total - actual) - Math.abs(b.total - actual)));
      return h('section', { class: 'g-tbl' }, h('h3', { class: 'micro' }, actual == null ? 'Tiebreak guesses' : st.tiebreak.actual != null ? `Tiebreak guesses · actual ${actual}` : `Tiebreak guesses · ${actual} so far, if it ended now`),
        h('ol', {}, guesses.map((t) => h('li', { 'data-name': ctx.byPlayer.get(t.player_id)?.name.toLowerCase() || '' }, ctx.byPlayer.get(t.player_id)?.name, ` · ${t.total}`, actual != null ? h('span', { class: 'muted' }, ` · ±${Math.abs(t.total - actual)}`) : null))));
    };
    const detail = open ? h('div', { class: 'g-x', id: `gx-${g.id}` },
      revealed
        ? h('div', { class: 'g-cols' },
            h('section', {}, h('h3', { class: `micro ${sideCls(g.away)}` }, `${g.away}${mark(g.away)} · ${away.length}`), h('ol', {}, away.map(nameItem))),
            h('section', {}, h('h3', { class: `micro ${sideCls(g.home)}` }, `${g.home}${mark(g.home)} · ${home.length}`), h('ol', {}, home.map(nameItem))))
        : h('div', { class: 'g-cols' },
            h('section', {}, h('h3', { class: 'micro' }, `Picked · ${picked.size}`), h('ol', {}, [...picked].sort(byRank).map(nameItem))),
            h('section', {}, h('h3', { class: 'micro' }, `Not yet · ${none.length}`), h('ol', {}, none.map(nameItem)))),
      revealed && none.length ? h('section', { class: 'g-none' }, h('h3', { class: 'micro' }, `No pick · ${none.length}`), h('ol', {}, none.map(nameItem))) : null,
      isTb ? tbList() : null) : null;
    return h('article', { class: ['gcard', isLive ? 'live' : '', w ? 'final' : '', isTb ? 'tb' : '', open ? 'open' : ''].join(' ').trim(), id: `g-${g.id}` },
      h('button', { class: 'g-main', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': `gx-${g.id}`, onclick: () => { if (gameOpen.has(g.id)) gameOpen.delete(g.id); else gameOpen.add(g.id); render(); } },
        h('div', { class: 'g-top' },
          h('span', { class: 'g-teams' }, badge(g.away, g.away_color), h('b', {}, g.away), h('span', { class: 'at' }, '@'), badge(g.home, g.home_color), h('b', {}, g.home)),
          h('span', { class: `g-status${isLive ? ' live' : ''}` }, isLive ? '● ' : '', gameStatus(g), isTb ? h('span', { class: 'tbtag' }, 'TB') : null)),
        split,
        h('div', { class: 'g-meta' },
          myState ? h('span', {}, 'You: ', myState.s === 'none' ? 'no pick yet' : myState.s === 'miss' ? 'no pick' : `${myPk.team} ${myState.glyph}`.trim(), isTb && ctx.tbMap.get(ctx.me) && !ctx.tbMap.get(ctx.me).hidden ? ` · TB ${ctx.tbMap.get(ctx.me).total}` : '') : null,
          revealed && none.length ? h('span', { class: 'muted' }, ` · ${none.length} no pick`) : null,
          h('span', { class: 'g-who', 'data-gid': g.id }),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▴' : '▾'))),
      detail);
  }));
}
// When search narrows to one player, every game card shows that player's pick.
function fillWho(el, p) {
  const g = S.view.games.find((x) => x.id === el.dataset.gid);
  const pk = S.view.picks.find((x) => x.player_id === p.id && x.game_id === g.id);
  const s = pickState(pk, g);
  setKids(el, h('b', {}, ` · ${p.name}: `), s.s === 'hidden' ? [lockIcon(), ' hidden'] : s.s === 'none' ? 'no pick yet' : s.s === 'miss' ? 'no pick' : `${pk.team} ${s.glyph}`);
}

// ---------- my picks ----------
function picks() {
  if (!S.me) return h('div', { class: 'card auth' }, h('h2', {}, 'Log in to make picks'), h('p', { class: 'muted' }, 'Anyone can view the board. Picks need your name and PIN.'), h('a', { class: 'btn primary', href: '#/login' }, 'Log in or join'));
  const v = S.view;
  if (!v) return h('p', { class: 'muted' }, 'No games loaded yet.');
  const mine = new Map(v.picks.filter((p) => p.player_id === S.me.id).map((p) => [p.game_id, p.team]));
  const myTb = v.tiebreakers.find((t) => t.player_id === S.me.id);
  const tbGame = v.games.find((g) => g.id === v.week.tiebreak_game);
  const count = () => v.games.filter((g) => mine.get(g.id)).length;
  const open = v.games.filter((g) => !g.locked).length;

  const prog = h('i', { style: `width:${(100 * count()) / (v.games.length || 1)}%` });
  const progBox = h('div', { class: 'progress' + (count() === v.games.length ? ' done' : '') }, prog);
  const progText = h('span', { class: 'prog-label' });
  const refreshProgress = () => {
    prog.style.width = `${(100 * count()) / (v.games.length || 1)}%`;
    progText.replaceChildren(h('b', {}, `${count()} of ${v.games.length}`), ' picked');
    progBox.classList.toggle('done', count() === v.games.length);
  };
  refreshProgress();

  const save = async (payload) => {
    try {
      const r = await api('/picks', { week_id: v.week.id, ...payload });
      if (r.rejected.length) { toast(`Not saved: ${r.rejected.map((x) => x.reason).join(', ')}`, true); await load(); return false; }
      toast('Saved ✓');
      return true;
    } catch (e) { toast(e.message, true); return false; }
  };

  const panelColor = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#ffffff';
  const card = (g) => {
    const w = winnerOf(g);
    const side = (abbr, name, color, score) => {
      const sel = mine.get(g.id) === abbr;
      const cls = ['team', sel ? 'sel' : '', sel && w ? (w === abbr ? 'won' : 'lost') : ''].join(' ');
      const edge = teamEdge(abbr === g.home ? g.home_color : g.away_color, panelColor);
      return h('button', {
        class: cls, disabled: g.locked, 'aria-pressed': sel ? 'true' : 'false', style: edge ? `--edge:${edge}` : null,
        onclick: async (e) => {
          if (mine.get(g.id) === abbr) return;
          const prev = mine.get(g.id);
          mine.set(g.id, abbr);
          const box = e.currentTarget.closest('.teams');
          box.querySelectorAll('.team').forEach((b) => { const on = b.dataset.t === abbr; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
          refreshProgress();
          if (!(await save({ picks: { [g.id]: abbr } }))) { prev ? mine.set(g.id, prev) : mine.delete(g.id); }
        },
        'data-t': abbr,
      },
        (() => { const bd = teamBadge(abbr, color); return h('span', { class: 'tbadge', style: `--b:${bd.bg};--r:${bd.ring};--i:${bd.ink}`, 'aria-hidden': 'true' }, abbr); })(),
        h('span', { class: 'nm' }, h('b', {}, abbr), h('small', {}, name)),
        score != null ? h('span', { class: 'sc' }, score) : null);
    };
    const status = g.state === 'pre'
      ? (g.locked ? 'Locked' : fullFmt.format(g.kickoff))
      : g.state === 'in' ? h('span', { class: 'live' }, `LIVE · ${g.detail}`) : (g.manual_winner && g.state !== 'post' ? 'Final (set by commissioner)' : g.detail || 'Final');
    return h('div', { class: 'game' + (g.locked ? ' locked' : '') + (g.state !== 'pre' ? ' scored' : '') },
      h('div', { class: 'when' }, h('span', {}, status), g.id === v.week.tiebreak_game ? h('span', {}, 'Tiebreak game') : (g.locked && g.state !== 'pre' ? 'Locked' : '')),
      h('div', { class: 'teams' },
        side(g.away, g.away_name, g.away_color, g.state === 'pre' ? null : g.away_score),
        h('span', { class: 'at' }, '@'),
        side(g.home, g.home_name, g.home_color, g.state === 'pre' ? null : g.home_score)));
  };

  let tbTimer;
  const tbLocked = tbGame ? tbGame.locked : true;
  const tbInput = h('input', {
    type: 'number', inputmode: 'numeric', min: 0, max: 200, value: myTb && !myTb.hidden ? myTb.total : '', disabled: tbLocked, 'aria-label': 'Tiebreak total points',
    oninput: (e) => { clearTimeout(tbTimer); tbTimer = setTimeout(() => save({ tiebreak: e.target.value }), 700); },
  });

  return h('div', {},
    h('div', { class: 'bar' }, weekNav('/picks'), h('div', { class: 'spacer' }),
      h('div', { class: 'prog' }, progText, progBox)),
    banners(),
    open === 0 ? h('div', { class: 'banner' }, 'Every game this week has kicked off. Picks are locked.') : null,
    h('p', { class: 'muted small' }, 'Tap a team to pick it. Each pick saves instantly and locks when that game kicks off. You can change a pick any time before then.'),
    h('div', { class: 'games' }, v.games.map(card)),
    h('div', { class: 'card' },
      h('h2', {}, 'Tiebreaker'),
      h('div', { class: 'tb' }, tbInput,
        h('span', { class: 'muted' }, tbGame ? `Combined points in ${tbGame.away} @ ${tbGame.home} (${kick(tbGame)}). ${tbLocked ? 'Locked.' : 'Closest wins, over or under.'}` : ''))),
  );
}

function pinForm() {
  const old = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password' });
  const neu = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password' });
  return h('form', { class: 'mt-3', onsubmit: async (e) => { e.preventDefault(); try { await api('/pin', { old: old.value, pin: neu.value }); toast('PIN changed'); old.value = neu.value = ''; } catch (err) { toast(err.message, true); } } },
    h('div', { class: 'row' }, h('label', {}, 'Current PIN', old), h('label', {}, 'New PIN (4-8 digits)', neu), h('button', { class: 'primary' }, 'Change')));
}

// ---------- login / join ----------
// An invite link carries ?code=, so it opens on the Join tab.
let authMode = new URLSearchParams(location.search).get('code') ? 'join' : 'login';
function login() {
  if (S.me) { setTimeout(() => go('/account')); return h('p', {}, 'Logged in.'); }
  if (S.league.demo) {
    const enter = async (role) => { try { await api('/demo-login', { role }); history.replaceState(null, '', location.pathname + (role === 'commish' ? '#/admin' : '#/picks')); await load(); toast(role === 'commish' ? 'You are the demo commissioner' : 'Pick some winners!'); } catch (e) { toast(e.message, true); } };
    return h('div', { class: 'card auth' },
      h('h2', {}, 'Try the demo'), h('p', { class: 'muted' }, 'No sign-up. Everyone shares these demo logins, and everything resets every hour.'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => enter('player') }, 'Try as a player'), h('button', { onclick: () => enter('commish') }, 'Try as the commissioner')),
      h('p', { class: 'muted small' }, 'Like it? ', h('a', { href: brandLink(BRAND.repo, 'demo-login'), target: '_blank', rel: 'noopener' }, 'Get your own free copy'), ' and run it for your group.'));
  }
  const setup = S.league.needs_setup;
  if (setup) authMode = 'join';
  const name = h('input', { autocomplete: 'username', maxlength: 40, required: true });
  const pin = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]{4,8}', autocomplete: authMode === 'join' ? 'new-password' : 'current-password', required: true });
  const code = h('input', { autocomplete: 'off', autocapitalize: 'none' });
  const fromLink = new URLSearchParams(location.search).get('code');
  if (fromLink) code.value = fromLink;

  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api(authMode === 'join' ? '/signup' : '/login', { name: name.value, pin: pin.value, code: code.value });
      if (r.recovered) setTimeout(() => toast('PIN recovered. Now delete RECOVERY_PIN in the Cloudflare dashboard.'), 400);
      history.replaceState(null, '', location.pathname + '#/picks');
      await load();
      toast(setup ? 'You are the commissioner. Open Admin to share the join code.' : 'Welcome!');
    } catch (err) { toast(err.message, true); }
  };

  return h('div', { class: 'card auth' },
    setup ? null : h('div', { class: 'tabs' },
      h('button', { class: authMode === 'login' ? 'on' : '', onclick: () => { authMode = 'login'; render(); } }, 'Log in'),
      h('button', { class: authMode === 'join' ? 'on' : '', onclick: () => { authMode = 'join'; render(); } }, 'Join the pool')),
    setup ? h('div', {}, h('h2', {}, 'Set up your pool'), h('p', { class: 'muted' }, 'You are the first one here, so you become the commissioner. Pick the name and PIN you will use.')) : null,
    h('form', { onsubmit: submit },
      h('label', {}, authMode === 'join' ? 'Display name (shows on the board)' : 'Your name', name),
      h('label', {}, authMode === 'join' ? 'Choose a PIN (4-8 digits)' : 'PIN', pin),
      authMode === 'join' && !setup ? h('label', {}, 'Join code (from the commissioner)', code) : null,
      h('button', { class: 'primary btn-block' }, authMode === 'join' ? (setup ? 'Create pool' : 'Join') : 'Log in'),
      authMode === 'login' ? h('p', { class: 'muted small' }, 'Forgot your PIN? The commissioner can reset it.') : null));
}

// ---------- admin ----------
function admin() {
  if (!S.me || !S.me.is_admin) return h('p', {}, 'Commissioner only.');
  if (!A) { load(); return h('p', { class: 'muted' }, 'Loading…'); }
  const tabs = [['week', 'This week'], ['players', 'Players'], ['enter', 'Enter picks'], ['source', 'Data source'], ['log', 'Change log'], ['settings', 'Settings']];
  const body = ({ week: adminWeek, players: adminPlayers, enter: adminEnter, source: adminSource, log: adminLog, settings: adminSettings }[adminTab] || adminWeek)();
  return h('div', {},
    h('div', { class: 'bar' }, weekNav('/admin')),
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: adminTab === k ? 'on' : '', onclick: () => { adminTab = k; render(); } }, l))),
    body);
}

async function act(path, body, msg = 'Saved') {
  try { const r = await api(path, body); toast(msg); await load(); return r; } catch (e) { toast(e.message, true); return null; }
}

function adminWeek() {
  const v = S.view;
  const manual = A.source.source === 'manual';
  if (!v) return h('div', {}, manual ? newWeekCard() : h('div', { class: 'card' }, h('p', {}, 'No week loaded yet. Check Admin → Data source.')));
  const msg = h('textarea', { rows: 2, maxlength: 500 }, v.week.message || '');
  const tb = h('select', {}, v.games.map((g) => h('option', { value: g.id, selected: g.id === v.week.tiebreak_game }, `${g.away} @ ${g.home} · ${kick(g)}`)));
  const [season, type, wk] = v.week.id.split('-').map(Number);
  const cur = (S.league.current_week || v.week.id).split('-').map(Number);

  return h('div', {},
    manual ? newWeekCard() : null,
    h('div', { class: 'card' }, h('h2', {}, `${v.week.season} ${v.week.label}`),
      h('div', { class: 'row' }, h('label', {}, 'Tiebreak game', tb)),
      h('label', {}, 'Message on the board (rules, reminders, bye weeks)', msg),
      h('button', { class: 'primary', onclick: () => act('/admin/week', { week_id: v.week.id, message: msg.value, tiebreak_game: tb.value }) }, 'Save week')),
    manual ? manualGamesCard(v) : null,
    manual ? null : h('div', { class: 'card' }, h('h2', {}, 'Results'),
      h('p', { class: 'muted small' }, 'Winners fill in automatically from the live feed. Override one only if the feed is wrong or stuck.'),
      h('table', { class: 'list' }, h('thead', {}, h('tr', {}, h('th', {}, 'Game'), h('th', {}, 'Feed'), h('th', {}, 'Winner'))),
        h('tbody', {}, v.games.map((g) => h('tr', {},
          h('td', {}, `${g.away} @ ${g.home}`, h('div', { class: 'muted small' }, fullFmt.format(g.kickoff))),
          h('td', {}, g.state === 'pre' ? 'Not started' : `${g.away_score}-${g.home_score} ${g.detail}`),
          h('td', {}, h('select', { onchange: (e) => act('/admin/game', { game_id: g.id, manual_winner: e.target.value }) },
            h('option', { value: '' }, `Use feed${g.winner ? ` (${g.winner})` : ''}`),
            [g.away, g.home, 'TIE'].map((t) => h('option', { value: t, selected: g.manual_winner === t }, `Set: ${t}`))))))))),
    manual ? h('div', { class: 'card' }, h('a', { class: 'btn', href: `/api/admin/export.csv?week=${v.week.id}` }, 'Download CSV')) : h('div', { class: 'card' }, h('h2', {}, 'Schedule'),
      h('div', { class: 'row' },
        h('button', { onclick: () => act('/admin/sync', {}, 'Scores refreshed') }, 'Refresh scores now'),
        h('button', { onclick: () => act('/admin/sync', { season: cur[0], type: cur[1], week: cur[2] + 1 }, 'Next week loaded') }, 'Load next week early'),
        h('a', { class: 'btn', href: `/api/admin/export.csv?week=${v.week.id}` }, 'Download CSV')),
      h('p', { class: 'muted small' }, `The current week loads by itself. Use "Load next week early" to open picks before the feed rolls over (usually Wednesday). Showing season ${season}, type ${type}, week ${wk}.`)));
}

// ---------- manual games ----------
const toLocalInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const teamCodes = () => h('datalist', { id: 'teamcodes' }, A.teams.map((t) => h('option', { value: t.abbr }, t.name)));

function newWeekCard() {
  const now = new Date();
  const season = h('input', { type: 'number', value: S.view ? S.view.week.season : now.getFullYear() - (now.getMonth() < 2 ? 1 : 0), min: 1900 });
  const type = h('select', {}, [[2, 'Regular season'], [3, 'Playoffs'], [1, 'Preseason']].map(([k, l]) => h('option', { value: k }, l)));
  const next = S.view ? Number(S.view.week.id.split('-')[2]) + 1 : 1;
  const week = h('input', { type: 'number', min: 1, max: 30, value: next });
  return h('div', { class: 'card' }, h('h2', {}, 'Add a week'),
    h('p', { class: 'muted small' }, 'Manual mode: you create each week and type in its games. The new week becomes the current one.'),
    h('div', { class: 'row' }, h('label', {}, 'Season', season), h('label', {}, 'Part', type), h('label', {}, 'Week', week),
      h('button', { class: 'primary', onclick: async () => { const r = await act('/admin/manual/week', { season: season.value, type: type.value, week: week.value }, 'Week added'); if (r) go('/admin', r.week_id); } }, 'Add week')));
}

function manualGamesCard(v) {
  const away = h('input', { list: 'teamcodes', placeholder: 'Away (e.g. NE)', maxlength: 5, autocapitalize: 'characters' });
  const home = h('input', { list: 'teamcodes', placeholder: 'Home (e.g. BUF)', maxlength: 5, autocapitalize: 'characters' });
  const when = h('input', { type: 'datetime-local' });
  const row = (g) => {
    const st = h('select', {}, [['pre', 'Not started'], ['in', 'In progress'], ['post', 'Final']].map(([k, l]) => h('option', { value: k, selected: g.state === k }, l)));
    const as = h('input', { type: 'number', min: 0, class: 'num', value: g.away_score ?? '', 'aria-label': `${g.away} score` });
    const hs = h('input', { type: 'number', min: 0, class: 'num', value: g.home_score ?? '', 'aria-label': `${g.home} score` });
    const k = h('input', { type: 'datetime-local', value: toLocalInput(g.kickoff), 'aria-label': 'Kickoff' });
    const isManual = String(g.id).startsWith('m-');
    return h('tr', {},
      h('td', {}, h('b', {}, `${g.away} @ ${g.home}`)), h('td', {}, k), h('td', {}, st), h('td', {}, as), h('td', {}, hs),
      h('td', {}, h('div', { class: 'row' },
        h('button', { onclick: () => act('/admin/manual/game', { week_id: v.week.id, id: isManual ? g.id : undefined, away: g.away, home: g.home, kickoff: new Date(k.value).getTime(), state: st.value, away_score: as.value, home_score: hs.value }, 'Game saved') }, 'Save'),
        isManual ? h('button', { onclick: () => act('/admin/manual/game-delete', { game_id: g.id }, 'Game deleted') }, 'Delete') : null)));
  };
  return h('div', { class: 'card' }, h('h2', {}, 'Games and scores'), teamCodes(),
    h('p', { class: 'muted small' }, 'Type the scores and set Final. The winner is worked out from the scores. Picks lock at each kickoff time you set.'),
    h('div', { style: 'overflow-x:auto' }, h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['Game', 'Kickoff', 'Status', 'Away', 'Home', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, v.games.map(row)))),
    h('h2', { class: 'sub' }, 'Add a game'),
    h('div', { class: 'row' }, h('label', {}, 'Away team', away), h('label', {}, 'Home team', home), h('label', {}, 'Kickoff', when),
      h('button', { class: 'primary', onclick: () => act('/admin/manual/game', { week_id: v.week.id, away: away.value, home: home.value, kickoff: when.value ? new Date(when.value).getTime() : NaN, state: 'pre' }, 'Game added') }, 'Add game')));
}

// ---------- data source ----------
let sourceDraft = null;
function adminSource() {
  const cur = A.source;
  if (!sourceDraft) sourceDraft = { source: cur.source, feed_url: cur.feed_url, test: null };
  const d = sourceDraft;
  const option = (key, title, text) => h('label', { class: 'srcopt' + (d.source === key ? ' on' : '') },
    h('input', { type: 'radio', name: 'src', checked: d.source === key, onchange: () => { d.source = key; d.test = null; render(); } }),
    h('span', {}, h('b', {}, title), h('small', {}, text)));
  const url = h('input', { type: 'url', value: d.feed_url, placeholder: 'https://example.com/scores.json?season={season}&week={week}', oninput: (e) => { d.feed_url = e.target.value; } });
  const key = h('input', { type: 'password', autocomplete: 'off', placeholder: cur.has_key ? `Saved key ${cur.key_hint}. Type to replace.` : 'Optional. Sent as: Authorization: Bearer <key>' });
  const clear = h('input', { type: 'checkbox' });
  const payload = () => ({ source: d.source, feed_url: d.feed_url, feed_key: key.value, clear_key: clear.checked });
  const test = async () => {
    try { d.test = await api('/admin/source/test', payload()); } catch (e) { d.test = { error: e.message }; }
    render();
  };
  return h('div', {},
    h('div', { class: 'card' }, h('h2', {}, 'Where games and scores come from'),
      h('div', { class: 'srcopts' },
        option('espn', 'Automatic', "ESPN's public NFL scoreboard. Free, no key, updates every 10 minutes. It's unofficial, so it could change or stop without notice."),
        option('custom', 'Your own feed', 'Any web address that returns games as JSON, with an optional API key. Use a paid sports-data service, your own script, or another league.'),
        option('manual', 'Manual', 'No feed at all. You type in the games and final scores. Works for any sport, league or office pool.')),
      d.source === 'custom' ? h('div', { style: 'margin-top:12px' },
        h('label', {}, 'Feed URL ({season}, {week} and {type} are filled in when a specific week is loaded)', url),
        h('label', {}, 'API key', key),
        cur.has_key ? h('label', { class: 'check' }, clear, 'Remove the saved key') : null,
        h('details', {}, h('summary', {}, 'What the feed must return'),
          h('pre', { class: 'code', style: 'white-space:pre-wrap' }, JSON.stringify({ season: 2026, type: 2, week: 5, label: 'Week 5', games: [{ id: 'g1', kickoff: '2026-10-11T17:00:00Z', away: 'NE', home: 'BUF', away_score: null, home_score: null, state: 'pre' }] }, null, 2)),
          h('p', { class: 'muted small' }, 'state is pre, in or post. Scores are numbers or null. The winner is worked out from the scores, or you can send "winner". ESPN-format JSON also works.'))) : null,
      h('div', { class: 'row', style: 'margin-top:12px' },
        d.source !== 'manual' ? h('button', { onclick: test }, 'Test connection') : null,
        h('button', { class: 'primary', onclick: async () => { const r = await act('/admin/source', payload(), 'Data source saved'); if (r) sourceDraft = null; } }, 'Save'))),
    d.test ? h('div', { class: 'card' },
      d.test.error ? [h('h2', {}, 'Test failed'), h('p', {}, d.test.error)]
        : [h('h2', {}, `Test worked: ${d.test.week.season} ${d.test.week.label}, ${d.test.games.length} games`),
          h('table', { class: 'list' }, h('tbody', {}, d.test.games.slice(0, 8).map((g) => h('tr', {}, h('td', {}, `${g.away} @ ${g.home}`), h('td', {}, fullFmt.format(g.kickoff)), h('td', {}, g.state === 'pre' ? '' : `${g.away_score}-${g.home_score}`))))),
          h('p', { class: 'muted small' }, 'Nothing has changed yet. Press Save to switch.')]) : null);
}

function adminPlayers() {
  const name = h('input', { maxlength: 40 }), sponsor = h('input', { maxlength: 40 }), pin = h('input', { inputmode: 'numeric', placeholder: 'blank = random' });
  return h('div', {},
    h('div', { class: 'card' }, h('h2', {}, 'Invite people'),
      h('p', {}, 'Send this link. The join code is already in it:'),
      h('p', {}, h('span', { class: 'code' }, `${location.origin}/?code=${A.settings.join_code}#/login`)),
      h('p', { class: 'muted small' }, 'Change the code in Settings to stop new sign-ups.')),
    h('div', { class: 'card' }, h('h2', {}, 'Add a player yourself'),
      h('p', { class: 'muted small' }, 'For people who text you their picks. Enter their picks in "Enter picks".'),
      h('div', { class: 'row' }, h('label', {}, 'Name', name), h('label', {}, 'With (who brought them)', sponsor), h('label', {}, 'PIN', pin),
        h('button', { class: 'primary', onclick: async () => { const r = await act('/admin/add-player', { name: name.value, sponsor: sponsor.value, pin: pin.value }, 'Player added'); if (r) toast(`Added. Their PIN is ${r.pin}`); } }, 'Add'))),
    h('div', { class: 'card' }, h('h2', {}, `Players (${A.players.length})`),
      h('div', { style: 'overflow-x:auto' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, ['Name', 'With', 'Commish', 'Active', 'New PIN', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, A.players.map((p) => {
          const n = h('input', { value: p.name, maxlength: 40 }), s = h('input', { value: p.sponsor || '', maxlength: 40, style: 'width:110px' });
          const ad = h('input', { type: 'checkbox', checked: !!p.is_admin }), ac = h('input', { type: 'checkbox', checked: !!p.active });
          const np = h('input', { inputmode: 'numeric', placeholder: 'reset', style: 'width:80px' });
          return h('tr', {}, h('td', {}, n), h('td', {}, s), h('td', {}, h('label', { class: 'check', 'aria-label': `${p.name} is commissioner` }, ad)), h('td', {}, h('label', { class: 'check', 'aria-label': `${p.name} is active` }, ac)), h('td', {}, np),
            h('td', {}, h('button', { onclick: () => act('/admin/player', { id: p.id, name: n.value, sponsor: s.value, is_admin: ad.checked, active: ac.checked, pin: np.value || undefined }) }, 'Save')));
        }))))));
}

let enterFor = null;
function adminEnter() {
  const v = S.view;
  const active = A.players.filter((p) => p.active);
  const sel = h('select', { onchange: (e) => { enterFor = Number(e.target.value) || null; render(); } },
    h('option', { value: '' }, 'Choose a player…'), active.map((p) => h('option', { value: p.id, selected: p.id === enterFor }, p.name)));
  if (!enterFor) return h('div', { class: 'card' }, h('h2', {}, 'Enter or fix picks for a player'), h('p', { class: 'muted small' }, 'Works even after kickoff. Every change is recorded in the change log.'), sel);
  const cur = new Map(A.picks.filter((p) => p.player_id === enterFor).map((p) => [p.game_id, p.team]));
  const tb = A.tiebreakers.find((t) => t.player_id === enterFor);
  const choice = new Map(cur);
  const tbIn = h('input', { type: 'number', min: 0, max: 200, value: tb ? tb.total : '', style: 'width:100px' });
  return h('div', { class: 'card' }, h('h2', {}, 'Enter or fix picks for a player'), sel,
    h('table', { class: 'list', style: 'margin-top:12px' }, h('tbody', {}, v.games.map((g) => h('tr', {},
      h('td', {}, kick(g), g.locked ? ' 🔒' : ''),
      [g.away, g.home].map((t) => h('td', {}, h('label', { class: 'check' },
        h('input', { type: 'radio', name: `g${g.id}`, checked: cur.get(g.id) === t, onchange: () => choice.set(g.id, t) }), t))))))),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('label', {}, 'Tiebreak total', tbIn),
      h('button', { class: 'primary', onclick: async () => {
        const changes = {};
        for (const g of v.games) if ((choice.get(g.id) || '') !== (cur.get(g.id) || '')) changes[g.id] = choice.get(g.id) || '';
        const r = await act('/admin/picks', { player_id: enterFor, week_id: v.week.id, picks: changes, tiebreak: tbIn.value }, 'Picks saved');
        if (r && r.rejected.length) toast(r.rejected.map((x) => x.reason).join(', '), true);
      } }, 'Save picks')));
}

function adminLog() {
  return h('div', { class: 'card' }, h('h2', {}, 'Change log'),
    h('p', { class: 'muted small' }, 'Every pick change, payment and setting, newest first. Use it to settle "I picked the other team" disputes.'),
    h('div', { style: 'overflow-x:auto' }, h('table', { class: 'list log' },
      h('thead', {}, h('tr', {}, ['When', 'Who', 'For', 'What', 'Detail'].map((x) => h('th', {}, x)))),
      h('tbody', {}, A.log.map((l) => h('tr', {}, h('td', {}, fullFmt.format(l.at)), h('td', {}, l.actor || ''), h('td', {}, l.player || ''), h('td', {}, l.action), h('td', {}, l.detail)))))));
}

function adminSettings() {
  const s = A.settings;
  const name = h('input', { value: s.league_name, maxlength: 40 });
  const code = h('input', { value: s.join_code, maxlength: 30 });
  const hide = h('input', { type: 'checkbox', checked: s.hide_picks });
  const theme = h('select', {}, THEMES.map((t) => h('option', { value: t.abbr === 'DEFAULT' ? '' : t.abbr, selected: (S.league.default_theme || '') === (t.abbr === 'DEFAULT' ? '' : t.abbr) }, `${t.theme} · ${t.colors}${t.city ? ` · ${t.city}` : ''}`)));
  return h('div', {}, h('div', { class: 'card' }, h('h2', {}, 'Pool settings'),
    h('div', { class: 'row' }, h('label', {}, 'Pool name', name), h('label', {}, 'Join code', code), h('label', {}, 'Site theme (people can still pick their own)', theme)),
    h('label', { class: 'check' }, hide, 'Hide everyone\'s picks until each game kicks off (stops copying)'),
    h('button', { class: 'primary', style: 'margin-top:10px', onclick: () => act('/admin/settings', { league_name: name.value, join_code: code.value, hide_picks: hide.checked, default_theme: theme.value }) }, 'Save settings'),
    h('h2', { class: 'sub' }, 'Suggested pool settings'),
    h('p', { class: 'muted small' }, 'The site never handles money. If your group runs a pool offline, you can suggest calculator settings that anyone can load with one tap. Set them in the Pool calculator on the board, then press "Save as suggestion for everyone".'),
    S.league.calc_preset
      ? h('div', { class: 'row' }, h('span', {}, poolSummary(normalizePool(S.league.calc_preset))), h('button', { onclick: () => act('/admin/settings', { calc_preset: null }, 'Suggestion cleared') }, 'Clear suggestion'))
      : h('p', {}, 'No suggestion set.')),
    makerCard('admin', 'Want more than a picks sheet?',
      `${BRAND.maker} built ${BRAND.product}. We also build custom features, versions for other sports and leagues, and the tools that run your business: booking, follow-ups, AI phone agents and more.`));
}

// ---------- boot ----------
window.addEventListener('hashchange', () => { A = null; load().catch((e) => toast(e.message, true)); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && route().path === '/') load().catch(() => {}); });
load().catch((e) => { $app.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Could not load'), h('p', {}, e.message))); });
