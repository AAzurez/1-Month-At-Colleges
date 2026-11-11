# CollegeExperience

A month-long college life sim for the COMMs Fall 26 hackathon. The player walks Sam around a campus map from Thursday, October 1 until the game ends at midnight on November 1. Sam makes choices that change stats, meets up to 10 people, and three of those people are AI agents with their own personalities and memory.

## Layout

```
web/
  server.mjs       Node HTTP server (no framework). Serves the page, owns game state, calls the agent.
  world-new.mjs    All game rules and content: events, people, weather, jobs, calendar, stat math,
                   plus recording of memories during play (log, tally, moments).
  recap.mjs        buildRecap(state): end-of-game highlights, impact on others, decision analysis, memories.
  index-new.html   The whole frontend in one file (HTML + CSS + JS, no build step).
  state.json       The saved game. Gitignored. Delete it, or use "Start a new game", to reset.
  index.html, world.mjs   Older copies. Not served or imported. Leave them alone unless asked.
db/
  schema.sql       Postgres tables: choices, agent_replies.
  tiger.sql        Tiger Data (TimescaleDB): stat_history hypertable, one row per game hour.
  setup.mjs        `npm run db:setup`: creates the tables, plus the hypertable when TimescaleDB is available.
  memory.mjs       saveChoice / saveReply / listMemories / formatMemories / dbQuery (uses DATABASE_URL).
  history.mjs      recordSnapshot / readHistory for stat_history (time_bucket + last()).
solana/
  ledger.mjs       Stat "currencies" on Solana devnet, minted or burned after every interaction.
  setup.mjs        `npm run solana:setup`: treasury, 11 token mints, wallets for everyone, token accounts.
  config.json, balances.json   Written by setup. Devnet private keys. Gitignored, never commit.
deploy/vultr/
  setup.sh         Sets up a fresh Ubuntu 24.04 Vultr server (Node 22, systemd services, Caddy, firewall).
  README.md        Step-by-step hosting guide.
agents/
  person1/         Captain. Receives every agent-bound choice through bot/channels/event.ts.
  person2/         Spark.
  person3/         Sage.
.env               DATABASE_URL=... (read by db/memory.mjs if the env var is not set). Point it at Tiger Data.
```

The live files are the `-new` ones: `server.mjs` imports `./world-new.mjs` and serves `index-new.html`.

## Running it

```
npm install                      # root: pg, @solana/web3.js 1.98.4, @solana/spl-token 0.4.14
npm run db:setup                 # once, after DATABASE_URL is set
npm run solana:setup             # once, optional (needs devnet SOL from faucet.solana.com)
cd agents/person1 && npm install # likewise person2, person3
agent-sdk dev ./agents           # agents on http://127.0.0.1:3000
node web/server.mjs              # game on http://127.0.0.1:4000
```

- `PORT` changes the game port (default 4000). `HOST` changes the bind address (default `127.0.0.1`; only expose it behind a proxy).
- `SOLANA_RPC` / `SOLANA_CLUSTER` change the Solana endpoint for setup (default devnet).
- `AGENT_URL` overrides the agent endpoint (default `http://127.0.0.1:3000/person1/v1/channels/event/choice`).
- Node only reads `world-new.mjs` and `server.mjs` at startup, so restart the server after editing them. Changes to `index-new.html` only need a browser refresh (Ctrl+F5).
- With no database, choices still work. The server returns a `dbWarning` instead of failing.

## Server behavior

- **One change at a time:** every change to the save goes through `updateState(change)` in `server.mjs`. It is a promise queue, so concurrent requests (chats, the hourly tick, choices) can't overwrite each other.
- **Clock limit:** `/hours` moves the clock at most once per `HOUR_MS` (9 s), so extra tabs or players don't speed up time.
- **Agent timeout:** calls to the agent give up after `AGENT_TIMEOUT_MS` (90 s, settable by env). The choice still counts.
- **Body limit:** request bodies over 64 KB are refused.

## Server routes

| Route | What it does |
|---|---|
| `GET /` | Serves `index-new.html` |
| `GET /state` | `{ state, events, meetings, calendar, skills, interests, weather, burnoutLimit, strainLimit, occupations }`. The page builds everything from this. |
| `POST /hours` | Advances the clock 1 hour (the page calls it every 10 real seconds). |
| `POST /reset` | New game. |
| `POST /choices` `{ playerId, eventId }` | Applies the event, saves it to Postgres, logs a stat snapshot, queues a Solana sync for interactions with people, and for character conversations waits for Captain's reply. |
| `POST /chats` `{ a, b }` | Two people on the map chatted: +1 mood each (`applyChat`), then a Solana sync. |
| `GET /history` | Sam's stats over the month: `{ source: "tiger" \| "local", points: [{ t, health, hunger, happiness, money, energy, burnout }] }`. `t` = hours since Oct 1, 12 AM. |
| `GET /recap` | The end-of-game recap built by `web/recap.mjs` (see below). |
| `GET /chain?after=<id>` | Recent Solana ledger transactions for the feed (`{ enabled, entries }`). |

