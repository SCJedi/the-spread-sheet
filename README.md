# Picks Pool

A lightweight website for entering and viewing weekly NFL picks with friends and family. It replaces the shared Google Sheet. It's a communication tool for fun: **the site never handles money or stores pool data.**

- **Everyone can view the board** at any time, with no login.
- **Each player can only edit their own picks.** Nobody can type into someone else's row by mistake.
- **Picks lock at each game's kickoff.** The server enforces this.
- **Picks stay hidden (✓) until kickoff**, so nobody can copy. You can turn this off in Settings.
- **The schedule, scores and winners fill in automatically** from the data source you choose: automatic NFL scores, your own feed with an API key, or manual entry. There's no weekly sheet to build and no conditional formatting to fix.
- **A real leaderboard, not a spreadsheet.** Standings show rank, wins, tiebreak and your pool payout on every row, at any screen size. Each row has a strip of per-game results (✓ won · ✕ lost · – no pick · ▲▼ leading or trailing live · • to play), and tapping a player opens their picks. The **Games** view shows how the group split on each game and who picked what. On a wide screen, the strip lays out as columns, like a grid with nothing to scroll sideways.
- **Wins, ranks and the tiebreaker** (Monday night combined points: closest wins, over or under) are calculated for you.
- **The board shows who is still alive.** Players who can no longer catch the leader are greyed out.
- **A change log** records every pick change and who made it. Use it to settle "I picked the other team" arguments.
- **CSV export** of any week, laid out like the old sheet.

## Themes

The default theme is **Neon Kickoff** (electric violet into hot pink). Tap the 🎨 button for 32 more color themes in Auto, Light or Dark, each with its own name, a colors label and a city. For example: **Prairie Fire** · Red & Gold · Kansas City, or **Forge** · Black & Gold · Pittsburgh. Each viewer's choice is saved on their own device. The commissioner can set the site's default theme in Settings.

Themes use colors and place names only, never team names or logos. Teams in games appear as our own badges: the team code on its colors.

Every theme is generated from two colors. It's adjusted so all text meets the WCAG 2.2 AA contrast standard in both light and dark, and an automated test checks every combination. Win and loss colors are the same in every theme, and losses are also struck through, so they read without relying on color.

## Built for phones

- On phones, navigation sits in a bottom tab bar.
- Every button and tap target is at least 44px.
- Text fields don't trigger iPhone zoom.
- Layouts respect the notch and the home bar.
- Nothing scrolls sideways except the big picks table.
- Motion turns off when the phone's "reduce motion" setting is on.

## Pool calculator

If a group runs a pool offline, anyone can model it on the board. Open **Pool calculator** and set:
- the amount per entry and its unit (`$`, `pts`, `🍺`, anything)
- the payout split (winner takes all, 70/30, 60/30/10, or custom)
- how ties are handled (the tiebreak decides, or split evenly)
- who's in (untick players to leave them out)

A payout column appears in the table. It updates live as games finish, and shows "if it ended now" until the week is final.

All of this is math in the viewer's own browser. It's remembered on their device and never sent to the site. **Copy share link** puts the settings in a URL so others can see the same calculation. The commissioner can also save one set of settings as a suggestion, which anyone can load with **Use commissioner's suggestion**.

## Where scores come from

Choose in **Admin → Data source**:
- **Automatic** (default): ESPN's public NFL scoreboard. Free, no key, updates every 10 minutes. It's unofficial and could change or stop without notice.
- **Your own feed:** any URL that returns games as simple JSON, with an optional API key. Use a sports-data service, your own script, or another league.
- **Manual:** no feed. The commissioner types in the games and final scores.

**Test connection** checks a feed before you switch. [FEED.md](FEED.md) explains the format.

## Hosting

It runs free on Cloudflare: Workers serves the site and D1 is the database. There's no server to look after. A built-in timer refreshes scores every 10 minutes.

### One-time setup (about 10 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and [Node.js](https://nodejs.org) (LTS).

```bash
npm install
npx wrangler login                    # opens a browser to sign in to Cloudflare
npx wrangler d1 create sportspicks    # prints a database_id
```

Paste that `database_id` into `wrangler.toml`, then:

```bash
npx wrangler deploy
```

It prints your site's address, for example `https://sportspicks.<you>.workers.dev`.

1. **Open the address and create the pool.** The first person to sign up becomes the commissioner.
2. **Go to Admin → Players and copy the invite link.** It already contains the join code. Text it to the group.
3. **Go to Admin → Settings and set the name.** Optionally, set suggested calculator settings from the board.

The database tables create themselves on first visit.

## Every week

With a feed, you don't have to do anything for the games themselves. The current week appears on its own (the automatic source rolls over around Wednesday). To open picks earlier, use **Admin → This week → Load next week early**. In manual mode, add the week and its games in **Admin → This week**, then type the scores as games finish.

Commissioner tools:
- **Enter picks:** for anyone who texts you their picks. This works even after kickoff, and every change goes in the change log.
- **This week:** the board message (bye weeks, reminders) and a different tiebreak game if you want one.
- **Results:** winners come in automatically. Override a game only if the feed is wrong or stuck.
- **Players:** rename, set "with" labels, reset a forgotten PIN, or add people who don't use the site themselves.

Five wrong PINs locks a name out for 15 minutes.

## Scoring rules

- One point per correct pick. A missing pick on a finished game counts as a miss, never a win.
- A tied game gives nobody the point.
- The tiebreak is the combined final score of the tiebreak game (the last game of the week unless changed). Closest guess wins, whether over or under. Equal distance shares the place.

## Running it on your own computer

```bash
npm run dev     # http://localhost:8787 with a local database
npm test        # scoring, pool calculator, theme contrast and feed validation
```

## Free-tier notes

Cloudflare's free plan allows 100,000 site requests a day and 5 million database rows read a day. Each week is stored as one precomputed row, so a board load reads about 15 rows instead of about 1,000 (counted locally on a 52-player week). The board refreshes every minute while games are live and every 5 minutes otherwise. A group of about 60 should stay well inside the limits. That's an estimate: it hasn't been load-tested.

If the automatic feed ever stops working, everything else keeps running. Switch to your own feed or to manual entry.

## Disclaimer

Just for fun. Picks Pool handles no money. It is not affiliated with, endorsed by or sponsored by the NFL, any team, or ESPN. Team names and codes are used only to identify real games, and colors only to describe themes. No logos or team artwork are included. Provided as-is under the MIT License. See [NOTICE.md](NOTICE.md) for the full disclaimer and credits.
