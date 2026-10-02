# Connecting your own data feed

Picks Pool can get games and scores from three places. Choose one in **Admin → Data source**.

| Source | Use it when |
|---|---|
| **Automatic** (default) | You want the NFL with zero setup. It uses ESPN's public scoreboard, which is unofficial and needs no key. |
| **Your own feed** | You have a sports-data service, your own script, or a league ESPN doesn't cover. |
| **Manual** | You'd rather type the games and final scores yourself. Works for any sport or office pool. |

## Your own feed

Give Picks Pool a web address (it must start with `https://`) that returns JSON in this shape:

```json
{
  "season": 2026,
  "type": 2,
  "week": 5,
  "label": "Week 5",
  "games": [
    {
      "id": "g1",
      "kickoff": "2026-10-11T17:00:00Z",
      "away": "NE",
      "home": "BUF",
      "away_score": null,
      "home_score": null,
      "state": "pre"
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `season` | yes | The year the season started, for example `2026`. |
| `type` | no | `1` preseason, `2` regular season (the default), `3` playoffs. |
| `week` | yes | 1 to 30. |
| `label` | no | What the week is called on screen. Defaults to "Week 5". |
| `games[].id` | yes | Any id that stays the same for the same game. |
| `games[].kickoff` | yes | An ISO date-time, or milliseconds since 1970. Picks lock at this moment. |
| `games[].away`, `home` | yes | Short team codes, 1 to 5 letters or digits ("KC", "BUF"). For NFL teams, the usual codes also give the team badge its colors. |
| `games[].state` | no | `pre` (not started, the default), `in` (playing), `post` (final). |
| `games[].away_score`, `home_score` | no | Numbers, or `null` before kickoff. |
| `games[].winner` | no | The winning team's code or `"TIE"`. If you leave it out, it's worked out from the scores when `state` is `post`. |
| `games[].detail` | no | A short status like "Q3 5:12" or "Final/OT". |
| `games[].home_color`, `away_color` | no | A hex color like `"#0a2343"` for teams the app doesn't know. |

JSON in ESPN's scoreboard format is also accepted. Picks Pool recognises it automatically.

### Loading a specific week

Put `{season}`, `{week}` and `{type}` anywhere in the URL:

```
https://example.com/scores.json?season={season}&week={week}&type={type}
```

For a specific week, they're filled in, for example `season=2026&week=5&type=2`. To ask for **the current week**, they're left empty (`season=&week=&type=`), and your feed should then return whichever week is current.

### API keys

If your feed needs a key, paste it into **API key**. It's sent with every request as:

```
Authorization: Bearer <your key>
```

The key is stored on your server and is never shown again or sent to anyone's browser. To change it, type a new one. To remove it, tick "Remove the saved key".

### Testing

**Test connection** fetches the feed and shows the games it found, without changing anything. If something is wrong, it tells you which game and which field. Press **Save** when the test looks right.

How often it updates: every 10 minutes on a timer, and whenever someone opens the board and the last check was more than 5 minutes ago.

## Manual

In manual mode, nothing is fetched. In **Admin → This week**:

1. **Add a week:** season, part of the season, and week number. The new week becomes the current one.
2. **Add games:** away team, home team and kickoff time. Picks lock at the kickoff you set.
3. **After each game,** type both scores and set it to **Final**. The winner and everyone's standings update straight away.

Games you add by hand can be edited or deleted at any time. Deleting a game also removes the picks made on it.
