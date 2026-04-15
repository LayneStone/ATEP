export declare const TASK_KINDS: {
    readonly ANNOUNCEMENT: 36001;
    readonly BID: 36002;
    readonly SELECTION_LOCK: 36003;
    readonly PROOF_OF_TASK: 36004;
    readonly FINALIZATION: 36005;
    readonly DISPUTE_INITIATION: 36006;
    readonly CANCELLATION_REFUND: 36007;
    readonly WORKER_REFUND: 36008;
    readonly REVIEW_TIMEOUT_COMPLETION: 36009;
    readonly VERIFIER_WHITELIST: 36010;
    readonly ARBITRATION_RESULT: 36011;
    readonly ARBITRATION_TIMEOUT_CLAIM: 36012;
    readonly EXPIRATION: 36013;
};
export declare const atep_PROTOCOL_TAG = "atep";
export declare const atep_PROTOCOL_VERSION = "0.1.0";
export declare const ADMIN_PUBKEYS: readonly string[];
export type TaskKind = (typeof TASK_KINDS)[keyof typeof TASK_KINDS];
export type TaskStatus = "BIDDING" | "LOCKED" | "DELIVERED" | "SUCCESS" | "REJECTED" | "DISPUTED" | "CANCELLED";
export interface TaskAnnouncementPayload {
    task_id: string;
    task_name: string;
    payload_hash: string;
    acceptance_hash: string;
    bid_closing_seconds: number;
    expected_ttl_seconds: number;
    verifier: string[];
    arbitrator_sui_address?: string;
    amount: string;
    asset: string;
    tx_hash: string;
    sui_object_id: string;
}
export interface TaskBidPayload {
    task_id: string;
    worker_sui_address: string;
    capability_proof?: string;
}
export interface SelectionLockPayload {
    task_id: string;
    selected_pubkey: string;
    lock_sig: string;
    start_time_seconds: number;
    sui_object_id: string;
    tx_hash?: string;
}
export interface ProofOfTaskPayload {
    task_id: string;
    delivery_hash: string;
    timestamp_seconds: number;
    tx_hash?: string;
}
export interface TaskFinalizationPayload {
    task_id: string;
    status: "success" | "rejected";
    sui_object_id: string;
    tx_hash?: string;
}
export interface DisputeInitiationPayload {
    task_id: string;
    task_name: string;
    payload_hash: string;
    delivery_hash?: string;
    verifier: string[];
    evidence_list: string[];
    dispute_reason?: string;
    tx_hash?: string;
}
export interface CancellationRefundPayload {
    task_id: string;
    reason: "bid_expired" | "selection_expired" | "ttl_expired" | string;
    sui_object_id: string;
    tx_hash?: string;
}
export interface WorkerRefundPayload {
    task_id: string;
    sui_object_id: string;
    reason: string;
    tx_hash?: string;
}
export interface ReviewTimeoutCompletionPayload {
    task_id: string;
    sui_object_id: string;
    completed_at_seconds: number;
    tx_hash?: string;
}
export interface VerifierInfo {
    pubkey: string;
    sui_address: string;
    effective_from: number;
    expires_at: number;
}
export interface VerifierWhitelistPayload {
    verifiers: VerifierInfo[];
    updated_at: number;
}
export interface ArbitrationResultPayload {
    task_id: string;
    client_pubkey: string;
    worker_pubkey: string;
    winner_pubkey: string;
    loser_pubkey: string;
    arbitration_report_hash: string;
    verdict_summary?: string;
    sui_object_id: string;
    tx_hash?: string;
}
export interface ArbitrationTimeoutClaimPayload {
    task_id: string;
    sui_object_id: string;
    client_pubkey: string;
    worker_pubkey: string;
    verifier_pubkey: string;
    completion_type: number;
    completion_reason?: string;
    tx_hash?: string;
}
export interface ExpirationPayload {
    task_id: string;
    sui_object_id: string;
    expired_at_seconds: number;
    tx_hash?: string;
}
export type TaskPayloadByKind = {
    [TASK_KINDS.ANNOUNCEMENT]: TaskAnnouncementPayload;
    [TASK_KINDS.BID]: TaskBidPayload;
    [TASK_KINDS.SELECTION_LOCK]: SelectionLockPayload;
    [TASK_KINDS.PROOF_OF_TASK]: ProofOfTaskPayload;
    [TASK_KINDS.FINALIZATION]: TaskFinalizationPayload;
    [TASK_KINDS.DISPUTE_INITIATION]: DisputeInitiationPayload;
    [TASK_KINDS.CANCELLATION_REFUND]: CancellationRefundPayload;
    [TASK_KINDS.WORKER_REFUND]: WorkerRefundPayload;
    [TASK_KINDS.REVIEW_TIMEOUT_COMPLETION]: ReviewTimeoutCompletionPayload;
    [TASK_KINDS.VERIFIER_WHITELIST]: VerifierWhitelistPayload;
    [TASK_KINDS.ARBITRATION_RESULT]: ArbitrationResultPayload;
    [TASK_KINDS.ARBITRATION_TIMEOUT_CLAIM]: ArbitrationTimeoutClaimPayload;
    [TASK_KINDS.EXPIRATION]: ExpirationPayload;
};
//# sourceMappingURL=task-kinds.d.ts.map