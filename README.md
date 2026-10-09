# The Spread Sheet

**Your picks sheet, minus the spreadsheet.**
Straight-up picks with friends. No spreadsheets, no betting.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SCJedi/the-spread-sheet)

Try the live demo: {{DEMO_URL}}

Free and open source. Made by [Infinite Visions AI](https://www.infinitevisionsaiagents.com/?utm_source=the-spread-sheet&utm_medium=readme&utm_campaign=giveaway). Want software like this for your business? [Schedule a 20-min discovery call](https://www.infinitevisionsaiagents.com/schedule.html?utm_source=the-spread-sheet&utm_medium=readme&utm_campaign=giveaway).

The Spread Sheet is a free website for a weekly game-picks pool among friends, family or coworkers. Everyone can view the board without logging in. Players log in with a name and a 4 to 8 digit PIN to make their own picks. Picks lock at each game's kickoff. Scores and winners fill in automatically. It handles no money and is not betting. It runs on a free Cloudflare account, and GitHub is free too.

## Set it up in 10 minutes, no coding

No coding needed. Do one step at a time, and each one takes a minute or two.

1. **Make a free GitHub account.** Go to [github.com/signup](https://github.com/signup). Check your email and verify it.
2. **Make a free Cloudflare account.** Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Check your email and verify it. You do not need a credit card for the free plan.
3. **Click the "Deploy to Cloudflare" button** at the top of this page.
4. **Sign in and connect GitHub** when Cloudflare asks. Let Cloudflare make a repository in your GitHub account. It copies the project there for you.
5. **Keep the defaults on the setup page.** Leave the project name, Worker name and database name as they are. Press **Create and deploy**. Cloudflare makes the database for you.
6. **Wait about 1 to 3 minutes** while it builds. When it is done, Cloudflare shows your site's address. It looks like `https://the-spread-sheet.<your-name>.workers.dev`. The first time, Cloudflare may ask you to pick the `<your-name>` part (your workers.dev subdomain).
7. **Open your address.** You are the first one there, so you become the commissioner. Pick your display name and a 4 to 8 digit PIN.
8. **Invite everyone.** Go to **Admin → Players** and copy the invite link. The join code is already in it. Text it to your group. They open it, pick a name and a PIN, and they are in.
9. **Optional:** go to **Admin → Settings** for the pool name, theme, and hiding picks until kickoff. Go to **Admin → Data source** to choose where scores come from.

Done. The schedule, scores and winners update by themselves every 10 minutes. The database tables set themselves up on the first visit.

**Want pictures?** Every install has a picture-by-picture interactive guide at `/setup-guide.html` on your own site (in this repo it is [public/setup-guide.html](public/setup-guide.html)). If you can't open anything else, read [START-HERE.txt](START-HERE.txt).

## Features

- **Everyone can view the board** at any time, with no login.
- **Each player can only edit their own picks.** Nobody can type into someone else's row by mistake.
- **Picks lock at each game's kickoff.** The server enforces this.
- **Picks stay hidden (a lock icon) until kickoff**, so nobody can copy. You can turn this off in Settings.
- **Schedule, scores and winners fill in automatically** from the data source you choose. There's no weekly sheet to build.
- **A real leaderboard.** Standings show rank, wins, tiebreak and the pool payout on every row, at any screen size. Each row has a strip of per-game results (✓ won · ✕ lost · – no pick · ▲▼ leading or trailing live · • to play). Tap a player to see their picks. The **Games** view shows how the group split on each game.
- **Wins, ranks and the tiebreaker** (combined points in the tiebreak game: closest wins, over or under) are calculated for you.
- **Who is still alive.** Players who can no longer catch the leader are greyed out.
- **A Season tab** adds up the whole season: total correct picks, weeks won 🏆 (shared ties count), week-by-week records, best and toughest weeks, and streaks of correct picks. The commissioner can switch each part on or off.
- **Next week opens on its own** as soon as this week's last game kicks off, so people can pick ahead. The commissioner can choose "this week only" or "the whole season" instead.
- **Print and export:** print the board, blank pick sheets people fill in by hand, or a tally sheet for running a pool on paper. Download any week or the season as CSV (opens in Excel or Google Sheets) or JSON. See [API.md](API.md) for the read API.
- **A change log** records every pick change and who made it.
- **CSV export** of any week.

### Themes

The default theme is **Neon Kickoff** (electric violet into hot pink). Tap the 🎨 button for 33 more color themes in Auto, Light or Dark, each with its own name, a colors label and a city, for example **Prairie Fire** · Red & Gold · Kansas City. Each viewer's choice is saved on their own device. The commissioner can set the site's default theme in Settings.

Themes use colors and place names only, never team names or logos. Teams in games appear as our own badges: the team code on its colors. Every theme is generated from two colors and adjusted so text meets WCAG 2.2 AA contrast in light and dark; an automated test checks every combination. Win and loss colors are the same in every theme, and losses are also struck through.

### Built for phones

Bottom tab bar on phones, tap targets of at least 44px, no iPhone zoom on text fields, room for the notch and home bar, nothing scrolls sideways, and motion turns off when "reduce motion" is on.

### Pool calculator

If a group runs a pool offline, anyone can model it on the board. Open **Pool calculator** and set the amount per entry and its unit (`$`, `pts`, `🍺`, anything), the payout split (winner takes all, 70/30, 60/30/10, or custom), how ties are handled, and who's in. A payout column appears and updates live, showing "if it ended now" until the week is final.

All of this is math in the viewer's own browser. It's remembered on their device and never sent to the site. **Copy share link** puts the settings in a URL. The commissioner can save one set of settings as a suggestion, which anyone can load with **Use commissioner's suggestion**.

### Scoring rules

- One point per correct pick. A missing pick on a finished game counts as a miss, never a win.
- A tied game gives nobody the point.
- The tiebreak is the combined final score of the tiebreak game (the last game of the week unless the commissioner changes it). Closest guess wins, over or under. Equal distance shares the place.

## Every week

Nothing is required. Next week opens for picks as soon as this week's last game kicks off (Admin → Settings → "Open picks for" changes that), and the board moves to the new week when the automatic source rolls over, around Wednesday. Past weeks stay in the week picker all season.

Commissioner extras:
- **Enter picks** for people who text their picks. It works after kickoff, and everything goes in the change log.
- **The board message** and **the tiebreak game** in Admin → This week.
- **Result overrides**, only if the feed is wrong or stuck.
- **Player PIN resets** in Admin → Players.

## Data sources

Choose in **Admin → Data source**:
- **Automatic** (default): ESPN's public NFL scoreboard. Free, no key, unofficial (it could change or stop).
- **Your own feed:** any https URL returning the JSON format in [FEED.md](FEED.md), with an optional API key (sent as `Authorization: Bearer <key>`). **Test connection** checks it first.
- **Manual:** no feed. Add the week and its games, then type final scores.

## Recovery: the commissioner forgot their PIN

Players who forget their PIN ask the commissioner (**Admin → Players → New PIN → Save**). If the commissioner forgets theirs:

1. Open [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → your project (`the-spread-sheet`) → **Settings** → **Variables and Secrets** → **Add**.
2. Type `RECOVERY_PIN` as the name and a new 4 to 8 digit PIN as the value. Save and deploy.
3. Open your site, **Log in**, and type your commissioner name and that new PIN. It becomes your PIN.
4. Go back and **delete** the `RECOVERY_PIN` variable. The site shows a reminder until you do.

## Troubleshooting

| What you see | What to do |
|---|---|
| "No games loaded yet" right after setup | Wait one minute and refresh. The schedule loads on the first visit. |
| The button says the repository can't be found | The repo must be public. Check the link is exactly `https://github.com/SCJedi/the-spread-sheet`. |
| Cloudflare asks for a workers.dev subdomain | Pick any short name. It becomes part of your site address. |
| The build failed | Open the deployment in the Cloudflare dashboard and press **Retry deployment**. If it fails twice, open an issue on the GitHub repo. |
| A player forgot their PIN | The commissioner resets it in Admin → Players. |
| The commissioner forgot their PIN | See Recovery above. |
| Five wrong PINs | That name is locked for 15 minutes. |
| Scores stopped updating | The automatic feed is unofficial. Switch to Manual or your own feed in Admin → Data source. |

## Developer path

For people comfortable with a terminal. Architecture, invariants and extension points for developers and AI coding agents are in [AGENTS.md](AGENTS.md).

```bash
git clone https://github.com/SCJedi/the-spread-sheet
cd the-spread-sheet
npm install
npm run dev            # http://localhost:8787 with a local database
npm test               # unit tests
npx wrangler login
npx wrangler d1 create the-spread-sheet   # paste the printed database_id into wrangler.toml
npx wrangler deploy
```

It runs on Cloudflare Workers (the site) and D1 (the database), with a built-in timer that refreshes scores every 10 minutes. There is no build step.

**Free-tier notes.** Cloudflare's free plan allows 100,000 site requests a day and 5 million database rows read a day. Each week is stored as one precomputed row, so a board load reads about 15 rows instead of about 1,000 (counted locally on a 52-player week). The board refreshes every minute while games are live and every 5 minutes otherwise. A group of about 60 should stay well inside the limits. That's an estimate: it hasn't been load-tested.

## Made by Infinite Visions AI

**We build the software your business actually needs.**

The Spread Sheet is a free giveaway from [Infinite Visions AI](https://www.infinitevisionsaiagents.com/?utm_source=the-spread-sheet&utm_medium=readme&utm_campaign=giveaway), a small studio in Sarasota, Florida that builds custom software and AI agents for businesses. If you like how this works and want something built for your business, club or team, [schedule a 20-min discovery call](https://www.infinitevisionsaiagents.com/schedule.html?utm_source=the-spread-sheet&utm_medium=readme&utm_campaign=giveaway).

You're free to change anything. We'd be grateful if you kept the small "made by Infinite Visions AI" credit in the footer: it is how people who like this find the people who built it.

## Disclaimer

Just for fun: no money is handled and nothing here is betting. Not affiliated with, endorsed by or sponsored by the NFL, any team, or ESPN. Team names and codes are used only to identify real games, and colors only to describe themes. No logos or team artwork are included. Provided as-is under the MIT License, © 2026 Infinite Visions AI LLC. Full text: [NOTICE.md](NOTICE.md).

## License

MIT. See [LICENSE](LICENSE). The copyright line in `LICENSE` must stay, per the license.
