// One-off reconciliation for the M1 traffic campaign.
//
// The first deposit wave ran with a broken inclusion check: every landed tx
// read as UNKNOWN, was re-sent, and state.json's hash was overwritten with
// the newest attempt — usually the one that DIDN'T land. The landed hashes
// are not lost though: log.jsonl records every send with its round.
//
// Inclusion is read from the node's bestChain (up to 290 blocks ≈ 14.5h —
// o1js's checkZkappTransaction does the same but over a useless 20-block
// window): ONE query yields every applied zkapp hash, every slot whose
// history intersects it is marked confirmed. No proving, no sending.
//
// MUST run while the traffic process is STOPPED (both write state.json):
//   pm2 stop traffic
//   cd bridge && node reconcile-traffic.mjs
//   pm2 restart traffic
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.TRAFFIC_DATA_DIR || join(process.cwd(), "traffic-data");
const STATE_PATH = join(DATA_DIR, "state.json");
const LOG_PATH = join(DATA_DIR, "log.jsonl");
const NODES = [
    "https://api.minascan.io/node/devnet/v1/graphql",
    "https://devnet-plain-1.gcp.o1test.net/graphql",
];

async function includedZkappHashes() {
    let lastError;
    for (const url of NODES) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    query: `query { bestChain(maxLength: 290) {
                        transactions { zkappCommands { hash failureReason { failures } } }
                    } }`,
                }),
                signal: AbortSignal.timeout(30_000),
            });
            const body = await res.json();
            if (body.errors?.length) throw new Error(body.errors[0].message);
            const hashes = new Set();
            for (const block of body.data.bestChain) {
                for (const cmd of block.transactions.zkappCommands) {
                    // A failed-but-included tx consumed its nonce yet did NOT
                    // deposit: the slot still needs a re-send, so skip it.
                    if (cmd.failureReason === null) hashes.add(cmd.hash);
                }
            }
            console.log(`bestChain from ${url}: ${hashes.size} applied zkapp hashes`);
            return hashes;
        } catch (error) {
            lastError = error;
            console.warn(`${url} failed (${error.message.slice(0, 120)}), trying next`);
        }
    }
    throw lastError;
}

const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
const included = await includedZkappHashes();

// Every hash ever sent for a (account, direction, round) slot.
const candidates = new Map();
for (const line of readFileSync(LOG_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if ((entry.phase !== "deposit" && entry.phase !== "withdraw") || !entry.hash) continue;
    const key = `${entry.minaAddress}|${entry.phase}|${entry.round}`;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(entry.hash);
}

let confirmed = 0;
let open = 0;
for (const [minaAddress, accountState] of Object.entries(state.accounts)) {
    for (const direction of ["deposit", "withdraw"]) {
        const list = direction === "deposit" ? accountState.deposits : accountState.withdraws;
        list.forEach((planned, round) => {
            if (planned.confirmed) return;
            const hashes = candidates.get(`${minaAddress}|${direction}|${round}`) ?? [];
            if (planned.hash && !hashes.includes(planned.hash)) hashes.push(planned.hash);
            const landed = hashes.find((hash) => included.has(hash));
            if (landed) {
                planned.confirmed = true;
                planned.hash = landed;
                confirmed++;
            } else if (hashes.length) {
                open++;
            }
        });
    }
}

copyFileSync(STATE_PATH, STATE_PATH + ".bak");
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
console.log(`done: ${confirmed} slots newly confirmed, ${open} still open (will re-send), backup at state.json.bak`);
