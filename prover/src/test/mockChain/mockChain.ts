import { EventEmitter } from "events";
import { MockValidator, createMockValidators } from "./mockValidator.js";
import { MockBlock, generateMockBlock, mockBlockToBlockData } from "./mockBlockGenerator.js";
import logger from "../../logger.js";

export class MockChain extends EventEmitter {
    private validators: MockValidator[] = [];
    private blocks: MockBlock[] = [];
    private running: boolean = false;
    private blockInterval?: NodeJS.Timeout;
    private blockGenerationInterval: number = 5000; // new block every 5 secs

    constructor(blockInterval: number = 5000) {
        super();
        this.blockGenerationInterval = blockInterval;
    }

    async start(): Promise<void> {
        if (this.running) {
            logger.warn("Mock chain is already running");
            return;
        }

        logger.info("Starting mock chain...");

        // create validators
        this.validators = await createMockValidators(25);
        logger.info(`Created ${this.validators.length} validators`);

        // create genesis block
        const genesisBlock = generateMockBlock(0, this.validators);
        this.blocks.push(genesisBlock);

        logger.info("Genesis block created", {
            height: genesisBlock.height,
            stateRoot: genesisBlock.stateRoot,
        });

        this.running = true;
        this.emit("start");

        // start block generation
        this.startBlockGeneration();
    }

    private startBlockGeneration(): void {
        logger.info(`Starting block generation (interval: ${this.blockGenerationInterval}ms)`);

        this.blockInterval = setInterval(() => {
            this.generateNextBlock();
        }, this.blockGenerationInterval);
    }

    /**
     * generate next block
     */
    private generateNextBlock(): void {
        const previousBlock = this.blocks[this.blocks.length - 1];
        const nextHeight = previousBlock.height + 1;

        const newBlock = generateMockBlock(nextHeight, this.validators, previousBlock);
        this.blocks.push(newBlock);

        logger.info(`Generated block at height ${newBlock.height}`, {
            stateRoot: newBlock.stateRoot,
            validatorsCount: newBlock.validators.length,
            voteExtCount: newBlock.voteExt.length,
        });

        // emit block data as BlockData
        const blockData = mockBlockToBlockData(newBlock);
        this.emit("newBlock", blockData);
    }

    getBlock(height: number): MockBlock | undefined {
        return this.blocks.find((b) => b.height === height);
    }

    getLatestBlock(): MockBlock | undefined {
        return this.blocks[this.blocks.length - 1];
    }

    getValidators(height?: number): MockValidator[] {
        return this.validators;
    }

    getValidatorByCosmosAddress(cosmosAddress: string): MockValidator | undefined {
        return this.validators.find((v) => v.cosmosAddress === cosmosAddress);
    }

    getValidatorByMinaPublicKey(minaPublicKey: string): MockValidator | undefined {
        return this.validators.find((v) => v.minaPublicKey.toBase58() === minaPublicKey);
    }

    stop(): void {
        if (!this.running) {
            return;
        }

        if (this.blockInterval) {
            clearInterval(this.blockInterval);
            this.blockInterval = undefined;
        }

        this.running = false;
        logger.info("Mock chain stopped");
        this.emit("stop");
    }

    getStatus() {
        return {
            running: this.running,
            blockCount: this.blocks.length,
            validatorCount: this.validators.length,
            latestHeight: this.blocks.length > 0 ? this.blocks[this.blocks.length - 1].height : 0,
        };
    }
}
