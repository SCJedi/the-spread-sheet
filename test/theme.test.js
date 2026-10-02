import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, toOklch, oklch, buildTheme, THEMES, teamEdge, teamBadge } from '../public/theme.js';
import { TEAMS } from '../public/teams.js';

// Reference values from outside this code, so the formula is not checked against itself.
test('contrast formula matches published WCAG reference values', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#ffffff', '#ffffff').toFixed(2), '1.00');
  assert.equal(contrast('#767676', '#ffffff').toFixed(2), '4.54'); // the classic lightest AA grey on white
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48'); // one step lighter fails
});

test('OKLCH round-trips sRGB colors', () => {
  for (const hex of ['#a40227', '#ffb612', '#002a5c', '#69be28', '#7c3aed']) {
    const { L, C, H } = toOklch(hex);
    assert.equal(oklch(L, C, H), hex);
  }
});

test('all 32 NFL teams are present with valid colors', () => {
  assert.equal(TEAMS.length, 32);
  for (const t of TEAMS) assert.match(t.color + t.alt, /^#[0-9a-f]{6}#[0-9a-f]{6}$/i, t.abbr);
});

const pairs = (v) => [
  ['ink on bg', v['--ink'], v['--bg'], 4.5],
  ['ink on panel', v['--ink'], v['--panel'], 4.5],
  ['ink on raised', v['--ink'], v['--raised'], 4.5],
  ['muted on panel', v['--muted'], v['--panel'], 4.5],
  ['muted on bg', v['--muted'], v['--bg'], 4.5],
  ['accent text on panel', v['--accent-text'], v['--panel'], 4.5],
  ['accent text on bg', v['--accent-text'], v['--bg'], 4.5],
  ['accent text 2 on panel', v['--accent-text-2'], v['--panel'], 4.5],
  ['label on accent button', v['--accent-ink'], v['--accent'], 4.5],
  ['accent button vs panel (UI part)', v['--accent'], v['--panel'], 3],
  ['header text on gradient start', v['--top-ink'], v['--top'], 4.5],
  ['header text on gradient end', v['--top-ink'], v['--top-2'], 4.5],
  ['ink on selected tint', v['--ink'], v['--sel'], 4.5],
  ['ink on my-row tint', v['--ink'], v['--me'], 4.5],
  ['live label on panel', v['--warn'], v['--panel'], 4.5],
  ['win text', v['--win-ink'], v['--win'], 4.5],
  ['loss text', v['--loss-ink'], v['--loss'], 4.5],
  ['live leading chip (win ink on panel)', v['--win-ink'], v['--panel'], 4.5],
  ['live trailing chip (loss ink on panel)', v['--loss-ink'], v['--panel'], 4.5],
  ['muted on raised (chips, tiles)', v['--muted'], v['--raised'], 4.5],
];

for (const mode of ['light', 'dark']) {
  test(`every theme meets WCAG AA in ${mode} mode`, () => {
    const failures = [];
    for (const t of THEMES) {
      const { vars } = buildTheme(t.abbr, mode);
      for (const [what, fg, bg, min] of pairs(vars)) {
        const c = contrast(fg, bg);
        if (c < min) failures.push(`${t.abbr} ${what}: ${c.toFixed(2)} < ${min}`);
      }
    }
    assert.deepEqual(failures, []);
  });
}

// Contrast alone is easy to pass by turning everything grey. This guards the other half: the team's hue survives.
test('themes keep each team\'s hue (contrast is not won by going grey)', () => {
  const drift = [];
  for (const mode of ['light', 'dark']) {
    for (const t of THEMES) {
      const { vars } = buildTheme(t.abbr, mode);
      // Spec: the team's listed main color, or its second color when the main one is black/white/grey.
      const main = toOklch(t.color), other = toOklch(t.alt);
      const brand = main.C >= 0.04 || main.C >= other.C ? main : other;
      if (brand.C < 0.05) continue; // black/silver teams have no hue to keep
      const got = toOklch(vars['--accent']);
      const d = Math.min(Math.abs(got.H - brand.H), 360 - Math.abs(got.H - brand.H));
      if (got.C < 0.03 || d > 12) drift.push(`${t.abbr} ${mode}: hue ${brand.H.toFixed(0)} -> ${got.H.toFixed(0)}, chroma ${got.C.toFixed(3)}`);
    }
  }
  assert.deepEqual(drift, []);
});

test('themes are actually different from each other', () => {
  const accents = new Set(THEMES.map((t) => buildTheme(t.abbr, 'light').vars['--accent']));
  assert.ok(accents.size >= 28, `only ${accents.size} distinct accents`);
});

test('team edge colors stay visible on light and dark panels', () => {
  for (const t of TEAMS) {
    for (const panel of ['#ffffff', buildTheme('DEFAULT', 'dark').vars['--panel']]) {
      assert.ok(contrast(teamEdge(t.color, panel), panel) >= 3, `${t.abbr} on ${panel}`);
    }
  }
});

test('team badges keep white text at 4.5:1, including unknown teams', () => {
  for (const t of TEAMS) { const b = teamBadge(t.abbr); assert.ok(contrast(b.ink, b.bg) >= 4.5, t.abbr); }
  const custom = teamBadge('XYZ', 'ffd700'); // a manual-mode team with a bright color
  assert.ok(contrast(custom.ink, custom.bg) >= 4.5);
});

test('themes carry our own names, a colors label and a city, never team names', () => {
  const names = new Set(THEMES.map((t) => t.theme));
  assert.equal(names.size, THEMES.length);
  for (const t of TEAMS) {
    assert.ok(t.theme && t.colors && t.city, t.abbr);
    assert.ok(!t.theme.toLowerCase().includes(t.short.toLowerCase()), `${t.abbr} theme name uses the team nickname`);
  }
});
