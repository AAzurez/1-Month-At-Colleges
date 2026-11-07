import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function databaseUrl() {
  if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "") {
    return process.env.DATABASE_URL;
  }
  let text = "";
  try {
    text = await readFile(join(root, ".env"), "utf8");
  } catch {
    return "";
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("DATABASE_URL=")) {
      return trimmed.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

let pool;

async function getPool() {
  if (pool === undefined) {
    const connectionString = await databaseUrl();
    if (connectionString === "") {
      throw new Error("DATABASE_URL is missing. Add it to .env in the CollegeExperience folder.");
    }
    pool = new pg.Pool({ connectionString });
  }
  return pool;
}

export async function saveChoice({ playerId, eventId, summary }) {
  const db = await getPool();
  const result = await db.query(
    "insert into choices (player_id, event_id, summary) values ($1, $2, $3) returning id",
    [playerId, eventId, summary],
  );
  return Number(result.rows[0].id);
}

export async function saveReply({ choiceId, agent, reply }) {
  const note = reply.trim().replace(/\s+/g, " ").slice(0, 280);
  const db = await getPool();
  await db.query(
    "insert into agent_replies (choice_id, agent, reply) values ($1, $2, $3)",
    [choiceId, agent, note],
  );
}

export async function listMemories(playerId) {
  const db = await getPool();
  const result = await db.query(
    `select c.id, c.event_id, c.summary,
            coalesce(string_agg(r.agent || ': ' || r.reply, ' | ' order by r.id), '') as notes
     from choices c
     left join agent_replies r on r.choice_id = c.id
     where c.player_id = $1
     group by c.id
     order by c.created_at desc
     limit 8`,
    [playerId],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    eventId: row.event_id,
    caused: row.summary,
    notes: row.notes,
  }));
}

export function formatMemories(memories) {
  if (memories.length === 0) return "No earlier decisions.";
  return memories
    .map((memory) => {
      const caused = memory.caused.replace(/[.\s]+$/, "");
      const note = memory.notes === "" ? "" : ` Note: ${memory.notes}`;
      return `- ${memory.eventId}: ${caused}.${note}`;
    })
    .join("\n");
}
