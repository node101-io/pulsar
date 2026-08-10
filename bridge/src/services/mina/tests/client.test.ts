import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetchAccount } = vi.hoisted(() => ({
    mockFetchAccount: vi.fn(),
}));

vi.mock("o1js", () => ({
    fetchAccount: mockFetchAccount,
    PublicKey: {
        fromBase58: vi.fn((s: string) => ({ toBase58: () => s })),
    },
}));

vi.mock("pulsar-contracts/build/src/SettlementContract.js", () => ({
    SettlementContract: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("pulsar-contracts/build/src/utils/fetch.js", () => ({
    setMinaNetwork: vi.fn(),
}));

vi.mock("pulsar-contracts/build/src/utils/constants.js", () => ({
    ENDPOINTS: {
        NODE: { devnet: "https://node.devnet", lightnet: "http://localhost:8080" },
        ARCHIVE: { devnet: "https://archive.devnet", lightnet: "http://localhost:8282" },
    },
}));

vi.mock("../../../common/logger.js", () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
    refreshContractState,
    getActionStateHistory,
    getContractMerkleRoot,
    getContractActionState,
    getContractApprovalCursor,
    getContractSettledHeight,
} from "../client.js";

function field(v: string) {
    return { toString: () => v };
}

function makeAccount(appState: string[], actionState: string[]) {
    return {
        account: {
            zkapp: {
                appState: appState.map(field),
                actionState: actionState.map(field),
            },
        },
        error: null,
    };
}

function makeCtx() {
    return {
        contractAddress: { toBase58: () => "B62qTest" },
        zkappState: [],
        actionStateHistory: [],
    } as any;
}

describe("contract state getters — @state declaration order", () => {
    // 0=actionState, 1=merkleListRoot, 2=stateRoot, 3=blockHeight, 4=approvalCursor
    const ctx = {
        zkappState: ["10", "11", "12", "13", "14"],
        actionStateHistory: ["t0", "t1", "t2", "t3", "t4"],
    } as any;

    it("getContractActionState reads slot 0 (the processed pointer)", () => {
        expect(getContractActionState(ctx)).toBe("10");
    });

    it("getContractMerkleRoot reads slot 1", () => {
        expect(getContractMerkleRoot(ctx)).toBe("11");
    });

    it("getContractSettledHeight reads slot 3 as a number (a PULSAR height)", () => {
        expect(getContractSettledHeight(ctx)).toBe(13);
    });

    it("getContractApprovalCursor reads slot 4", () => {
        expect(getContractApprovalCursor(ctx)).toBe("14");
    });

    it("getActionStateHistory returns the five stored action states, tip first", () => {
        expect(getActionStateHistory(ctx)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    });
});

describe("refreshContractState", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("updates zkappState AND actionStateHistory from the same snapshot", async () => {
        const ctx = makeCtx();
        mockFetchAccount.mockResolvedValue(
            makeAccount(["1", "2", "3", "4", "5"], ["a", "b", "c", "d", "e"]),
        );

        await refreshContractState(ctx);

        expect(ctx.zkappState).toEqual(["1", "2", "3", "4", "5"]);
        expect(ctx.actionStateHistory).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("throws when fetchAccount reports an error", async () => {
        mockFetchAccount.mockResolvedValue({
            account: undefined,
            error: { statusText: "account not found" },
        });

        await expect(refreshContractState(makeCtx())).rejects.toThrow(
            /fetchAccount failed/,
        );
    });

    it("throws when the account has no zkapp state (not deployed)", async () => {
        mockFetchAccount.mockResolvedValue({
            account: { zkapp: undefined },
            error: null,
        });

        await expect(refreshContractState(makeCtx())).rejects.toThrow(
            /is it deployed/,
        );
    });
});
