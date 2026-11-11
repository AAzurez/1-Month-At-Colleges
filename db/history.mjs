// Sam's hour-by-hour stats, stored in Tiger Data (TimescaleDB) when DATABASE_URL points at it.
// The game also keeps the same snapshots in state.json (state.history), so charts still work
// without a database.
import { dbQuery } from "./memory.mjs";

const START = Date.UTC(2026, 9, 1); // October 1, 2026 = game day 0
const HOUR = 3600 * 1000;

export function gameTime(day, hour) {
  return new Date(START + (day * 24 + hour) * HOUR);
}

let warned = false;
function warnOnce(error) {
  if (warned) return;
  warned = true;
  console.warn(`Stat history is not being saved to the database: ${error.message}`);
}

export async function recordSnapshot(state) {
  const sam = state.sam;
  try {
    await dbQuery(
      `insert into stat_history (game_id, game_time, health, hunger, happiness, money, energy, burnout, occupation)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (game_id, game_time) do update set
         health = excluded.health, hunger = excluded.hunger, happiness = excluded.happiness,
         money = excluded.money, energy = excluded.energy, burnout = excluded.burnout,
         occupation = excluded.occupation, recorded_at = now()`,
      [
        state.gameId,
        gameTime(state.time.day, state.time.hour),
        sam.health,
        sam.hunger,
        sam.happiness,
        sam.money,
        sam.energy,
        sam.burnout ?? 0,
        sam.occupation ?? "student",
      ],
    );
    return true;
  } catch (error) {
    warnOnce(error);
    return false;
  }
}

// Averages each stat into 3-hour buckets with TimescaleDB's time_bucket; money uses the
// last value in each bucket. Returns null if the database is unavailable.
export async function readHistory(gameId) {
  try {
    const result = await dbQuery(
      `select time_bucket('3 hours', game_time) as bucket,
              round(avg(health))::int    as health,
              round(avg(hunger))::int    as hunger,
              round(avg(happiness))::int as happiness,
              round(avg(energy), 1)::float as energy,
              round(avg(burnout))::int   as burnout,
              last(money, game_time)     as money
       from stat_history
       where game_id = $1
       group by bucket
       order by bucket`,
      [gameId],
    );
    if (result.rows.length === 0) return null;
    return result.rows.map((row) => ({
      t: Math.round((new Date(row.bucket).getTime() - START) / HOUR),
      health: row.health,
      hunger: row.hunger,
      happiness: row.happiness,
      energy: Number(row.energy),
      burnout: row.burnout,
      money: Number(row.money),
    }));
  } catch (error) {
    warnOnce(error);
    return null;
  }
}
