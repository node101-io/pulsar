import { Cache } from "o1js";
import {
    MultisigVerifierProgram,
    ValidateReduceProgram,
    ActionStackProgram,
    SettlementContract,
} from "pulsar-contracts";

export const cacheCompile = async () => {
    try {
        const multisigVerifierProgram: Cache = Cache.FileSystem("./cache/multisigVerifierProgram");
        const validateReduceProgram: Cache = Cache.FileSystem("./cache/validateReduceProgram");
        const actionStackProgram: Cache = Cache.FileSystem("./cache/actionStackProgram");
        const settlementContract: Cache = Cache.FileSystem("./cache/settlementContract");

        await MultisigVerifierProgram.compile({ cache: multisigVerifierProgram });
        await ValidateReduceProgram.compile({ cache: validateReduceProgram });
        await ActionStackProgram.compile({ cache: actionStackProgram });
        await SettlementContract.compile({ cache: settlementContract });
    } catch (err) {
        throw new Error(`Failed to compile contracts: ${err}`);
    }
};
