"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTaskEvent = createTaskEvent;
exports.parseTaskEventPayload = parseTaskEventPayload;
const task_kinds_1 = require("./task-kinds");
function requireString(value, fieldName) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`invalid payload: ${fieldName} must be a non-empty string`);
    }
}
function requireNumber(value, fieldName) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`invalid payload: ${fieldName} must be a finite number`);
    }
}
function requireStringArray(value, fieldName) {
    if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== "string")) {
        throw new Error(`invalid payload: ${fieldName} must be a non-empty string[]`);
    }
}
function validatePayloadByKind(kind, payload) {
    switch (kind) {
        case task_kinds_1.TASK_KINDS.ANNOUNCEMENT: {
            const p = payload;
            requireString(p.task_id, "task_id");
            requireString(p.task_name, "task_name");
            requireString(p.payload_hash, "payload_hash");
            requireString(p.acceptance_hash, "acceptance_hash");
            requireString(p.amount, "amount");
            requireString(p.asset, "asset");
            requireString(p.tx_hash, "tx_hash");
            requireNumber(p.bid_closing_seconds, "bid_closing_seconds");
            if (p.bid_closing_seconds <= 0) {
                throw new Error("invalid payload: bid_closing_seconds must be > 0 seconds");
            }
            if (p.bid_closing_seconds > 86400) {
                throw new Error("invalid payload: bid_closing_seconds must be <= 86400 seconds (24 hours)");
            }
            requireNumber(p.expected_ttl_seconds, "expected_ttl_seconds");
            requireStringArray(p.verifier, "verifier");
            return;
        }
        case task_kinds_1.TASK_KINDS.BID: {
            const p = payload;
            requireString(p.task_id, "task_id");
            if (p.capability_proof !== undefined) {
                requireString(p.capability_proof, "capability_proof");
            }
            return;
        }
        case task_kinds_1.TASK_KINDS.SELECTION_LOCK: {
            const p = payload;
            requireString(p.task_id, "task_id");
            requireString(p.selected_pubkey, "selected_pubkey");
            requireString(p.lock_sig, "lock_sig");
            requireNumber(p.start_time_seconds, "start_time_seconds");
            return;
        }
        case task_kinds_1.TASK_KINDS.PROOF_OF_TASK: {
            const p = payload;
            requireString(p.task_id, "task_id");
            requireString(p.delivery_hash, "delivery_hash");
            requireNumber(p.timestamp_seconds, "timestamp_seconds");
            return;
        }
        case task_kinds_1.TASK_KINDS.FINALIZATION: {
            const p = payload;
            requireString(p.task_id, "task_id");
            if (p.status !== "success" && p.status !== "rejected") {
                throw new Error("invalid payload: status must be success or rejected");
            }
            return;
        }
        case task_kinds_1.TASK_KINDS.DISPUTE_INITIATION: {
            const p = payload;
            requireString(p.task_id, "task_id");
            requireString(p.task_name, "task_name");
            requireString(p.payload_hash, "payload_hash");
            if (p.delivery_hash !== undefined) {
                requireString(p.delivery_hash, "delivery_hash");
            }
            requireStringArray(p.verifier, "verifier");
            if (!Array.isArray(p.evidence_list)) {
                throw new Error("invalid payload: evidence_list must be string[]");
            }
            if (p.dispute_reason !== undefined) {
                requireString(p.dispute_reason, "dispute_reason");
            }
            return;
        }
        case task_kinds_1.TASK_KINDS.CANCELLATION_REFUND: {
            const p = payload;
            requireString(p.task_id, "task_id");
            requireString(p.reason, "reason");
            return;
        }
        case task_kinds_1.TASK_KINDS.VERIFIER_WHITELIST: {
            const p = payload;
            if (!Array.isArray(p.verifiers)) {
                throw new Error("invalid payload: verifiers must be an array");
            }
            for (const v of p.verifiers) {
                requireString(v.pubkey, "verifier.pubkey");
                requireNumber(v.effective_from, "verifier.effective_from");
                requireNumber(v.expires_at, "verifier.expires_at");
            }
            requireNumber(p.updated_at, "updated_at");
            return;
        }
        case task_kinds_1.TASK_KINDS.ARBITRATION_RESULT: {
            const p = payload;
            requireString(p.task_id, "task_id");
            requireString(p.client_pubkey, "client_pubkey");
            requireString(p.worker_pubkey, "worker_pubkey");
            requireString(p.winner_pubkey, "winner_pubkey");
            requireString(p.loser_pubkey, "loser_pubkey");
            requireString(p.arbitration_report_hash, "arbitration_report_hash");
            if (p.winner_pubkey !== p.client_pubkey && p.winner_pubkey !== p.worker_pubkey) {
                throw new Error("invalid payload: winner_pubkey must be either client_pubkey or worker_pubkey");
            }
            if (p.loser_pubkey !== p.client_pubkey && p.loser_pubkey !== p.worker_pubkey) {
                throw new Error("invalid payload: loser_pubkey must be either client_pubkey or worker_pubkey");
            }
            if (p.winner_pubkey === p.loser_pubkey) {
                throw new Error("invalid payload: winner_pubkey and loser_pubkey cannot be the same");
            }
            if (p.verdict_summary !== undefined) {
                requireString(p.verdict_summary, "verdict_summary");
            }
            return;
        }
        default:
            throw new Error(`unsupported task kind: ${kind}`);
    }
}
function createTaskEvent(args) {
    requireString(args.pubkey, "pubkey");
    validatePayloadByKind(args.kind, args.payload);
    const content = JSON.stringify(args.payload);
    const taskId = args.payload.task_id;
    const baseTags = [
        ["task_id", taskId],
        ["protocol", task_kinds_1.atep_PROTOCOL_TAG, task_kinds_1.atep_PROTOCOL_VERSION],
    ];
    return {
        kind: args.kind,
        pubkey: args.pubkey,
        created_at: args.created_at ?? Math.floor(Date.now() / 1000),
        tags: args.extraTags ? [...baseTags, ...args.extraTags] : baseTags,
        content,
    };
}
function parseTaskEventPayload(event) {
    let payload;
    try {
        payload = JSON.parse(event.content);
    }
    catch (_error) {
        throw new Error("invalid event content: must be JSON payload");
    }
    validatePayloadByKind(event.kind, payload);
    return payload;
}
//# sourceMappingURL=task-events.js.map