import { Field, Poseidon, PublicKey, Signature } from "o1js";
import { MockValidator, signWithMina } from "./mockValidator.js";
import { BlockData, VoteExt } from "../../interfaces.js";
import logger from "../../logger.js";


export interface MockBlock {
    height: number;
    stateRoot: string;
    validators: string[];
    validatorListHash: string;
    voteExt: VoteExt[];
    timestamp: Date;
    chainId: string;
}

export function calculateStateRoot(height: number, previousStateRoot: string): string {
    // deterministic state root: height + previousStateRoot hash
    const heightField = Field(height);
    const previousStateRootField = Field(previousStateRoot);
    const hash = Poseidon.hash([heightField, previousStateRootField]);
    return hash.toBigInt().toString();
}

export function calculateValidatorListHash(validators: PublicKey[]): string {
    const validatorHashes = validators.map((v) => Poseidon.hash(v.toFields()));
    // combine all validator hashes
    let combinedHash = Field(0);
    for (const hash of validatorHashes) {
        combinedHash = Poseidon.hash([combinedHash, hash]);
    }
    return combinedHash.toBigInt().toString();
}

function createBlockMessage(
    previousHeight: number,
    previousStateRoot: string,
    currentHeight: number,
    currentStateRoot: string
): Field[] {
    return [
        Field(previousHeight),
        Field(previousStateRoot),
        Field(currentHeight),
        Field(currentStateRoot),
    ];
}

function createVoteExtension(
    validator: MockValidator,
    height: number,
    previousHeight: number,
    previousStateRoot: string,
    currentStateRoot: string
): VoteExt {
    const message = createBlockMessage(previousHeight, previousStateRoot, height, currentStateRoot);
    const signature = signWithMina(validator, message);

    return {
        index: validator.index.toString(),
        height,
        validatorAddr: validator.minaPublicKey.toBase58(),
        signature: signature.toBase58(),
    };
}

export function generateMockBlock(
    height: number,
    validators: MockValidator[],
    previousBlock?: MockBlock
): MockBlock {
    // Calculate previous block info
    const previousHeight = previousBlock ? previousBlock.height : height > 0 ? height - 1 : 0;
    const previousStateRoot = previousBlock?.stateRoot || "0";
    const stateRoot = calculateStateRoot(height, previousStateRoot);
    
    const validatorPublicKeys = validators.map((v) => v.minaPublicKey);
    const validatorListHash = calculateValidatorListHash(validatorPublicKeys);
    
    const validatorAddresses = validators.map((v) => v.minaPublicKey.toBase58());

    // create vote extensions
    const voteExt: VoteExt[] = validators.map((validator) =>
        createVoteExtension(validator, height, previousHeight, previousStateRoot, stateRoot)
    );

    const block: MockBlock = {
        height,
        stateRoot,
        validators: validatorAddresses,
        validatorListHash,
        voteExt,
        timestamp: new Date(),
        chainId: "pulsar-test",
    };

    logger.debug(`Generated mock block at height ${height}`, {
        stateRoot,
        validatorsCount: validators.length,
        voteExtCount: voteExt.length,
    });

    return block;
}

export function mockBlockToBlockData(block: MockBlock): BlockData {
    return {
        height: block.height,
        stateRoot: block.stateRoot,
        validators: block.validators,
        voteExt: block.voteExt,
    };
}