`/state` also returns `solana: { enabled, cluster | reason }`.

Only events with an `npc` field that are not `quiet` (talking to Captain, Spark or Sage, or telling them you're busy) call the agent. Every other choice returns right away with `quiet: true`, but is still saved so the agents see it as history later.

## How the game works (world-new.mjs)

- **Once a month:** events with `once: true` (Sell old textbooks, Apply for a scholarship) can be picked once per game. `blockedReason` checks `state.log`, and the page hides them after use.
- **Hanging out:** every person has a 4th popup option, `<id>_hangout` ("Invite them to grab food": 1 hour, $6, +30 hunger, a bigger mood boost). It counts as time together for friendships, inspiration and the recap (`relations[id].hangout`). With the three agents it waits for a reply like a talk does.
- **Weekdays only:** events with `weekdaysOnly: true` ("Go to class") are hidden on Saturday and Sunday.
- **Campus map:** the game area's background is an inline SVG in `index-new.html` (`.campus`). It shows the library, science hall, student union and dining hall around the quad, with paths, trees, benches, lamps and a fountain. Windows and lamps light up at night (`.game.night-time`). People walk anywhere; buildings don't block movement.
- **Calendar:** `CALENDAR` sets 2026-10-01 as day 0. The game starts at 7 AM, and `state.over` turns true at day 31 (November 1). `dayName`, `dateText` and `isAvailable` use real 2026 dates.
- **Time:** `advanceHour` drops hunger 5 per hour, drains 1 energy every `ENERGY_DRAIN_HOURS` (3), drifts burnout, and rolls new weather at midnight. Choices take time through `hoursFor(event, state)`, using the `hours` field (or the job's hours for work shifts). Sleep jumps to 7 AM.
- **Sam's stats:** health, hunger (100 = full), happiness, money, energy (0–5) and burnout (0–100). A new game starts at 100/100/50/$100, full energy and 0 burnout. Sam also has `skills` (soft skills), `interests` (they appear once raised), an `occupation`, and `relations` (talk/busy/ignore counts per person).
- **Burnout:** `burnoutDrift` raises it each waking hour when energy, happiness or hunger is low, and eases it when all three are healthy or Sam is asleep.
  - At `STRAIN_LIMIT` (50), ordinary energy-using choices cost +1 energy and −1 happiness. Interest choices (`isInterestChoice`: events with `interests` or `hobbyBoost`) get −3 extra burnout instead.
  - At `BURNOUT_LIMIT` (70), every choice costs −2 happiness and −1 health.
- **Weather:** in `WEATHER`, `mood` adds happiness to most choices and `outdoor` modifies events marked `outdoor: true`. A storm cancels outdoor events.
- **Jobs:** `OCCUPATIONS` defines student, campus and offCampus. Job choices use `requires: { occupations, anySkill }` and `setsOccupation`. `go_to_work` is a `workShift`, so pay, energy, burnout and hours come from the job.
- **Events:** each entry in `EVENTS` has title, summary, `group` (the Choices section), `roam` (shown in Choices), costs, and per-person stat deltas. It can also have `when: { weekdays | dates: ["10-14"] }` (shown once per day, tracked in `doneToday`), `hours`, `skills`, `interests`, `burnout`, `outdoor`, `sleep`, `requires` and `setsOccupation`. Add new content here; the page picks it up automatically.
- **Random start (`newGame`):**
  - The player gets a random first name from `PLAYER_NAMES` (`state.sam.name`; the internal id stays `sam`).
  - Everyone else gets a fresh first name from `NAME_POOL`, stored in `state.names`, never the same as the player's.
  - Sam's soft skills are random (3–16), and Sam gets one random starting interest (6–14).
  - Classmates' moods start between 48 and 72.
  - Each person gets one extra random interest they can inspire (`state.inspires`).
  - `state.start` keeps the starting skills, interests and moods for the recap.
  - Defaults for health, hunger, money, energy and burnout stay fixed.
- **Names in text:** content is written with the default names (Sam, Captain, Mo, …). `personalize(text, state)` swaps in this game's names in one pass (apply it only once, to default-name text). `withPlayer(text, state)` swaps only "Sam", for text whose other names are already this game's. `playerName(state)` gives the player's name. `nameOf(state, id)` gives one person's name, and `castView(state)` returns the renamed `events` and `meetings` that `/state` and `/reset` send. Always use these instead of `NPCS[id].name` for anything shown to the player or the agents.
- **Passions:** `PASSION_PATHS` gives each interest two special choices, generated as `passion_<interest>_1` and `_2`, in the "Passions" group. They require the interest to reach 25 and then 50 (`requires.interest`), deepen it, ease burnout, and some pay. The page hides them until they unlock, then announces "New choice unlocked" in the feed and a toast.
- **Inspiration:** talking with someone (`action: "talk"`) raises an interest from their `inspires` list: +4 if Sam already has it, +3 to spark a new one. The result is in `state.lastInspiration`, which the page turns into a feed note.
- **People:** `NPCS` has 10 entries. The first three have `agent` (person1–3) and stats in `state.person1..3`. The rest are classmates with canned `lines` and `talk` effects. Each has a `color`, a first-meeting `spiel`, and `grudge` greetings that replace the spiel once Sam has ignored them. `MEETINGS` and the `<id>_talk` / `<id>_busy` / `<id>_ignore` events are generated from `NPCS`. Talking to someone you've ignored costs −1 happiness per ignore (up to `GRUDGE_MAX`).
- **Moods and chats:** classmates have `state.moods` (start 60). Talk/busy/ignore moves them +3/−1/−3; `applyChat` gives both people +1 (the three agents use their own happiness). `moodOf(state, id)` reads either.
- **History:** every `advanceHour` appends a compact snapshot to `state.history` (`HISTORY_FIELDS`), so the end-screen charts work without a database.
- **Memories (for the recap):** `recordChoice` runs inside `applyEvent` (before any hours pass) and `noticeHourly` runs inside `advanceHour`.
  - `state.log` holds every choice as `[hour of month, eventId]`.
  - `state.tally[eventId]` holds `{ n, hours, d: Sam's stat deltas, sk: skills, in: interests, p: each person's mood change }`.
  - `state.moments` (capped at 150, deduplicated by `key`) records firsts, a new job, interest levels 25/50/75, skills 20/35/50, a 3rd ignore (grudge), a 3rd talk (friend), money lows and highs, burnout 50/70 and recovery, running out of energy, and going hungry. Each has `because: [{ e, n, v }]` from `topContributors`.
  - `pastTense(title)` turns choice titles into "went to …" phrases.
- **Saving:** with no save file, `loadState` creates a new game and saves it immediately, so every request sees the same random cast. `loadState` also fills missing fields of objects from `startingState()` but leaves arrays (`history`, `doneToday`) alone.
- **What the agents see:** `formatStats(state)` is the text sent to them (clock, weather, everyone's stats, occupation, burnout, skills, interests, who Sam has ignored).

## Frontend (index-new.html)

- **Layout:** the page is fixed to the window height (`body` grid rows 56fr / 44fr, `overflow: hidden`). The game is on top; the player panel and Choices are below and scroll on their own; the Campus feed is the full-height right column. Below 800px wide it switches to a normal scrolling page.
- **Mirrored rules:** some rules are duplicated in the page so buttons can show real costs: `energyCostFor`, `hoursFor`, `isAvailable`, `isInterestChoice`, `fitsOccupation`, `skillGateText` and `targetPopulation`. **If you change the rule in `world-new.mjs`, change the copy in `index-new.html` too.**
- **People on the map:** created from `meetings` (`buildResidents`).
  - Each person's mode is `off`, `entering`, `roam`, `exiting` or `away`. `manageCrowd` walks people in and out at the map edges to match `targetPopulation(hour)`, so fewer are around at night.
  - When two people meet, they swap emojis (`SMALL_TALK`, `WEATHER_TALK`) and then fade out or move on.
  - A conversation with Sam only starts when Sam walks into someone. Every option makes that person fade away for `AWAY_HOURS`.
- **Choices:** grouped in the order Today's events, Around campus, Work, Personal. The time shows in the title. The description is green for things Sam enjoys, and red for ordinary tasks while Sam is burning out. Character popups take keys 1/2/3.
- **Campus feed:** notes, Sam bubbles and character bubbles. It saves to `localStorage` under `college-experience-feed`, keyed by `state.gameId`, never trims, and only scrolls to the bottom if you were already there. `shortReply` trims agent replies to about two sentences.
- **Other:** P or Esc pauses. There's a midnight weekday drop-down, weather and night effects in the game area, floating stat changes, and a bottom toast after each choice. All animations respect `prefers-reduced-motion`.

## End-of-game recap (web/recap.mjs, end screen tabs)

The end screen has five tabs: Overview (final stats and the month charts), Highlights, Impact, Decisions and Memories. The play-style label ("The Grinder", "The Social Butterfly", "Running on Empty", …) sits above the tabs.

- **Highlights:** "Because you X → Y" cards built from moments. Repeats of one kind of moment are grouped with a count. End-of-month outcomes are added too: job earnings vs burnout, doomscrolling, the strongest interest, nights slept, and the biggest burnout relief. Each card is labeled Paid off, Cost Sam, Trade-off or Led to, and colored to match.
- **Impact:** a card for each of the 10 people, with mood from the start of the month to now, talk/busy/ignore counts, the choice that affected them most (from `tally.p`), and a verdict such as Close friend, Holding a grudge, or Liked Sam's choices from afar.
- **Decisions:** waking hours by category (`categoryOf`), nights slept and naps, most-picked choices, money earned and spent, soft skills gained, and rule-based insights. Insights cover study and work share, clubs tried, doomscrolling, burnout peak, nights slept, weekdays without class, people ignored, and happiness change.
- **Memories:** the full timeline, each with "after Sam …" causes.

## Sponsor integrations

- **Tiger Data (TimescaleDB):** every game hour and every choice upserts a row into the `stat_history` hypertable (`db/history.mjs`, fire-and-forget; one warning in the log if the database is missing). `GET /history` reads it back in 3-hour `time_bucket`s (money via `last()`), and falls back to `state.history`. The end screen (`showMonthCharts`) draws six small single-series line charts (happiness, health, hunger, burnout, energy, money) with hover readouts, and says which source it used.
- **Solana (devnet):** each stat is an SPL token with 0 decimals: HLTH, FOOD, HAPY, CASH, NRGY, BRNT, plus COMM, TEAM, LEAD, NETW and TIME for the soft skills. Sam holds all 11, Captain/Spark/Sage hold HAPY and CASH, and classmates hold HAPY. Balances mirror the game stats (`desiredBalances`).
  - After every interaction between people (Sam↔person choices, `/reset`, and chats between people), `queueSync` waits 3 s to batch, diffs against `solana/balances.json`, then mints (+) or burns (−). Up to 6 instructions go in each transaction; the treasury pays and is the mint authority, and owners co-sign burns.
  - The page polls `/chain` and adds "⛓ On Solana: …" notes with explorer links to the feed.
  - Everything is off until `solana/config.json` exists. For tests, `_setSender` replaces the network call.
- **Vultr:** `deploy/vultr/setup.sh` installs Node 22 and Caddy, creates the `college-agents` and `college-web` systemd services, and opens only SSH/80/443. The game stays on `127.0.0.1:4000` behind Caddy. There is one shared save, so all visitors play the same Sam.

## Agents

- Built on `@grok/agent-sdk` (`npm run dev` = `agent-sdk dev`).
- Only person1 (Captain) has the HTTP channel (`bot/channels/event.ts`). It sends one message per conversation, using the continuation token `player:<playerId>`.
- Captain can ask Spark and Sage through `bot/mcp-connections/person2.ts` and `person3.ts`, and read past choices with `bot/tools/recall_decisions.ts`. A memory journal hook is in `bot/hooks/memory.ts`.
- Personalities live in each `bot/instructions.md`. All three follow the same voice rule: one short, casual line, no numbers or stat lists, no lectures. Keep that when editing them.
- Every reply is currently labeled "Captain" in the feed, even when talking to Spark or Sage. To have them answer for themselves, route those choices to their own agents.

## Conventions

- Plain ES modules and vanilla JS. No frameworks, bundlers or TypeScript in `web/`.
- Keep game rules and content in `world-new.mjs`, and only presentation in `index-new.html`.
- Put a short comment on new rules or tuning numbers saying what they do.
- Keep player-facing text plain and short. Effect lines use the existing format ("1 energy, +4 burnout").

## Testing

- No test suite yet.
- Quick rule checks: `node -e 'import("./web/world-new.mjs").then(w => { let s = w.newGame(); s = w.applyEvent(s, "go_to_class"); console.log(s.sam) })'`.
- For the UI: run the server on a spare port with a scratch `state.json`, and point `AGENT_URL` at a small stub that returns `{ ok: true, reply: "..." }`. Then drive it with Playwright (the page's globals, like `world`, `residents` and `placeInside`, are reachable from `page.evaluate`).
- Back up `web/state.json` first, since tests overwrite it.
- Content audit and stress test: loop `newGame()` with random `applyEvent`, `applyChat` and `advanceHour` calls through full months. Check that stats stay in 0–100, money is ≥ 0, `buildRecap` and `formatStats` contain no `undefined`/`NaN`, and nothing still says "Sam" when the player has another name.
- Solana without a network: write a throwaway `solana/config.json` with generated keypairs and random mint addresses, call `_setSender(async (ctx, tx, signers) => "sig")`, then `queueSync(state)` and `await settle()`.
