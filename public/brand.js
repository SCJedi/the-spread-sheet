// Product and maker identity, in one place. Every credit, call to action and link in the app reads from here.
export const BRAND = {
  product: 'The Spread Sheet',
  tagline: 'Your picks sheet, minus the spreadsheet.',
  promise: 'Straight-up picks with friends. No spreadsheets, no betting.',
  maker: 'Infinite Visions AI',
  makerLegal: 'Infinite Visions AI LLC',
  makerLine: 'We build the software your business actually needs.',
  site: 'https://www.infinitevisionsaiagents.com/',
  schedule: 'https://www.infinitevisionsaiagents.com/schedule.html',
  cta: 'Schedule a 20-min discovery call',
  repo: 'https://github.com/SCJedi/the-spread-sheet',
  // The maker's own identity (from infinitevisionsaiagents.com): text logo "Infinite Visions AI" with "AI" in blue.
  colors: { blue: '#2563eb', blueLight: '#3b82f6', sky: '#0ea5e9', navy: '#0f172a' },
};

// Outbound links carry UTM tags so the maker's analytics can tell which giveaway, and which spot in it, sent the visit.
// The app itself tracks nothing.
export function brandLink(url, spot) {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'the-spread-sheet');
  u.searchParams.set('utm_medium', 'app');
  u.searchParams.set('utm_campaign', 'giveaway');
  u.searchParams.set('utm_content', spot);
  return u.toString();
}
