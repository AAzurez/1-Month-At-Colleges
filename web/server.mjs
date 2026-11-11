import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatMemories, listMemories, saveChoice, saveReply } from "../db/memory.mjs";
import { readHistory, recordSnapshot } from "../db/history.mjs";
import { chainEntries, chainStatus, chainStatusReady, queueSync } from "../solana/ledger.mjs";
import { buildRecap } from "./recap.mjs";
import { CALENDAR, EVENTS, MEETINGS, SKILLS, INTERESTS, WEATHER, BURNOUT_LIMIT, STRAIN_LIMIT, OCCUPATIONS, HISTORY_FIELDS, castView, nameOf, personalize, advanceHour, applyChat, applyEvent, formatStats, loadState, newGame, saveState } from "./world-new.mjs";

const port = Number(process.env.PORT ?? 4000);
// Use HOST=0.0.0.0 only behind a firewall or reverse proxy (see deploy/vultr). The default stays local.
const host = process.env.HOST ?? "127.0.0.1";
const agentUrl =
  process.env.AGENT_URL ??
  "http://127.0.0.1:3000/person1/v1/channels/event/choice";
const dir = dirname(fileURLToPath(import.meta.url));

// Every change to the game goes through this queue, one at a time, so two requests
// (say a chat and the hourly tick) can't load the same save and overwrite each other.
let queue = Promise.resolve();
function updateState(change) {
  const run = queue.then(async () => {
    const next = await change(await loadState());
    await saveState(next);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

// The clock moves at most one hour per HOUR_MS, however many tabs or players are asking.
const HOUR_MS = 9000;
let lastHourAt = 0;

// How long to wait for the agent before giving up on a reply.
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 90_000);

// Reads a JSON body, refusing anything unreasonably large.
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Body too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await readFile(join(dir, "index-new.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/state") {
    const state = await loadState();
    sendJson(res, 200, { state, ...castView(state), calendar: CALENDAR, skills: SKILLS, interests: INTERESTS, weather: WEATHER, burnoutLimit: BURNOUT_LIMIT, strainLimit: STRAIN_LIMIT, occupations: OCCUPATIONS, solana: await chainStatusReady() });
    return;
  }

  // Sam's stats over the month for the end-of-game charts: from Tiger Data when it's connected,
  // otherwise from the snapshots kept in state.json.
  if (req.method === "GET" && url.pathname === "/history") {
    const state = await loadState();
    const rows = await readHistory(state.gameId);
    if (rows !== null) {
      sendJson(res, 200, { source: "tiger", points: rows });
      return;
    }
    const points = (state.history ?? []).map((row) => Object.fromEntries(HISTORY_FIELDS.map((field, i) => [field, row[i]])));
    sendJson(res, 200, { source: "local", points });
    return;
  }

  // The end-of-game recap: highlights, impact on others, decision analysis and memories.
  if (req.method === "GET" && url.pathname === "/recap") {
    sendJson(res, 200, buildRecap(await loadState()));
    return;
  }

  // Recent Solana ledger transactions (after a given entry id) for the feed.
  if (req.method === "GET" && url.pathname === "/chain") {
    sendJson(res, 200, chainEntries(Number(url.searchParams.get("after") ?? 0)));
    return;
  }

  // Two people on the map chatted with each other.
  if (req.method === "POST" && url.pathname === "/chats") {
    try {
      const { a, b } = await readJson(req);
      const state = await updateState((current) => applyChat(current, a, b));
      queueSync(state, `${nameOf(state, a)} and ${nameOf(state, b)} chatted`);
      sendJson(res, 200, { ok: true, state });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Bad chat." });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/hours") {
    if (Date.now() - lastHourAt < HOUR_MS) {
      // Another tab (or player) already moved the clock this hour.
      sendJson(res, 200, { state: await loadState() });
      return;
    }
    lastHourAt = Date.now();
    const state = await updateState((current) => advanceHour(current));
    void recordSnapshot(state);
    sendJson(res, 200, { state });
    return;
  }

  if (req.method === "POST" && url.pathname === "/reset") {
    const state = await updateState(() => newGame());
    lastHourAt = Date.now();
    void recordSnapshot(state);
    queueSync(state, "new game");
    // New game, new names: send the renamed events and meetings too.
    sendJson(res, 200, { state, ...castView(state) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/choices") {
    let payload;
    try {
      payload = await readJson(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "Body must be JSON." });
      return;
    }

    const event = EVENTS[payload.eventId];
    if (event === undefined) {
      sendJson(res, 400, { ok: false, error: "Unknown event." });
      return;
    }

    let state;
    try {
      state = await updateState((current) => applyEvent(current, payload.eventId));
      void recordSnapshot(state);
      // Every interaction between people moves stat currencies on Solana.
      if (event.npc) queueSync(state, personalize(event.title, state));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not apply the choice.";
      sendJson(res, 400, { ok: false, error: message, state: await loadState() });
      return;
    }

    const stats = formatStats(state);
    let choiceId = null;
    let memory = "No earlier decisions.";
    let dbWarning = null;
    try {
      choiceId = await saveChoice({
        playerId: payload.playerId,
        eventId: payload.eventId,
        summary: personalize(event.summary, state),
      });
      const earlier = (await listMemories(payload.playerId)).filter((item) => item.id !== choiceId);
      memory = formatMemories(earlier);
    } catch (error) {
      dbWarning = error instanceof Error ? error.message : "Could not save the decision.";
    }

    // Only talking to (or brushing off) a character with an agent waits for a reply.
    // Everything else, including Sam's own choices, is saved and shows up in the agent's memory later.
    if (event.quiet || !event.npc) {
      sendJson(res, 200, { ok: true, quiet: true, choiceId, reply: "", state, stats, dbWarning });
      return;
    }

    try {
      const agent = await fetch(agentUrl, {
        signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          summary: personalize(event.summary, state),
          memory,
          stats,
        }),
      });
      const agentBody = await agent.text();
      let reply = "";
      let playground = "http://127.0.0.1:3000/person1/playground";
      let agentError = null;
      if (agentBody !== "") {
        try {
          const parsed = JSON.parse(agentBody);
          reply = typeof parsed.reply === "string" ? parsed.reply : "";
          if (typeof parsed.playground === "string") playground = parsed.playground;
          if (typeof parsed.error === "string") agentError = parsed.error;
        } catch {
          reply = "";
        }
      }
      if (reply !== "" && choiceId !== null) {
        try {
          await saveReply({ choiceId, agent: "person1", reply });
        } catch (error) {
          dbWarning = error instanceof Error ? error.message : "Could not save the reply.";
        }
      }
      sendJson(res, agent.ok ? 200 : 502, {
        ok: agent.ok && agentError === null,
        agentStatus: agent.status,
        choiceId,
        reply,
        playground,
        state,
        stats,
        dbWarning,
        error: agentError,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      sendJson(res, 502, {
        ok: false,
        error: timedOut
          ? "The agent took too long to answer. The choice still counted."
          : "The agent server is not running. Start it with: agent-sdk dev ./agents",
        state,
        stats,
        dbWarning,
      });
    }
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

// Load the Solana setup (if any) right away instead of on the first request.
void chainStatus();

server.listen(port, host, () => {
  console.log(`CollegeExperience running at http://${host}:${port}`);
});
