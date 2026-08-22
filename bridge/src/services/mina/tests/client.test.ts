import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetchCheckedAccount } = vi.hoisted(() => ({
    mockFetchCheckedAccount: vi.fn(),
}));

vi.mock("o1js", () => ({
    PublicKey: {
        fromBase58: vi.fn((s: string) => ({ toBase58: () => s })),
    },
}));

vi.mock("pulsar-contracts/build/src/SettlementContract.js", () => ({
    SettlementContract: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("pulsar-contracts/build/src/utils/fetch.js", () => ({
    setMinaNetwork: vi.fn(),
    // The walk and the dead-node error mapping are pinned in
    // contracts/src/test/fetch.test.ts; these tests only cover what the
    // bridge layers ON TOP of a fetched account (zkapp-state handling).
    fetchCheckedAccount: mockFetchCheckedAccount,
    activeNodeEndpoint: vi.fn(() => "https://node.devnet"),
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
        zkapp: {
            appState: appState.map(field),
            actionState: actionState.map(field),
        },
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
        mockFetchCheckedAccount.mockResolvedValue(
            makeAccount(["1", "2", "3", "4", "5"], ["a", "b", "c", "d", "e"]),
        );

        await refreshContractState(ctx);

        expect(ctx.zkappState).toEqual(["1", "2", "3", "4", "5"]);
        expect(ctx.actionStateHistory).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("propagates an unreadable account instead of swallowing it", async () => {
        // The mapping itself (dead node vs missing account) is pinned in
        // contracts/src/test/fetch.test.ts — here only the propagation.
        mockFetchCheckedAccount.mockRejectedValue(
            new Error("Could not fetch account B62qTest: account not found"),
        );

        await expect(refreshContractState(makeCtx())).rejects.toThrow(
            /Could not fetch account/,
        );
    });

    it("throws when the account has no zkapp state (not deployed)", async () => {
        mockFetchCheckedAccount.mockResolvedValue({ zkapp: undefined });

        await expect(refreshContractState(makeCtx())).rejects.toThrow(
            /is it deployed/,
        );
    });
});
