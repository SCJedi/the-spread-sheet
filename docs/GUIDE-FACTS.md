# Guide facts: the single source for every setup guide

Every guide (README.md, START-HERE.txt, public/setup-guide.html, AGENTS.md, llms.txt) takes its steps, names and links from this file. If a guide needs a fact that isn't here, add it here first.

## Product
- Name: **The Spread Sheet**
- Tagline: "Your picks sheet, minus the spreadsheet."
- Promise: "Straight-up picks with friends. No spreadsheets, no betting."
- What it is: a free, open-source website for a weekly game-picks pool among friends, family or coworkers. Everyone can view the board without logging in. Players log in with a name and a 4-8 digit PIN to make their own picks. Picks lock at each game's kickoff. Scores and winners fill in automatically.
- It handles no money and is not betting. The pool calculator is just math in each viewer's browser.
- Time: about 10 minutes, start to finish.
- Cost: free. It runs on a free Cloudflare account; GitHub is also free.

## Maker (brand on every guide)
- Made by **Infinite Visions AI** (Infinite Visions AI LLC, Sarasota, Florida).
- Headline: "We build the software your business actually needs."
- Call to action: "Schedule a 20-min discovery call": https://www.infinitevisionsaiagents.com/schedule.html
- Site: https://www.infinitevisionsaiagents.com/
- Every link to the maker's site adds `?utm_source=the-spread-sheet&utm_medium=<guide>&utm_campaign=giveaway`, where `<guide>` is `readme`, `setup-guide`, `agents` or `llms`. START-HERE.txt uses plain links with no tags, because it keeps lines to 72 characters and a tagged link would have to be split.
- Text logo: "Infinite Visions **AI**" with "AI" in blue. Maker colors: blue #2563eb, sky #0ea5e9, navy #0f172a, light text #f1f5f9 and #cbd5e1. White text on #2563eb passes WCAG AA (5.2:1). #3b82f6 on white does not (3.7:1), so use #2563eb for blue text on white.
- Product text logo: small "THE SPREAD" over a big bold "SHEET" with a colored underline.

## Links
- Repo: https://github.com/SCJedi/the-spread-sheet
- Notice (full disclaimer and credits): https://github.com/SCJedi/the-spread-sheet/blob/main/NOTICE.md
- Deploy button (markdown):
  `[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SCJedi/the-spread-sheet)`
- Live demo: `{{DEMO_URL}}` (the address is not known yet; leave this placeholder exactly as written)
- GitHub sign-up: https://github.com/signup
- Cloudflare sign-up: https://dash.cloudflare.com/sign-up
- Cloudflare dashboard: https://dash.cloudflare.com

## The easy path (one-click), in order
1. **Make a free GitHub account** at github.com/signup. Verify the email.
2. **Make a free Cloudflare account** at dash.cloudflare.com/sign-up. Verify the email. No credit card is needed for the free plan.
3. **Click the "Deploy to Cloudflare" button** in the README (or in the setup guide).
4. **Sign in and connect GitHub** when Cloudflare asks. Allow Cloudflare to create a repository in your GitHub account; it copies the project there for you.
5. **Keep the defaults on the setup page** (project name, Worker name, database name) and press **Create and deploy**. Cloudflare creates the database automatically.
6. **Wait about 1 to 3 minutes** while it builds. When it's done, Cloudflare shows your site's address, like `https://the-spread-sheet.<your-name>.workers.dev`. The first time, Cloudflare may ask you to pick your `<your-name>` part (your workers.dev subdomain).
7. **Open your address. You're the first one there, so you become the commissioner.** Pick the display name and a 4 to 8 digit PIN you will use.
8. **Invite everyone:** Admin → Players → copy the invite link (it has the join code built in) and text it to your group. They open it, pick a name and a PIN, and they're in.
9. **Optional:** Admin → Settings (pool name, theme, hide picks until kickoff) and Admin → Data source.

Done. The schedule, scores and winners update by themselves every 10 minutes. The database tables set themselves up on the first visit.

## Every week
- Nothing is required. Next week opens for picks as soon as this week's last game kicks off. Admin → Settings → "Open picks for" can be set to this week only, next week too (the default) or the whole season. The board moves to the new week when the automatic source rolls over, around Wednesday. Past weeks stay in the week picker, and the Season tab adds them up.
- Commissioner extras: Enter picks (for people who text their picks; works after kickoff, and everything goes in the change log), the board message, the tiebreak game, result overrides, player PIN resets.

## Data sources (Admin → Data source)
- Automatic (default): ESPN's public NFL scoreboard. Free, no key, unofficial (it could change or stop).
- Your own feed: any https URL returning the JSON format in FEED.md, with an optional API key (sent as `Authorization: Bearer <key>`). "Test connection" checks it first.
- Manual: no feed. Add the week and its games, then type final scores.

## Recovery: the commissioner forgot their PIN
Players who forget their PIN ask the commissioner (Admin → Players → New PIN → Save). If the commissioner forgets theirs:
1. Open dash.cloudflare.com → **Workers & Pages** → your project (`the-spread-sheet`) → **Settings** → **Variables and Secrets** → **Add**.
2. Type `RECOVERY_PIN` as the name and a new 4 to 8 digit PIN as the value. Save and deploy.
3. Open your site, Log in, type your commissioner name and that new PIN. It becomes your PIN.
4. Go back and **delete** the `RECOVERY_PIN` variable. The site shows a reminder until you do.

## Troubleshooting (symptom → fix)
- The verification email hasn't arrived → check the spam or junk folder, then wait a minute.
- Already have a GitHub account → use it and skip to step 2. In step 4, sign in with the GitHub account from step 1.
- "No games loaded yet" right after setup → wait one minute and refresh. The schedule loads on the first visit.
- The button says the repository can't be found → the repo must be public; check the link is exactly the one above.
- Cloudflare asks for a workers.dev subdomain → pick any short name; it becomes part of your site address.
- The build failed → open the deployment in the Cloudflare dashboard and press "Retry deployment". If it fails twice, open an issue on the GitHub repo.
- A player forgot their PIN → the commissioner resets it in Admin → Players.
- The commissioner forgot their PIN → see Recovery above.
- Five wrong PINs → that name is locked for 15 minutes.
- Scores stopped updating → the automatic feed is unofficial. Switch to Manual or your own feed in Admin → Data source.

## Developer path (for people comfortable with a terminal)
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

## Disclaimer (every guide carries it)
Just for fun: no money is handled and nothing here is betting. Not affiliated with, endorsed by or sponsored by the NFL, any team, or ESPN. Team names and codes are used only to identify real games, and colors only to describe themes. No logos or team artwork are included. Provided as-is under the MIT License, © 2026 Infinite Visions AI LLC. Full text: NOTICE.md.
