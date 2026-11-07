import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatMemories, listMemories, saveChoice, saveReply } from "../db/memory.mjs";
import { EVENTS, applyEvent, formatStats, loadState, saveState } from "./world.mjs";

const port = Number(process.env.PORT ?? 4000);
const agentUrl =
  process.env.AGENT_URL ??
  "http://127.0.0.1:3000/person1/v1/channels/event/choice";
const dir = dirname(fileURLToPath(import.meta.url));

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await readFile(join(dir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/state") {
    const state = await loadState();
    sendJson(res, 200, { state, events: EVENTS });
    return;
  }

  if (req.method === "POST" && url.pathname === "/choices") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
      state = applyEvent(await loadState(), payload.eventId);
      await saveState(state);
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
        summary: event.summary,
      });
      const earlier = (await listMemories(payload.playerId)).filter((item) => item.id !== choiceId);
      memory = formatMemories(earlier);
    } catch (error) {
      dbWarning = error instanceof Error ? error.message : "Could not save the decision.";
    }

    try {
      const agent = await fetch(agentUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          summary: event.summary,
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
    } catch {
      sendJson(res, 502, {
        ok: false,
        error: "The agent server is not running. Start it with: agent-sdk dev ./agents",
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

server.listen(port, "127.0.0.1", () => {
  console.log(`event test page http://127.0.0.1:${port}`);
});
