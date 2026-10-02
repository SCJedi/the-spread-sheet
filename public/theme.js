// Theme engine. Turns a team's two brand colors into a full, accessible palette.
//
// The rules (checked for all 34 themes in light and dark by test/theme.test.js):
//   - Every text color reaches WCAG 2.2 AA contrast, 4.5:1, against the surface it sits on.
//   - Buttons, borders and other UI parts reach 3:1 (WCAG 1.4.11).
//   - Win/loss colors never change with the theme, and losses also get a shape cue (strikethrough),
//     so meaning never rests on hue alone.
//   - Colors are adjusted in OKLCH, which keeps hue and chroma (the team's identity) while moving
//     only lightness, the one thing contrast depends on.
import { TEAMS } from './teams.js';

// ---------- color math ----------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
}
export const rgbToHex = (rgb) => '#' + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('');
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// WCAG relative luminance and contrast ratio.
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// OKLab / OKLCH (Björn Ottosson, 2020).
export function toOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
function oklchToLinear(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
// Out-of-gamut colors keep lightness and hue and lose chroma until they fit in sRGB.
export function oklch(L, C, H) {
  L = clamp01(L);
  const inGamut = (c) => oklchToLinear(L, c, H).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (!inGamut(C)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(mid)) lo = mid; else hi = mid; }
    C = lo;
  }
  return rgbToHex(oklchToLinear(L, C, H).map((v) => fromLinear(clamp01(v))));
}

// Moves only lightness, toward the end that increases contrast, by the smallest step that reaches target.
export function fitContrast(hex, against, target) {
  if (contrast(hex, against) >= target) return hex;
  const { L, C, H } = toOklch(hex);
  const goDark = luminance(against) > 0.18;
  const end = goDark ? 0 : 1;
  if (contrast(oklch(end, C, H), against) < target) return goDark ? '#000000' : '#ffffff';
  let near = L, far = end;
  for (let i = 0; i < 30; i++) {
    const mid = (near + far) / 2;
    if (contrast(oklch(mid, C, H), against) >= target) far = mid; else near = mid;
  }
  return oklch(far, C, H);
}
const fitAll = (hex, surfaces, target) => surfaces.reduce((c, s) => fitContrast(c, s, target), hex);

// Mixes in OKLab so tints stay clean instead of going muddy.
export function mix(a, b, t) {
  const p = toOklch(a), q = toOklch(b);
  const pa = [p.L, p.C * Math.cos((p.H * Math.PI) / 180), p.C * Math.sin((p.H * Math.PI) / 180)];
  const qa = [q.L, q.C * Math.cos((q.H * Math.PI) / 180), q.C * Math.sin((q.H * Math.PI) / 180)];
  const [L, A, B] = pa.map((v, i) => v + (qa[i] - v) * t);
  return oklch(L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360);
}

// ---------- themes ----------
const WHITE = '#ffffff', INK_DARK = '#0b0d12';

// The default and house theme: "Neon Kickoff". Electric violet into hot pink, with a lime spark.
export const DEFAULT_THEME = { abbr: 'DEFAULT', theme: 'Neon Kickoff', colors: 'Violet & Pink', city: '', color: '#7c3aed', alt: '#ff2d87', spark: '#c6ff3d' };
// The maker's house colors, offered as a theme.
export const IV_THEME = { abbr: 'IV', theme: 'Infinite Blue', colors: 'Blue & Sky', city: 'by Infinite Visions AI', color: '#2563eb', alt: '#0ea5e9', spark: '#7dd3fc' };
export const THEMES = [DEFAULT_THEME, IV_THEME, ...TEAMS];
export const findTheme = (id) => THEMES.find((t) => t.abbr === id) || DEFAULT_THEME;

// Some feeds list black or white as a team's main color (PIT is black + gold). The brand color is the
// more colorful of the two, so the theme carries the team's real identity.
function brandColors(t) {
  const a = toOklch(t.color), b = toOklch(t.alt);
  return a.C >= 0.04 || a.C >= b.C ? [t.color, t.alt] : [t.alt, t.color];
}

// Fixed meaning colors. Identical in every theme so "green = right" never has to be relearned.
const SEMANTIC = {
  light: { win: '#d4f4df', winInk: '#0d4f2c', loss: '#fde3e1', lossInk: '#8a1a12', live: '#b45309' },
  dark: { win: '#11402a', winInk: '#a8f2c6', loss: '#4a1a1c', lossInk: '#ffbcb4', live: '#fbbf24' },
};

