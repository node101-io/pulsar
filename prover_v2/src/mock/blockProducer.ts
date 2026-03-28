import crypto from "crypto";
import { PrivateKey, Signature, Field } from "o1js";

import {
    MOCK_VALIDATOR_POOL_SIZE,
    MOCK_ACTIVE_VALIDATOR_COUNT,
    MOCK_START_HEIGHT,
    MOCK_BLOCK_PRODUCE_INTERVAL_MS,
    MOCK_VALIDATOR_INITIAL_STAKE_MIN,
    MOCK_VALIDATOR_INITIAL_STAKE_MAX,
    MOCK_VALIDATOR_STAKE_CHANGE_MAX,
    MOCK_VALIDATOR_STAKE_MIN,
    MOCK_VALIDATOR_EXIT_PROBABILITY,
} from "./constants.js";
import {
    MockBlock,
    MockValidator,
    MockVoteExt,
    MockVoteExtBody,
} from "./types.js";

// In-memory block store (height to MockBlock)
const blocks = new Map<number, MockBlock>();

// Validator pool (fixed across entire run)
let validatorPool: MockValidator[] = [];

// Current active set
let activeValidators: MockValidator[] = [];

// Pool cursor for rotation
let poolCursor = 0;

// Current produced height
let latestHeight = MOCK_START_HEIGHT - 1;

export function getBlocks(): Map<number, MockBlock> {
    return blocks;
}

export function getLatestHeight(): number {
    return latestHeight;
}

function computeValidatorSetRoot(validators: MockValidator[]): Buffer {
    const sorted = [...validators].sort((a, b) =>
        a.address.localeCompare(b.address),
    );
    const hash = crypto.createHash("sha256");
    for (const v of sorted) hash.update(v.address);
    return hash.digest();
}

function signBody(privKeyBase58: string, body: MockVoteExtBody): Buffer {
    const privKey = PrivateKey.fromBase58(privKeyBase58);

    // Pack body fields into Field array for signing
    const fields = [
        ...Array.from(body.initialValidatorSetRoot).map((b) => Field(b)),
        ...Array.from(body.initialStateRoot).map((b) => Field(b)),
        Field(body.initialBlockHeight),
        ...Array.from(body.newValidatorSetRoot).map((b) => Field(b)),
        ...Array.from(body.newStateRoot).map((b) => Field(b)),
        Field(body.newBlockHeight),
    ];

    const sig = Signature.create(privKey, fields);
    const sigValue = Signature.toValue(sig);

    // Encode r (32 bytes) + s (32 bytes)
    const rBuf = Buffer.from(sigValue.r.toString(16).padStart(64, "0"), "hex");
    const sBuf = Buffer.from(sigValue.s.toString(16).padStart(64, "0"), "hex");
    return Buffer.concat([rBuf, sBuf]);
}

function randomInitialStake(): number {
    return (
        MOCK_VALIDATOR_INITIAL_STAKE_MIN +
        Math.floor(
            Math.random() *
                (MOCK_VALIDATOR_INITIAL_STAKE_MAX -
                    MOCK_VALIDATOR_INITIAL_STAKE_MIN +
                    1),
        )
    );
}

function updateStake(current: number): number {
    // Uniform distribution in -max, +max
    const delta =
        Math.floor(Math.random() * (2 * MOCK_VALIDATOR_STAKE_CHANGE_MAX + 1)) -
        MOCK_VALIDATOR_STAKE_CHANGE_MAX;
    return Math.max(MOCK_VALIDATOR_STAKE_MIN, current + delta);
}

export async function initBlockProducer(): Promise<void> {
    validatorPool = Array.from({ length: MOCK_VALIDATOR_POOL_SIZE }, () => {
        const privKey = PrivateKey.random();
        return {
            address: privKey.toPublicKey().toBase58(),
            privateKeyBase58: privKey.toBase58(),
            stake: randomInitialStake(),
        };
    });

    activeValidators = validatorPool.slice(0, MOCK_ACTIVE_VALIDATOR_COUNT);
    poolCursor = MOCK_ACTIVE_VALIDATOR_COUNT % MOCK_VALIDATOR_POOL_SIZE;
}

export function produceNextBlock(): MockBlock {
    const prevBlock = blocks.get(latestHeight);

    const height = latestHeight + 1;
    const stateRoot = crypto.randomBytes(32);
    const validatorSetRoot = computeValidatorSetRoot(activeValidators);

    const prevStateRoot = prevBlock?.stateRoot ?? crypto.randomBytes(32);
    const prevValidatorSetRoot =
        prevBlock?.validatorSetRoot ??
        computeValidatorSetRoot(activeValidators);
    const prevHeight = prevBlock?.height ?? 0;

    const body: MockVoteExtBody = {
        initialValidatorSetRoot: prevValidatorSetRoot,
        initialStateRoot: prevStateRoot,
        initialBlockHeight: prevHeight,
        newValidatorSetRoot: validatorSetRoot,
        newStateRoot: stateRoot,
        newBlockHeight: height,
    };

    const voteExts: MockVoteExt[] = activeValidators.map((v) => ({
        index: `${height}/${v.address}`,
        height,
        validatorAddr: v.address,
        signature: signBody(v.privateKeyBase58, body),
        body,
    }));

    const block: MockBlock = {
        height,
        stateRoot,
        validatorSetRoot,
        validators: [...activeValidators],
        voteExts,
    };

    blocks.set(height, block);
    latestHeight = height;

    // Update stake for all active validators
    for (const v of activeValidators) {
        v.stake = updateStake(v.stake);
    }

    const next: MockValidator[] = [];
    for (const v of activeValidators) {
        if (Math.random() < MOCK_VALIDATOR_EXIT_PROBABILITY) {
            // Replace with next from pool
            next.push(validatorPool[poolCursor]);
            poolCursor = (poolCursor + 1) % MOCK_VALIDATOR_POOL_SIZE;
        } else {
            next.push(v);
        }
    }
    activeValidators = next;

    return block;
}

export function startBlockProduction(
    onBlock?: (block: MockBlock) => void,
): NodeJS.Timeout {
    return setInterval(() => {
        const block = produceNextBlock();
        onBlock?.(block);
    }, MOCK_BLOCK_PRODUCE_INTERVAL_MS);
}
