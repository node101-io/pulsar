import { Field, PrivateKey, PublicKey, Signature } from "o1js";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import logger from "../../logger.js";

export interface MockValidator {
    index: number;
    cosmosAddress: string;
    cosmosPubkey: Uint8Array;
    cosmosWallet: DirectSecp256k1HdWallet;
    minaPublicKey: PublicKey;
    minaPrivateKey: PrivateKey;
}

export async function createMockValidators(count: number = 25): Promise<MockValidator[]> {
    const validators: MockValidator[] = [];
    const prefix = "cosmos"; // Cosmos address prefix

    logger.info(`Creating ${count} mock validators...`);

    for (let i = 0; i < count; i++) {
        // create Cosmos key pair
        const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix });
        const [account] = await wallet.getAccounts();

        // create Mina key pair
        const minaPrivateKey = PrivateKey.random();
        const minaPublicKey = minaPrivateKey.toPublicKey();

        validators.push({
            index: i,
            cosmosAddress: account.address,
            cosmosPubkey: account.pubkey,
            cosmosWallet: wallet,
            minaPublicKey,
            minaPrivateKey,
        });

        logger.debug(`Created validator ${i + 1}/${count}`, {
            cosmosAddress: account.address,
            minaPublicKey: minaPublicKey.toBase58(),
        });
    }

    logger.info(`Successfully created ${count} mock validators`);
    return validators;
}

export function signWithMina(validator: MockValidator, message: Field[]): Signature {
    return Signature.create(validator.minaPrivateKey, message);
}
