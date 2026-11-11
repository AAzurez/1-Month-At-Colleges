// One-time Solana devnet setup for CollegeExperience: `npm run solana:setup`.
//
// 1. Makes (or reuses) a treasury wallet that pays fees and can mint every stat token.
// 2. Gets it some free devnet SOL (or tells you how).
// 3. Creates one token per stat (HAPY, CASH, ...) and a wallet for everyone on campus.
// 4. Opens each person's token accounts and writes solana/config.json + solana/balances.json.
//
// Safe to run again: it reuses whatever already exists. The JSON files hold private keys for
// devnet test wallets only. They are gitignored; never reuse these keys on mainnet.
import { readFile, writeFile } from "node:fs/promises";
import * as web3 from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import { BALANCES_PATH, CONFIG_PATH, HOLDINGS, NAMES, TOKENS } from "./ledger.mjs";

const rpc = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
const connection = new web3.Connection(rpc, "confirmed");
const keypair = (secret) => web3.Keypair.fromSecretKey(Uint8Array.from(secret));
const secretOf = (pair) => Array.from(pair.secretKey);

let config = {};
try {
  config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
} catch {
  config = {};
}

const treasury = config.treasury ? keypair(config.treasury) : web3.Keypair.generate();
config = { cluster, rpc, treasury: secretOf(treasury), mints: config.mints ?? {}, wallets: config.wallets ?? {} };
await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Treasury wallet: ${treasury.publicKey.toBase58()}`);

const balance = await connection.getBalance(treasury.publicKey);
console.log(`Treasury balance: ${balance / web3.LAMPORTS_PER_SOL} SOL`);
if (balance < 0.2 * web3.LAMPORTS_PER_SOL) {
  try {
    console.log("Requesting 1 devnet SOL...");
    const sig = await connection.requestAirdrop(treasury.publicKey, web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  } catch (error) {
    console.log(`\nThe automatic airdrop didn't work (${error.message}).`);
    console.log(`Get free devnet SOL at https://faucet.solana.com for:\n  ${treasury.publicKey.toBase58()}`);
    console.log("Then run `npm run solana:setup` again.");
    process.exit(1);
  }
}

for (const token of Object.keys(TOKENS)) {
  if (config.mints[token]) continue;
  const mint = await spl.createMint(connection, treasury, treasury.publicKey, null, 0);
  config.mints[token] = mint.toBase58();
  console.log(`Created ${token} (${TOKENS[token]}): ${mint.toBase58()}`);
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

for (const person of Object.keys(HOLDINGS)) {
  if (!config.wallets[person]) config.wallets[person] = secretOf(web3.Keypair.generate());
}
await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

// Open every token account (idempotent instructions, a few per transaction).
const opens = [];
for (const [person, tokens] of Object.entries(HOLDINGS)) {
  const owner = keypair(config.wallets[person]).publicKey;
  for (const token of tokens) {
    const mint = new web3.PublicKey(config.mints[token]);
    const account = spl.getAssociatedTokenAddressSync(mint, owner);
    opens.push(spl.createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, account, owner, mint));
  }
}
for (let i = 0; i < opens.length; i += 5) {
  const tx = new web3.Transaction().add(...opens.slice(i, i + 5));
  await web3.sendAndConfirmTransaction(connection, tx, [treasury], { commitment: "confirmed" });
}
console.log(`Opened ${opens.length} token accounts.`);

// Start the mirror from what's actually on chain.
const balances = {};
for (const [person, tokens] of Object.entries(HOLDINGS)) {
  const owner = keypair(config.wallets[person]).publicKey;
  balances[person] = {};
  for (const token of tokens) {
    const account = spl.getAssociatedTokenAddressSync(new web3.PublicKey(config.mints[token]), owner);
    const info = await connection.getTokenAccountBalance(account);
    balances[person][token] = Number(info.value.amount);
  }
}
await writeFile(BALANCES_PATH, `${JSON.stringify(balances, null, 2)}\n`);

console.log("\nDone. Wallets:");
for (const person of Object.keys(HOLDINGS)) {
  console.log(`  ${NAMES[person].padEnd(8)} https://explorer.solana.com/address/${keypair(config.wallets[person]).publicKey.toBase58()}?cluster=${cluster}`);
}
console.log("\nRestart the game server. The first interaction mints everyone's starting balances.");
