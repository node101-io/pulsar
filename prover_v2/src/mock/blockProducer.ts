import { PrivateKey, Signature, Field, Poseidon, PublicKey } from "o1js";
import { List } from "pulsar-contracts";

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

// Compute poseidon based validator list hash, it matches computeValidatorListHash in client.ts
function computeValidatorListHash(validators: MockValidator[]): bigint {
    const list = List.empty();
    for (const v of validators) {
        list.push(Poseidon.hash(PublicKey.fromBase58(v.address).toFields()));
    }
    return list.hash.toBigInt();
}

// Sign over Block.hash() = Poseidon.hash([6 fields]) — matches SettlementProof.js
function signBlock(privKeyBase58: string, body: MockVoteExtBody): Buffer {
    const privKey = PrivateKey.fromBase58(privKeyBase58);

    const blockHash = Poseidon.hash([
        Field(body.initialValidatorListHash),
        Field(body.initialStateRoot),
        Field(body.initialBlockHeight),
        Field(body.newValidatorListHash),
        Field(body.newStateRoot),
        Field(body.newBlockHeight),
    ]);

    const sig = Signature.create(privKey, blockHash.toFields());
    const sigValue = Signature.toValue(sig);

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

    // Use Field.random() to stay within field modulus
    const stateRoot = Field.random().toBigInt();
    const validatorListHash = computeValidatorListHash(activeValidators);

    const prevStateRoot = prevBlock?.stateRoot ?? Field.random().toBigInt();
    const prevValidatorListHash =
        prevBlock?.validatorListHash ??
        computeValidatorListHash(activeValidators);
    const prevHeight = prevBlock?.height ?? 0;

    const body: MockVoteExtBody = {
        initialValidatorListHash: prevValidatorListHash,
        initialStateRoot: prevStateRoot,
        initialBlockHeight: prevHeight,
        newValidatorListHash: validatorListHash,
        newStateRoot: stateRoot,
        newBlockHeight: height,
    };

    // Tendermint semantics: the validators from the PREVIOUS block sign the
    // current block. The new validator set (activeValidators) is recorded in
    // this block's validatorListHash but doesn't sign until the next block.
    const signers = prevBlock?.validators ?? activeValidators;

    const voteExts: MockVoteExt[] = signers.map((v) => ({
        index: `${height}/${v.address}`,
        height,
        validatorAddr: v.address,
        signature: signBlock(v.privateKeyBase58, body),
        body,
    }));

    const block: MockBlock = {
        height,
        stateRoot,
        validatorListHash,
        validators: [...activeValidators],
        voteExts,
    };

    blocks.set(height, block);
    latestHeight = height;

    for (const v of activeValidators) {
        v.stake = updateStake(v.stake);
    }

    const next: MockValidator[] = [];
    for (const v of activeValidators) {
        if (Math.random() < MOCK_VALIDATOR_EXIT_PROBABILITY) {
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
