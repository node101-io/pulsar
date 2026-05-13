export type MinaActionStatus = "pending" | "submitted" | "done" | "failed";

export interface MinaAction {
    type: number;
    accountX: string;
    accountIsOdd: boolean;
    amount: string;
    sender: string;
}
