export type MinaActionStatus = "pending" | "submitted" | "done" | "failed";

export interface PulsarActionData {
    action_type: string;
    public_key: string;
    amount: string;
    cosmos_address: string;
    cosmos_signature: string;
}