export function buildTheme(themeId, mode) {
  const t = findTheme(themeId);
  const [brand, second] = brandColors(t);
  const { H } = toOklch(brand);
  const dark = mode === 'dark';
  const sem = SEMANTIC[mode];

  // Neutrals carry a whisper of the team hue: premium, and still neutral.
  const tint = dark ? 0.018 : 0.008;
  const bg = dark ? oklch(0.155, tint, H) : oklch(0.975, tint, H);
  const panel = dark ? oklch(0.205, tint, H) : '#ffffff';
  const raised = dark ? oklch(0.25, tint, H) : oklch(0.955, tint, H);
  const ink = dark ? oklch(0.965, 0.006, H) : oklch(0.2, 0.012, H);
  const line = dark ? oklch(0.3, tint, H) : oklch(0.905, tint, H);
  const muted = fitAll(dark ? oklch(0.75, 0.015, H) : oklch(0.48, 0.015, H), [panel, bg, raised], 4.5);

  // Accent: the button and selection color. Pick whichever label color (white or near-black) needs the
  // smaller lightness change, so gold stays gold (with dark text) and navy stays navy (with white text).
  const options = [WHITE, INK_DARK].map((on) => {
    const fill = fitAll(fitContrast(brand, on, 4.5), [panel, bg], 3);
    return { on: contrast(fill, on) >= 4.5 ? on : (contrast(fill, WHITE) > contrast(fill, INK_DARK) ? WHITE : INK_DARK), fill, shift: Math.abs(toOklch(fill).L - toOklch(brand).L) };
  }).sort((a, b) => a.shift - b.shift);
  const accent = options[0].fill, onAccent = options[0].on;

  // Accent as text (links, numbers): readable on every surface.
  const accentText = fitAll(brand, [panel, bg, raised], 4.5);
  const accentText2 = fitAll(t.spark ? t.alt : second, [panel, bg, raised], 4.5);

  // Header: the team's "jersey" color, meaning whichever of its two colors carries white text best
  // (Steelers black, Packers green, Chiefs red), as a deep two-stop gradient, plus the other color as a stripe.
  let headA, headB, stripe;
  if (t.spark) {
    headA = fitContrast(oklch(toOklch(brand).L - 0.06, toOklch(brand).C, H), WHITE, 7);
    headB = fitContrast(second, WHITE, 4.5);
    stripe = t.spark;
  } else {
    const [jersey, trim] = contrast(t.color, WHITE) >= contrast(t.alt, WHITE) ? [t.color, t.alt] : [t.alt, t.color];
    const j = toOklch(jersey);
    const hue = j.C < 0.02 ? H : j.H; // pure black gets a trace of the brand hue so it reads as designed, not empty
    const chroma = Math.max(j.C, 0.025);
    const base = Math.max(Math.min(j.L, 0.5) - 0.04, 0.17); // rich black, never flat #000
    headA = fitContrast(oklch(base, chroma, hue), WHITE, 7);
    headB = fitContrast(oklch(base + 0.1, chroma, (hue + 6) % 360), WHITE, 4.5);
    stripe = contrast(trim, headA) >= 1.6 ? trim : oklch(0.82, toOklch(brand).C, H);
  }

  const sel = mix(panel, accent, dark ? 0.22 : 0.12);
  const me = mix(panel, accent, dark ? 0.14 : 0.08);
  const live = fitAll(sem.live, [panel, bg], 4.5);

  return {
    id: t.abbr, name: t.theme, mode,
    vars: {
      '--bg': bg, '--panel': panel, '--raised': raised, '--ink': ink, '--muted': muted, '--line': line,
      '--accent': accent, '--accent-ink': onAccent, '--accent-text': accentText, '--accent-text-2': accentText2,
      '--top': headA, '--top-2': headB, '--top-ink': WHITE, '--stripe': stripe,
      '--sel': sel, '--me': me, '--pend': raised, '--warn': live,
      '--win': sem.win, '--win-ink': sem.winInk, '--loss': sem.loss, '--loss-ink': sem.lossInk,
      '--glow': dark ? `${brand}38` : `${brand}1f`, '--glow-2': dark ? `${second}2e` : `${second}17`,
    },
    meta: headA, // browser toolbar color on phones
  };
}

// A team badge: the abbreviation in white on the team's darker ("jersey") color, ringed with its other color.
// Our own artwork, used instead of team logos. White text always reaches 4.5:1.
export function teamBadge(abbr, fallback) {
  const t = TEAMS.find((x) => x.abbr === abbr);
  const a = t ? t.color : (fallback ? (fallback.startsWith('#') ? fallback : '#' + fallback) : '#5f5a6e');
  const b = t ? t.alt : '#ffffff';
  const [jersey, trim] = contrast(a, WHITE) >= contrast(b, WHITE) ? [a, b] : [b, a];
  return { bg: fitContrast(jersey, WHITE, 4.5), ink: WHITE, ring: trim };
}

// Team colors for a single team button on the picks page: a border that stays visible (3:1) on the panel.
export function teamEdge(hex, panel) {
  if (!hex) return null;
  return fitContrast(hex.startsWith('#') ? hex : '#' + hex, panel, 3);
}

// ---------- applying (browser only) ----------
const KEY = 'sp_theme';
export function loadChoice() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
export function saveChoice(choice) {
  try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch {}
}
export function resolveMode(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme(themeId, mode) {
  const built = buildTheme(themeId, resolveMode(mode));
  const root = document.documentElement;
  for (const [k, v] of Object.entries(built.vars)) root.style.setProperty(k, v);
  root.style.colorScheme = built.mode;
  root.dataset.mode = built.mode;
  root.dataset.theme = built.id;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
  meta.content = built.meta;
  // Cached so the next visit paints in the right colors before any script loads (no flash).
  try { localStorage.setItem('sp_theme_vars', JSON.stringify({ vars: built.vars, mode: built.mode, meta: built.meta })); } catch {}
  return built;
}
