import "dotenv/config";
import { setBackend } from "o1js";
// Prod workers run native; wasm is the escape hatch for hosts where native
// crashes (see prover/src/scripts/smokeTest.ts).
setBackend((process.env.TRAFFIC_O1JS_BACKEND as "native" | "wasm") || "native");

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import {
    Cache,
    Field,
    Mina,
    PrivateKey,
    PublicKey,
    UInt64,
    checkZkappTransaction,
    fetchAccount,
} from "o1js";
import Client from "mina-signer";
import { DirectSecp256k1Wallet, encodePubkey, makeAuthInfoBytes } from "@cosmjs/proto-signing";
import { toHex, fromBase64, toBase64 } from "@cosmjs/encoding";
import { SignDoc, TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin.js";
import {
    SettlementContract,
    PulsarAuth,
    CosmosSignature,
    MultisigVerifierProgram,
    SettleAttestProgram,
    ApprovalTailProgram,
    ApprovalQuorumProgram,
    ActionStackProgram,
    setMinaNetwork,
    ENDPOINTS,
} from "pulsar-contracts";
import {
    ActorType,
    KeySigningOperation,
    keySigningChallenge,
    MsgRegisterUserKeys,
    MSG_REGISTER_USER_KEYS_TYPE_URL,
    KEYREGISTRY_QUERY_USER_COSMOS_KEY,
    QueryGetUserCosmosPublicKeyRequest,
    QueryGetUserCosmosPublicKeyResponse,
} from "pulsar-chain-client/messages";

import pino from "pino";

// Not the shared logger: importing it validates the whole bridge env schema,
// and this script runs standalone with a handful of TRAFFIC_* variables.
const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

/**
 * Bridge traffic generator — the M1 testnet campaign in one pm2 process.
 *
 * Runs a pool of throwaway Mina accounts through the full user journey:
 * fund from a treasury, register each Mina key against a fresh Cosmos key,
 * then send DEPOSITS_PER_ACCOUNT deposits and WITHDRAWS_PER_ACCOUNT
 * withdrawals from every account. Both directions originate on Mina — the
 * Pulsar side (credit, burn) is the chain's answer, which is exactly what the
 * milestone counts.
 *
 * Every phase is idempotent and chain-checked, so the process can be killed
 * and restarted at any point (pm2 restarts included) and will pick up where
 * the chain says it left off. All artifacts live in TRAFFIC_DATA_DIR:
 *
 *   accounts.json  — the keypairs. The only copy; losing it mid-campaign
 *                    strands whatever MINA those accounts still hold.
 *   state.json     — planned amounts and sent-tx hashes per account.
 *   log.jsonl      — one line per transaction, the milestone evidence.
 *   o1js-cache/    — compiled circuit cache (first run compiles cold).
 *
 * Commands:
 *   node traffic.js init    — create accounts.json + plan, print the funding
 *                             bill and the treasury address to fund, then exit.
 *   node traffic.js status  — print per-phase progress and global chain
 *                             counts, then exit. Read-only.
 *   node traffic.js run     — (default) drive all phases to completion, then
 *                             exit 0. Run under pm2 with --no-autorestart.
 */

// ---------------------------------------------------------------------------
// Config

const DATA_DIR = process.env.TRAFFIC_DATA_DIR || join(process.cwd(), "traffic-data");
const ACCOUNT_COUNT = intEnv("TRAFFIC_ACCOUNT_COUNT", 100);
const DEPOSITS_PER_ACCOUNT = intEnv("TRAFFIC_DEPOSITS_PER_ACCOUNT", 3);
const WITHDRAWS_PER_ACCOUNT = intEnv("TRAFFIC_WITHDRAWS_PER_ACCOUNT", 3);

const MINA_NETWORK = (process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet") || "devnet";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "B62qje6kuVppRQNfL3ot7cF1o4tLK5w2Tg3rRBFHe8RmY9YUJrPkFKW";

const PULSAR_RPC_URL = process.env.TRAFFIC_PULSAR_RPC_URL || "https://rpc.pulsarchain.xyz";
const PULSAR_REST_URL = process.env.TRAFFIC_PULSAR_REST_URL || "https://rest.pulsarchain.xyz";
const FEEGRANT_URL = process.env.TRAFFIC_FEEGRANT_URL || "https://app.pulsarchain.xyz/api/feegrant";
const BRIDGE_MODULE_ADDRESS = process.env.TRAFFIC_BRIDGE_MODULE_ADDRESS || "pulsar1zlefkpe3g0vvm9a4h0jf9000lmqutlh96h0437";

const BECH32_PREFIX = "pulsar";
const PMINA_DENOM = "pmina";

const NANO = 1_000_000_000n;
// deposit() asserts >= 1 MINA; withdraw() moves a 1 MINA down payment.
const DEPOSIT_MIN_NANO = 1_000_000_000;
const DEPOSIT_MAX_NANO = 2_000_000_000;
const WITHDRAW_MIN_NANO = 500_000_000;
const WITHDRAW_MAX_NANO = 1_000_000_000;
const DOWN_PAYMENT_NANO = 1_000_000_000n;
// Receiver-side account creation fee Mina deducts from a payment to a fresh
// account.
const ACCOUNT_CREATION_NANO = 1_000_000_000n;
const ZKAPP_FEE_NANO = 100_000_000n; // 0.1 MINA
const PAYMENT_FEE_NANO = 10_000_000n; // 0.01 MINA

const REGISTER_GAS = 200_000;
const REGISTER_FEE_PMINA = "2000"; // within the feegrant worker's 10000 spend limit

// Wave pacing. Proving is the real rate limiter (~1 min/proof); the jitter on
// top keeps the send pattern from being metronomic.
const JITTER_MIN_MS = intEnv("TRAFFIC_JITTER_MIN_MS", 2_000);
const JITTER_MAX_MS = intEnv("TRAFFIC_JITTER_MAX_MS", 15_000);

const POLL_MS = 30_000;
const MINA_GRAPHQL = ENDPOINTS.NODE[MINA_NETWORK];
// Public node(s) the campaign falls back to when the primary stalls (seen
// live: a minascan.io connection that opened and never answered). Only a
// known-good default for devnet, since that's what the campaign runs
// against; override or add mainnet/lightnet candidates via the env var.
const MINA_NODE_DEFAULT_FALLBACKS: Record<"devnet" | "mainnet" | "lightnet", string[]> = {
    // o1Labs-hosted daemons (see docs.minaprotocol.com Network endpoints).
    devnet: ["https://devnet-plain-1.gcp.o1test.net/graphql"],
    mainnet: ["https://mainnet-plain-1.gcp.o1test.net/graphql"],
    lightnet: [],
};
const MINA_GRAPHQL_URLS = [
    MINA_GRAPHQL,
    ...envListOrDefault("TRAFFIC_MINA_NODE_FALLBACK_URLS", MINA_NODE_DEFAULT_FALLBACKS[MINA_NETWORK]),
];
const HTTP_TIMEOUT_MS = 30_000;

function intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const value = raw ? Number(raw) : NaN;
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function envListOrDefault(name: string, fallback: string[]): string[] {
    const raw = process.env[name];
    if (!raw) return fallback;
    return raw.split(",").map((url) => url.trim()).filter(Boolean);
}

// A stalled connection (TCP up, server never answers) hangs a bare fetch
// forever — seen live stalling the whole campaign on one unlucky request.
// Every network call in this script goes through this so a single bad
// connection surfaces as an error the retry loops can recover from, not a
// silent freeze.
function fetchTimed(input: string, init?: RequestInit): Promise<Response> {
    return fetch(input, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
}

// ---------------------------------------------------------------------------
// Files

type Account = {
    minaPrivateKey: string;
    minaAddress: string;
    cosmosPrivateKeyHex: string;
    cosmosPublicKeyBase64: string;
    pulsarAddress: string;
};

type PlannedTx = {
    amountNano: string;
    hash?: string;
    sentAt?: string;
    confirmed?: boolean;
};

type AccountState = {
    registered?: boolean;
    deposits: PlannedTx[];
    withdraws: PlannedTx[];
};

type State = { accounts: Record<string, AccountState> };

const ACCOUNTS_PATH = join(DATA_DIR, "accounts.json");
const STATE_PATH = join(DATA_DIR, "state.json");
const LOG_PATH = join(DATA_DIR, "log.jsonl");

function loadJson<T>(path: string): T | null {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
}

let state: State;
function saveState() {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function logTx(entry: Record<string, unknown>) {
    appendFileSync(LOG_PATH, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = () => sleep(JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
const randNano = (min: number, max: number) => String(min + Math.floor(Math.random() * (max - min)));

// ---------------------------------------------------------------------------
// Mina GraphQL (payments and account reads — no o1js needed)

// Sticky: a fallback that answered stays selected for later calls, rather
// than re-probing the primary (likely still down) on every single query.
let activeNodeIndex = 0;

async function gqlOnce<T>(url: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetchTimed(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Mina GraphQL ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
    if (!body.data) throw new Error("Mina GraphQL returned no data");
    return body.data;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let lastError: unknown;
    for (let step = 0; step < MINA_GRAPHQL_URLS.length; step++) {
        const index = (activeNodeIndex + step) % MINA_GRAPHQL_URLS.length;
        try {
            const data = await gqlOnce<T>(MINA_GRAPHQL_URLS[index], query, variables);
            if (index !== activeNodeIndex) {
                logger.warn(`Mina node ${MINA_GRAPHQL_URLS[activeNodeIndex]} unresponsive, switched to ${MINA_GRAPHQL_URLS[index]}`);
                activeNodeIndex = index;
            }
            return data;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

/** Balance in nanomina and the nonce a NEW transaction should use. */
async function minaAccountInfo(
    publicKey: string,
): Promise<{ balanceNano: bigint; inferredNonce: number } | null> {
    const data = await gql<{
        account: { balance: { total: string }; inferredNonce: string } | null;
    }>(
        `query ($pk: PublicKey!) { account(publicKey: $pk) { balance { total } inferredNonce } }`,
        { pk: publicKey },
    );
    if (!data.account) return null;
    return {
        balanceNano: BigInt(data.account.balance.total),
        inferredNonce: Number(data.account.inferredNonce),
    };
}

const minaSigner = new Client({ network: "testnet" });

async function sendMinaPayment(
    fromPrivateKey: string,
    to: string,
    amountNano: bigint,
    nonce: number,
): Promise<string> {
    const signed = minaSigner.signPayment(
        {
            from: minaSigner.derivePublicKey(fromPrivateKey),
            to,
            amount: amountNano.toString(),
            fee: PAYMENT_FEE_NANO.toString(),
            nonce,
        },
        fromPrivateKey,
    );

    const data = await gql<{ sendPayment: { payment: { hash: string } } }>(
        `mutation ($input: SendPaymentInput!, $signature: SignatureInput!) {
            sendPayment(input: $input, signature: $signature) { payment { hash } }
        }`,
        { input: signed.data, signature: signed.signature },
    );
    return data.sendPayment.payment.hash;
}

// ---------------------------------------------------------------------------
// Pulsar reads

/** Copied from webapp lib/utils.ts — the REST gateway cannot address base64
 * keys containing "/", the RPC hex form always can. */
async function abciQuery(path: string, request: Uint8Array): Promise<Uint8Array | null> {
    const url = `${PULSAR_RPC_URL}/abci_query?path=${encodeURIComponent(`"${path}"`)}&data=0x${toHex(request)}`;
    const res = await fetchTimed(url);
    if (!res.ok) throw new Error(`Pulsar RPC returned ${res.status}`);
    const body = (await res.json()) as {
        error?: { message?: string };
        result?: { response?: { code?: number; codespace?: string; value?: string } };
    };
    if (body.error) throw new Error(body.error.message ?? "Pulsar RPC error");
    const response = body.result?.response;
    if (!response) throw new Error("Pulsar RPC returned no response");
    // sdk code 22 = key not found: for us an answer, not a failure.
    if (response.code === 22 && response.codespace === "sdk") return null;
    if (response.code) throw new Error(`abci query failed with code ${response.code}`);
    return response.value ? fromBase64(response.value) : new Uint8Array();
}

/** The chain stores a Mina key as 32 LE bytes of x with the odd-y flag in the
 * top bit (webapp lib/crypto.ts formatMinaPublicKey). */
function packMinaPublicKey(base58: string): Uint8Array {
    const publicKey = PublicKey.fromBase58(base58);
    const packed = new Uint8Array(32);
    let x = publicKey.x.toBigInt();
    for (let i = 0; i < 32; i++) {
        packed[i] = Number(x & 0xffn);
        x >>= 8n;
    }
    if (publicKey.isOdd.toBoolean()) packed[31] |= 0x80;
    return packed;
}

async function isRegistered(minaAddress: string): Promise<boolean> {
    const request = QueryGetUserCosmosPublicKeyRequest.encode(
        QueryGetUserCosmosPublicKeyRequest.fromPartial({
            user_mina_public_key: Buffer.from(packMinaPublicKey(minaAddress)),
        }),
    ).finish();
    const value = await abciQuery(KEYREGISTRY_QUERY_USER_COSMOS_KEY, request);
    if (value === null) return false;
    return Boolean(QueryGetUserCosmosPublicKeyResponse.decode(value).user_cosmos_public_key?.length);
}

async function pminaBalance(pulsarAddress: string): Promise<bigint> {
    const res = await fetchTimed(`${PULSAR_REST_URL}/cosmos/bank/v1beta1/balances/${pulsarAddress}`);
    if (!res.ok) throw new Error(`balance read failed (${res.status})`);
    const body = (await res.json()) as { balances: { denom: string; amount: string }[] };
    const raw = body.balances.find((coin) => coin.denom === PMINA_DENOM)?.amount;
    return raw && /^\d+$/.test(raw) ? BigInt(raw) : 0n;
}

/** Global settled bridge movements in one direction, counted the way the
 * webapp's transactions page counts them: transfer EVENTS on the module side,
 * not transactions — a push batches many deposits into one tx. */
async function chainEventCount(direction: "deposit" | "withdraw"): Promise<number> {
    const moduleSide = direction === "deposit" ? "sender" : "recipient";
    let count = 0;
    for (let page = 1; page <= 50; page++) {
        const params = new URLSearchParams({
            query: `transfer.${moduleSide}='${BRIDGE_MODULE_ADDRESS}'`,
            page: String(page),
            limit: "100",
            order_by: "ORDER_BY_DESC",
        });
        const res = await fetchTimed(`${PULSAR_REST_URL}/cosmos/tx/v1beta1/txs?${params}`);
        if (!res.ok) throw new Error(`tx query failed (${res.status})`);
        const { tx_responses = [], total = "0" } = (await res.json()) as {
            tx_responses?: { code: number; events?: { type: string; attributes: { key: string; value: string }[] }[] }[];
            total?: string;
        };
        for (const tx of tx_responses) {
            if (tx.code !== 0) continue;
            for (const event of tx.events ?? []) {
                if (event.type !== "transfer") continue;
                const attrs = Object.fromEntries(event.attributes.map((a) => [a.key, a.value]));
                if (attrs[moduleSide] === BRIDGE_MODULE_ADDRESS && attrs.amount?.endsWith(PMINA_DENOM)) count++;
            }
        }
        if (page * 100 >= Number(total)) break;
    }
    return count;
}

// ---------------------------------------------------------------------------
// Phase: accounts

function createAccounts(): Account[] {
    const accounts: Account[] = [];
    for (let i = 0; i < ACCOUNT_COUNT; i++) {
        const minaPrivate = PrivateKey.random();
        const cosmosPrivate = randomBytes(32);
        // Address derivation must match the chain's: ripemd160(sha256(key)).
        // DirectSecp256k1Wallet derives the same compressed pubkey lazily, but
        // we need it synchronously here, so accounts are finalized in ensure().
        accounts.push({
            minaPrivateKey: minaPrivate.toBase58(),
            minaAddress: minaPrivate.toPublicKey().toBase58(),
            cosmosPrivateKeyHex: toHex(cosmosPrivate),
            cosmosPublicKeyBase64: "",
            pulsarAddress: "",
        });
    }
    return accounts;
}

async function ensureAccounts(): Promise<Account[]> {
    let accounts = loadJson<Account[]>(ACCOUNTS_PATH);
    if (!accounts) {
        accounts = createAccounts();
        logger.info(`Generated ${accounts.length} fresh keypairs`);
    }
    for (const account of accounts) {
        if (account.pulsarAddress) continue;
        const wallet = await DirectSecp256k1Wallet.fromKey(
            Uint8Array.from(Buffer.from(account.cosmosPrivateKeyHex, "hex")),
            BECH32_PREFIX,
        );
        const [{ pubkey, address }] = await wallet.getAccounts();
        account.cosmosPublicKeyBase64 = toBase64(pubkey);
        account.pulsarAddress = address;
    }
    writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), { mode: 0o600 });

    state = loadJson<State>(STATE_PATH) ?? { accounts: {} };
    for (const account of accounts) {
        if (!state.accounts[account.minaAddress]) {
            state.accounts[account.minaAddress] = {
                deposits: Array.from({ length: DEPOSITS_PER_ACCOUNT }, () => ({
                    amountNano: randNano(DEPOSIT_MIN_NANO, DEPOSIT_MAX_NANO),
                })),
                withdraws: Array.from({ length: WITHDRAWS_PER_ACCOUNT }, () => ({
                    amountNano: randNano(WITHDRAW_MIN_NANO, WITHDRAW_MAX_NANO),
                })),
            };
        }
    }
    saveState();
    return accounts;
}

/** What one account must hold on Mina to play its whole part. */
function requiredFundingNano(accountState: AccountState): bigint {
    const deposits = accountState.deposits.reduce((sum, tx) => sum + BigInt(tx.amountNano), 0n);
    const txCount = BigInt(accountState.deposits.length + accountState.withdraws.length);
    const downPayments = BigInt(accountState.withdraws.length) * DOWN_PAYMENT_NANO;
    const fees = txCount * ZKAPP_FEE_NANO;
    // Half a MINA of slack so a fee bump or re-send never strands an account
    // one transaction short.
    return deposits + downPayments + fees + ACCOUNT_CREATION_NANO + NANO / 2n;
}

// ---------------------------------------------------------------------------
// Phase: fund

async function fundPhase(accounts: Account[]) {
    const treasuryKey = process.env.TRAFFIC_TREASURY_KEY;
    const unfunded: { account: Account; needNano: bigint }[] = [];

    for (const account of accounts) {
        const need = requiredFundingNano(state.accounts[account.minaAddress]);
        const info = await minaAccountInfo(account.minaAddress);
        // The creation fee is deducted receiver-side, so a live account's
        // balance reads 1 MINA short of what was sent. Compare accordingly.
        const has = info ? info.balanceNano + ACCOUNT_CREATION_NANO : 0n;
        if (has < need) unfunded.push({ account, needNano: need - has });
    }

    if (!unfunded.length) {
        logger.info("Fund phase: every account is funded");
        return;
    }

    const totalNano = unfunded.reduce((sum, u) => sum + u.needNano, 0n) + BigInt(unfunded.length) * PAYMENT_FEE_NANO;
    if (!treasuryKey) {
        throw new Error(
            `${unfunded.length} accounts need funding (${Number(totalNano / (NANO / 100n)) / 100} MINA total) ` +
                `but TRAFFIC_TREASURY_KEY is not set`,
        );
    }

    const treasuryAddress = minaSigner.derivePublicKey(treasuryKey);
    const treasury = await minaAccountInfo(treasuryAddress);
    if (!treasury) throw new Error(`treasury account ${treasuryAddress} does not exist on ${MINA_NETWORK}`);
    if (treasury.balanceNano < totalNano) {
        throw new Error(
            `treasury holds ${treasury.balanceNano} nanomina but funding needs ${totalNano}. ` +
                `Top up ${treasuryAddress} and restart.`,
        );
    }

    let nonce = treasury.inferredNonce;
    for (const { account, needNano } of unfunded) {
        const hash = await sendMinaPayment(treasuryKey, account.minaAddress, needNano, nonce++);
        logger.info({ hash }, `Funded ${account.minaAddress} with ${needNano} nanomina`);
        logTx({ phase: "fund", minaAddress: account.minaAddress, amountNano: needNano.toString(), hash });
        await sleep(500);
    }

    // Payments land within a few blocks; nothing downstream works without
    // them, so wait here rather than teaching every later phase about it.
    for (;;) {
        const stillShort = [];
        for (const { account } of unfunded) {
            const need = requiredFundingNano(state.accounts[account.minaAddress]);
            const info = await minaAccountInfo(account.minaAddress);
            const has = info ? info.balanceNano + ACCOUNT_CREATION_NANO : 0n;
            if (has < need) stillShort.push(account.minaAddress);
        }
        if (!stillShort.length) break;
        logger.info(`Waiting for ${stillShort.length} funding payments to land`);
        await sleep(POLL_MS);
    }
    logger.info("Fund phase complete");
}

// ---------------------------------------------------------------------------
// Phase: register

async function requestFeeGrant(pulsarAddress: string): Promise<void> {
    const post = await fetchTimed(FEEGRANT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: pulsarAddress }),
    });
    const posted = (await post.json()) as { status?: string; error?: string };
    if (!post.ok) throw new Error(posted.error ?? `fee grant failed: ${post.status}`);
    if (posted.status === "ready") return;

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        await sleep(2_000);
        const res = await fetchTimed(`${FEEGRANT_URL}?address=${encodeURIComponent(pulsarAddress)}`);
        const body = (await res.json()) as { status?: string; granter?: string; error?: string };
        if (!res.ok) throw new Error(body.error ?? `fee grant poll failed: ${res.status}`);
        if (body.status === "ready") return;
    }
    throw new Error("timed out waiting for fee grant");
}

async function feeGranterAddress(): Promise<string> {
    const res = await fetchTimed(`${FEEGRANT_URL}?address=${encodeURIComponent("pulsar1probe")}`);
    const body = (await res.json()) as { granter?: string };
    if (!body.granter) throw new Error("feegrant endpoint reported no granter");
    return body.granter;
}

async function fetchChainId(): Promise<string> {
    const res = await fetchTimed(`${PULSAR_RPC_URL}/status`);
    const body = (await res.json()) as { result?: { node_info?: { network?: string } } };
    const chainId = body.result?.node_info?.network;
    if (!chainId) throw new Error("could not read Pulsar chain id");
    return chainId;
}

async function fetchCosmosAuth(address: string): Promise<{ accountNumber: bigint; sequence: number }> {
    const res = await fetchTimed(`${PULSAR_REST_URL}/cosmos/auth/v1beta1/accounts/${address}`);
    if (!res.ok) throw new Error(`account ${address} unavailable (${res.status})`);
    const body = (await res.json()) as { account?: { account_number?: string; sequence?: string } };
    if (!body.account?.account_number) throw new Error(`account ${address} has no number`);
    return {
        accountNumber: BigInt(body.account.account_number),
        sequence: Number(body.account.sequence ?? "0"),
    };
}

/** Auro's signFields payload shape: field then scalar, 32 LE bytes each
 * (webapp lib/crypto.ts signatureFromBase58, minus the base58 detour). */
function fieldSignatureBytes(base58: string): Uint8Array {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let value = 0n;
    for (const char of base58) {
        const index = alphabet.indexOf(char);
        if (index < 0) throw new Error(`invalid base58 character: ${char}`);
        value = value * 58n + BigInt(index);
    }
    const digits: number[] = [];
    while (value > 0n) {
        digits.unshift(Number(value & 0xffn));
        value >>= 8n;
    }
    let leadingZeros = 0;
    for (const char of base58) {
        if (char === "1") leadingZeros++;
        else break;
    }
    const raw = Uint8Array.from([...new Array(leadingZeros).fill(0), ...digits]);
    if (raw.length < 68) throw new Error("base58 signature is too short");
    return raw.slice(raw.length - 68, raw.length - 4);
}

async function registerPhase(accounts: Account[]) {
    const chainId = await fetchChainId();
    const granter = await feeGranterAddress();

    for (const account of accounts) {
        const accountState = state.accounts[account.minaAddress];
        if (accountState.registered) continue;
        if (await isRegistered(account.minaAddress)) {
            accountState.registered = true;
            saveState();
            continue;
        }

        // The chain verifies a Schnorr signature over this exact field with
        // the TestNet prefix — the same thing Auro's signFields produces.
        const cosmosPubkey = fromBase64(account.cosmosPublicKeyBase64);
        const minaPublicKey = packMinaPublicKey(account.minaAddress);
        const challenge = await keySigningChallenge({
            chainId,
            operation: KeySigningOperation.KEY_SIGNING_OPERATION_REGISTER,
            actorType: ActorType.ACTOR_TYPE_USER,
            cosmosPublicKey: cosmosPubkey,
            newMinaPublicKey: minaPublicKey,
        });
        const signed = minaSigner.signFields([challenge], account.minaPrivateKey);

        await requestFeeGrant(account.pulsarAddress);
        const auth = await fetchCosmosAuth(account.pulsarAddress);

        const bodyBytes = TxBody.encode(
            TxBody.fromPartial({
                messages: [
                    {
                        typeUrl: MSG_REGISTER_USER_KEYS_TYPE_URL,
                        value: MsgRegisterUserKeys.encode(
                            MsgRegisterUserKeys.fromPartial({
                                creator: account.pulsarAddress,
                                cosmos_public_key: Buffer.from(cosmosPubkey),
                                mina_public_key: Buffer.from(minaPublicKey),
                                mina_signature: Buffer.from(fieldSignatureBytes(signed.signature as string)),
                            }),
                        ).finish(),
                    },
                ],
                memo: "Register Mina key with Pulsar",
            }),
        ).finish();

        const signDoc = SignDoc.fromPartial({
            bodyBytes,
            authInfoBytes: makeAuthInfoBytes(
                [
                    {
                        pubkey: encodePubkey({
                            type: "tendermint/PubKeySecp256k1",
                            value: account.cosmosPublicKeyBase64,
                        }),
                        sequence: auth.sequence,
                    },
                ],
                [Coin.fromPartial({ denom: PMINA_DENOM, amount: REGISTER_FEE_PMINA })],
                REGISTER_GAS,
                granter,
                undefined,
            ),
            chainId,
            accountNumber: auth.accountNumber,
        });

        const wallet = await DirectSecp256k1Wallet.fromKey(
            Uint8Array.from(Buffer.from(account.cosmosPrivateKeyHex, "hex")),
            BECH32_PREFIX,
        );
        const signedTx = await wallet.signDirect(account.pulsarAddress, signDoc);
        const txBytes = TxRaw.encode({
            bodyBytes: signedTx.signed.bodyBytes,
            authInfoBytes: signedTx.signed.authInfoBytes,
            signatures: [fromBase64(signedTx.signature.signature)],
        }).finish();

        const res = await fetchTimed(PULSAR_RPC_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "broadcast_tx_commit",
                params: { tx: toBase64(txBytes) },
            }),
        });
        const body = (await res.json()) as {
            result?: { hash?: string; check_tx?: { code?: number; log?: string }; tx_result?: { code?: number; log?: string } };
            error?: { message?: string; data?: string };
        };
        const failure =
            body.error?.data ??
            body.error?.message ??
            (body.result?.check_tx?.code ? body.result.check_tx.log : undefined) ??
            (body.result?.tx_result?.code ? body.result.tx_result.log : undefined);
        // A re-run racing an earlier landed register is a success, not a failure.
        if (failure && !(await isRegistered(account.minaAddress))) {
            throw new Error(`register failed for ${account.minaAddress}: ${failure}`);
        }

        accountState.registered = true;
        saveState();
        logTx({ phase: "register", minaAddress: account.minaAddress, pulsarAddress: account.pulsarAddress, hash: body.result?.hash });
        logger.info(`Registered ${account.minaAddress} -> ${account.pulsarAddress}`);
    }
    logger.info("Register phase complete");
}

// ---------------------------------------------------------------------------
// Phase: waves (deposit / withdraw)

let contract: SettlementContract;

async function compileOnce() {
    const cache = Cache.FileSystem(join(DATA_DIR, "o1js-cache"));
    // Compiling the contract means compiling every program whose proofs its
    // methods verify (webapp lib/worker.ts) — cold this is minutes, cached
    // seconds.
    for (const [name, program] of [
        ["MultisigVerifierProgram", MultisigVerifierProgram],
        ["SettleAttestProgram", SettleAttestProgram],
        ["ApprovalTailProgram", ApprovalTailProgram],
        ["ApprovalQuorumProgram", ApprovalQuorumProgram],
        ["ActionStackProgram", ActionStackProgram],
    ] as const) {
        logger.info(`Compiling ${name}...`);
        await program.compile({ cache });
    }
    logger.info("Compiling SettlementContract...");
    await SettlementContract.compile({ cache });
    contract = new SettlementContract(PublicKey.fromBase58(CONTRACT_ADDRESS));
}

async function sendWaveTx(
    account: Account,
    direction: "deposit" | "withdraw",
    planned: PlannedTx,
    round: number,
): Promise<void> {
    const senderKey = PrivateKey.fromBase58(account.minaPrivateKey);
    const sender = senderKey.toPublicKey();

    await fetchAccount({ publicKey: PublicKey.fromBase58(CONTRACT_ADDRESS) });
    await fetchAccount({ publicKey: sender });
    const info = await minaAccountInfo(account.minaAddress);
    if (!info) throw new Error(`${account.minaAddress} has no Mina account`);

    const tx = await Mina.transaction(
        { sender, fee: Number(ZKAPP_FEE_NANO), nonce: info.inferredNonce },
        async () => {
            if (direction === "deposit") {
                // The chain resolves the destination through keyregistry; the
                // auth field is carried but not read (webapp lib/worker.ts).
                await contract.deposit(
                    UInt64.from(planned.amountNano),
                    PulsarAuth.from(Field(0), CosmosSignature.empty()),
                );
            } else {
                await contract.withdraw(UInt64.from(planned.amountNano));
            }
        },
    );
    await tx.prove();
    tx.sign([senderKey]);
    const pending = await tx.send();
    if (pending.status === "rejected") {
        throw new Error(`send rejected: ${pending.errors.join("; ")}`);
    }

    planned.hash = pending.hash;
    planned.sentAt = new Date().toISOString();
    saveState();
    logTx({
        phase: direction,
        minaAddress: account.minaAddress,
        pulsarAddress: account.pulsarAddress,
        round,
        amountNano: planned.amountNano,
        hash: pending.hash,
    });
    logger.info(
        { hash: pending.hash, amountNano: planned.amountNano },
        `${direction} ${round + 1} sent for ${account.minaAddress}`,
    );
}

/**
 * One direction's full wave: round-robin over accounts so consecutive
 * transactions never share a sender — by the time an account comes around
 * again its previous transaction has long been included (a full round takes
 * ~1-2 hours of proving; blocks take three minutes).
 *
 * A transaction that vanished from the chain (sent but the account's nonce
 * never advanced past it) is re-planned and re-sent on the next sweep, so the
 * wave only ends when every planned transaction is CONFIRMED on Mina.
 */
async function wavePhase(accounts: Account[], direction: "deposit" | "withdraw") {
    const rounds = direction === "deposit" ? DEPOSITS_PER_ACCOUNT : WITHDRAWS_PER_ACCOUNT;

    for (;;) {
        let sentThisSweep = 0;
        let unconfirmed = 0;

        for (let round = 0; round < rounds; round++) {
            for (const account of accounts) {
                const list = state.accounts[account.minaAddress][direction === "deposit" ? "deposits" : "withdraws"];
                const planned = list[round];
                if (planned.confirmed) continue;

                if (planned.hash) {
                    const status = await minaTxStatus(planned.hash);
                    if (status === "INCLUDED") {
                        planned.confirmed = true;
                        saveState();
                        continue;
                    }
                    if (status === "PENDING") {
                        unconfirmed++;
                        continue;
                    }
                    // UNKNOWN within half an hour of sending is far more
                    // likely a node hiccup than a drop — and re-sending a
                    // transaction that does land doubles the spend, which the
                    // funding buffer does not cover. Only give up on stale ones.
                    if (planned.sentAt && Date.now() - new Date(planned.sentAt).getTime() < 30 * 60_000) {
                        unconfirmed++;
                        continue;
                    }
                    // UNKNOWN and stale: dropped from the pool. Clear and re-send below.
                    logger.warn(
                        { minaAddress: account.minaAddress },
                        `${direction} tx ${planned.hash} vanished, re-sending`,
                    );
                    planned.hash = undefined;
                }

                try {
                    await sendWaveTx(account, direction, planned, round);
                    sentThisSweep++;
                    unconfirmed++;
                } catch (error) {
                    logger.error(`${direction} failed for ${account.minaAddress}: ${(error as Error).message}`);
                }
                await jitter();
            }
        }

        if (!sentThisSweep && !unconfirmed) break;
        if (!sentThisSweep) {
            logger.info(`${direction} wave: waiting on ${unconfirmed} pending inclusions`);
            await sleep(POLL_MS);
        }
    }
    logger.info(`${direction} wave complete`);
}

async function minaTxStatus(hash: string): Promise<"INCLUDED" | "PENDING" | "UNKNOWN"> {
    // The node's transactionStatus only knows the transaction pool: it reports
    // PENDING while a tx waits there and UNKNOWN forever after — including for
    // transactions that were included long ago. The archive is the authority
    // on inclusion, so ask it first and use the pool only to separate
    // "in flight" from "gone".
    try {
        const included = await checkZkappTransaction(hash);
        if (included.success) return "INCLUDED";
    } catch {
        // Archive hiccup: fall through to the pool check; a wrong UNKNOWN is
        // shielded by the 30-minute staleness guard in wavePhase.
    }
    try {
        const data = await gql<{ transactionStatus: string }>(
            `query ($hash: String!) { transactionStatus(zkappTransaction: $hash) }`,
            { hash },
        );
        if (data.transactionStatus === "INCLUDED") return "INCLUDED";
        if (data.transactionStatus === "PENDING") return "PENDING";
        return "UNKNOWN";
    } catch {
        return "UNKNOWN";
    }
}

// ---------------------------------------------------------------------------
// Phase: wait for Pulsar credits

async function waitForCredits(accounts: Account[]) {
    for (;;) {
        let short = 0;
        for (const account of accounts) {
            const accountState = state.accounts[account.minaAddress];
            const planned = accountState.withdraws.reduce((sum, tx) => sum + BigInt(tx.amountNano), 0n);
            const balance = await pminaBalance(account.pulsarAddress);
            if (balance < planned) short++;
        }
        if (!short) break;
        logger.info(`Waiting for deposits to settle on Pulsar: ${short}/${accounts.length} accounts not yet credited`);
        await sleep(2 * 60_000);
    }
    logger.info("All accounts credited on Pulsar");
}

// ---------------------------------------------------------------------------
// Status / main

async function printStatus() {
    const accounts = loadJson<Account[]>(ACCOUNTS_PATH) ?? [];
    state = loadJson<State>(STATE_PATH) ?? { accounts: {} };

    let registered = 0, depositsSent = 0, depositsConfirmed = 0, withdrawsSent = 0, withdrawsConfirmed = 0;
    for (const account of accounts) {
        const accountState = state.accounts[account.minaAddress];
        if (!accountState) continue;
        if (accountState.registered) registered++;
        depositsSent += accountState.deposits.filter((tx) => tx.hash).length;
        depositsConfirmed += accountState.deposits.filter((tx) => tx.confirmed).length;
        withdrawsSent += accountState.withdraws.filter((tx) => tx.hash).length;
        withdrawsConfirmed += accountState.withdraws.filter((tx) => tx.confirmed).length;
    }

    const [chainDeposits, chainWithdraws] = await Promise.all([
        chainEventCount("deposit"),
        chainEventCount("withdraw"),
    ]);

    console.log(`accounts:            ${accounts.length}`);
    console.log(`registered:          ${registered}`);
    console.log(`deposits sent:       ${depositsSent}/${accounts.length * DEPOSITS_PER_ACCOUNT} (confirmed on Mina: ${depositsConfirmed})`);
    console.log(`withdraws sent:      ${withdrawsSent}/${accounts.length * WITHDRAWS_PER_ACCOUNT} (confirmed on Mina: ${withdrawsConfirmed})`);
    console.log(`chain-wide settled:  ${chainDeposits} deposits, ${chainWithdraws} withdraws (all users)`);
}

async function main() {
    mkdirSync(DATA_DIR, { recursive: true });
    const command = process.argv[2] ?? "run";

    if (command === "status") {
        await printStatus();
        return;
    }

    const accounts = await ensureAccounts();

    if (command === "init") {
        const totalNano = accounts.reduce(
            (sum, account) => sum + requiredFundingNano(state.accounts[account.minaAddress]) + PAYMENT_FEE_NANO,
            0n,
        );
        console.log(`accounts.json ready with ${accounts.length} accounts at ${ACCOUNTS_PATH}`);
        console.log(`funding needed: ~${Number(totalNano / (NANO / 100n)) / 100} MINA from the treasury`);
        if (process.env.TRAFFIC_TREASURY_KEY) {
            console.log(`treasury address: ${minaSigner.derivePublicKey(process.env.TRAFFIC_TREASURY_KEY)}`);
        } else {
            console.log("set TRAFFIC_TREASURY_KEY to a funded Mina private key before `run`");
        }
        return;
    }

    setMinaNetwork(MINA_NETWORK);

    logger.info("Phase 1/5: fund");
    await fundPhase(accounts);

    logger.info("Phase 2/5: register");
    await registerPhase(accounts);

    logger.info("Compiling circuits (one-off)...");
    await compileOnce();

    logger.info("Phase 3/5: deposit wave");
    await wavePhase(accounts, "deposit");

    logger.info("Phase 4/5: waiting for Pulsar credits (~2h bridge latency)");
    await waitForCredits(accounts);

    logger.info("Phase 5/5: withdraw wave");
    await wavePhase(accounts, "withdraw");

    await printStatus();
    logger.info("Traffic campaign complete — all planned transactions confirmed on Mina.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        logger.error(`traffic: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        process.exit(1);
    });
