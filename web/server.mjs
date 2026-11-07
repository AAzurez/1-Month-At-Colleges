import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatMemories, listMemories, saveChoice, saveReply } from "../db/memory.mjs";

const port = Number(process.env.PORT ?? 4000);
const agentUrl =
  process.env.AGENT_URL ??
  "http://127.0.0.1:3000/person1/v1/channels/event/choice";
const dir = dirname(fileURLToPath(import.meta.url));

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await readFile(join(dir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && url.pathname === "/choices") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Body must be JSON." }));
      return;
    }

    let choiceId;
    let memory;
    try {
      choiceId = await saveChoice({
        playerId: payload.playerId,
        eventId: payload.eventId,
        summary: payload.summary,
      });
      const earlier = (await listMemories(payload.playerId)).filter((item) => item.id !== choiceId);
      memory = formatMemories(earlier);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the decision.";
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: message }));
      return;
    }

    try {
      const agent = await fetch(agentUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, memory }),
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
      if (reply !== "") {
        try {
          await saveReply({ choiceId, agent: "person1", reply });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not save the reply.";
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: message, choiceId, reply, playground }));
          return;
        }
      }
      res.writeHead(agent.ok ? 200 : 502, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: agent.ok && agentError === null,
        agentStatus: agent.status,
        choiceId,
        reply,
        playground,
        error: agentError,
      }));
    } catch {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: "The agent server is not running. Start it with: agent-sdk dev ./agents",
        }),
      );
    }
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`event test page http://127.0.0.1:${port}`);
});
