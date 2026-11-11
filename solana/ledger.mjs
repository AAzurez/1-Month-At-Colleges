// Solana devnet ledger for CollegeExperience.
//
// Every stat is a token ("currency") on Solana devnet: HAPY for happiness, CASH for money, and so on.
// Each person on campus has a wallet, and its token balances mirror their stats in the game.
// After every interaction between people (Sam talking to, brushing off or ignoring someone, or two
// people chatting), the server works out how each balance changed and mints (+) or burns (-) the
// difference in one batch of transactions.
//
// It stays off until `npm run solana:setup` has written solana/config.json, so the game runs
// fine without it.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = join(dir, "config.json");
export const BALANCES_PATH = join(dir, "balances.json");

// The currencies. Amounts are whole numbers (0 decimals), the same as the stats.
export const TOKENS = {
  HLTH: "Health",
  FOOD: "Fullness",
  HAPY: "Happiness",
  CASH: "Money",
  NRGY: "Energy",
  BRNT: "Burnout",
  COMM: "Communication",
  TEAM: "Teamwork",
  LEAD: "Leadership",
  NETW: "Networking",
  TIME: "Time management",
};

export const NAMES = {
  sam: "Sam", captain: "Captain", spark: "Spark", sage: "Sage", mo: "Mo", priya: "Priya",
  jules: "Jules", dev: "Dev", rosa: "Rosa", theo: "Theo", kai: "Kai",
};

const AGENTS = { captain: "person1", spark: "person2", sage: "person3" };
const CLASSMATES = ["mo", "priya", "jules", "dev", "rosa", "theo", "kai"];

// Which tokens each person holds.
export const HOLDINGS = {
  sam: Object.keys(TOKENS),
  captain: ["HAPY", "CASH"],
  spark: ["HAPY", "CASH"],
  sage: ["HAPY", "CASH"],
  ...Object.fromEntries(CLASSMATES.map((id) => [id, ["HAPY"]])),
};

const whole = (value) => Math.max(0, Math.round(Number(value) || 0));

// What every wallet should hold, read straight from the game state.
export function desiredBalances(state) {
  const sam = state.sam;
  const skills = sam.skills ?? {};
  const out = {
    sam: {
      HLTH: whole(sam.health), FOOD: whole(sam.hunger), HAPY: whole(sam.happiness), CASH: whole(sam.money),
      NRGY: whole(sam.energy), BRNT: whole(sam.burnout), COMM: whole(skills.communication), TEAM: whole(skills.teamwork),
      LEAD: whole(skills.leadership), NETW: whole(skills.networking), TIME: whole(skills.timeManagement),
    },
  };
  for (const [id, statId] of Object.entries(AGENTS)) {
    out[id] = { HAPY: whole(state[statId]?.happiness), CASH: whole(state[statId]?.money) };
  }
  for (const id of CLASSMATES) out[id] = { HAPY: whole(state.moods?.[id] ?? 60) };
  return out;
}

// [{ person, token, delta }] for every balance that needs to move.
export function diffBalances(desired, current) {
  const changes = [];
  for (const [person, tokens] of Object.entries(desired)) {
    for (const [token, amount] of Object.entries(tokens)) {
      const delta = amount - (current?.[person]?.[token] ?? 0);
      if (delta !== 0) changes.push({ person, token, delta });
    }
  }
  return changes;
}

// names: this game's names ({ captain: "Bea", ... }); falls back to the default names.
export function describeChanges(changes, names = {}) {
  return changes
    .map(({ person, token, delta }) => `${names[person] ?? NAMES[person] ?? person} ${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${token}`)
    .join(", ");
}

// ---- runtime -------------------------------------------------------------------------------

let ready = null; // Promise of { web3, spl, connection, config, treasury, wallets } or null
let status = { enabled: false, reason: "Not set up. Run: npm run solana:setup" };
let balances = {};
let pending = null; // { state, reasons: Set }
let timer = null;
let running = Promise.resolve();
const entries = [];
let nextId = 1;
const BATCH = 6; // instructions per transaction (keeps each transaction well under the size limit)
const DEBOUNCE_MS = 3000;

// Tests can swap the function that actually sends a transaction.
let sender = async (ctx, tx, signers) => ctx.web3.sendAndConfirmTransaction(ctx.connection, tx, signers, { commitment: "confirmed" });
export function _setSender(fn) {
  sender = fn;
}

