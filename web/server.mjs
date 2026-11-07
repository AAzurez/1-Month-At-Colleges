import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

    try {
      const agent = await fetch(agentUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const agentBody = await agent.text();
      res.writeHead(agent.ok ? 200 : 502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: agent.ok, agentStatus: agent.status, agentBody }));
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