async function init() {
  let config;
  try {
    config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
  try {
    const web3 = await import("@solana/web3.js");
    const spl = await import("@solana/spl-token");
    const connection = new web3.Connection(config.rpc, "confirmed");
    const keypair = (secret) => web3.Keypair.fromSecretKey(Uint8Array.from(secret));
    const treasury = keypair(config.treasury);
    const wallets = Object.fromEntries(Object.entries(config.wallets).map(([id, secret]) => [id, keypair(secret)]));
    const mints = Object.fromEntries(Object.entries(config.mints).map(([token, address]) => [token, new web3.PublicKey(address)]));
    try {
      balances = JSON.parse(await readFile(BALANCES_PATH, "utf8"));
    } catch {
      balances = {};
    }
    status = { enabled: true, cluster: config.cluster ?? "devnet" };
    return { web3, spl, connection, config, treasury, wallets, mints };
  } catch (error) {
    status = { enabled: false, reason: `Solana libraries missing or config unreadable: ${error.message}` };
    return null;
  }
}

function context() {
  if (ready === null) ready = init();
  return ready;
}

export function chainStatus() {
  void context();
  return status;
}

// Same, but waits until the config has loaded (so the first page load sees the real status).
export async function chainStatusReady() {
  await context();
  return status;
}

export function explorerUrl(signature, cluster = "devnet") {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function chainEntries(after = 0) {
  return { ...status, entries: entries.filter((entry) => entry.id > after) };
}

function remember(entry) {
  entries.push({ id: nextId++, at: new Date().toISOString(), ...entry });
  while (entries.length > 100) entries.shift();
}

// Called after every interaction. Waits a few seconds so a burst of interactions goes out as one batch.
export function queueSync(state, reason = "") {
  void context().then((ctx) => {
    if (ctx === null) return;
    if (pending === null) pending = { state, reasons: new Set() };
    pending.state = state;
    if (reason) pending.reasons.add(reason);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const job = pending;
      pending = null;
      running = running.then(() => flush(ctx, job)).catch((error) => console.warn(`Solana sync failed: ${error.message}`));
    }, DEBOUNCE_MS);
  });
}

// Waits for any queued sync (used by tests and on shutdown).
export async function settle() {
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 50));
  await running;
}

function instructionFor(ctx, { person, token, delta }) {
  const owner = ctx.wallets[person];
  const mint = ctx.mints[token];
  if (!owner || !mint) return null;
  const account = ctx.spl.getAssociatedTokenAddressSync(mint, owner.publicKey);
  if (delta > 0) {
    return { ix: ctx.spl.createMintToInstruction(mint, account, ctx.treasury.publicKey, delta), signer: null };
  }
  return { ix: ctx.spl.createBurnInstruction(account, mint, owner.publicKey, -delta), signer: owner };
}

async function flush(ctx, job) {
  const desired = desiredBalances(job.state);
  const changes = diffBalances(desired, balances).filter((change) => HOLDINGS[change.person]?.includes(change.token));
  if (changes.length === 0) return;
  const reason = [...job.reasons].join("; ");
  for (let start = 0; start < changes.length; start += BATCH) {
    const chunk = changes.slice(start, start + BATCH);
    const built = chunk.map((change) => instructionFor(ctx, change)).filter(Boolean);
    if (built.length === 0) continue;
    const tx = new ctx.web3.Transaction();
    for (const { ix } of built) tx.add(ix);
    const signers = [ctx.treasury, ...new Map(built.filter((b) => b.signer).map((b) => [b.signer.publicKey.toBase58(), b.signer])).values()];
    try {
      const signature = await sender(ctx, tx, signers);
      for (const { person, token, delta } of chunk) {
        balances[person] = { ...(balances[person] ?? {}), [token]: (balances[person]?.[token] ?? 0) + delta };
      }
      remember({ signature, url: explorerUrl(signature, status.cluster), reason, changes: chunk, text: describeChanges(chunk, { ...job.state.names, sam: job.state.sam?.name }) });
    } catch (error) {
      remember({ error: error.message, reason, changes: chunk, text: describeChanges(chunk, { ...job.state.names, sam: job.state.sam?.name }) });
      console.warn(`Solana transaction failed (will retry on the next interaction): ${error.message}`);
      break;
    }
  }
  await writeFile(BALANCES_PATH, `${JSON.stringify(balances, null, 2)}\n`);
}
