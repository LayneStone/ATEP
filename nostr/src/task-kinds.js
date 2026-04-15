"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_PUBKEYS = exports.atep_PROTOCOL_VERSION = exports.atep_PROTOCOL_TAG = exports.TASK_KINDS = void 0;
exports.TASK_KINDS = {
    ANNOUNCEMENT: 36001,
    BID: 36002,
    SELECTION_LOCK: 36003,
    PROOF_OF_TASK: 36004,
    FINALIZATION: 36005,
    DISPUTE_INITIATION: 36006,
    CANCELLATION_REFUND: 36007,
    WORKER_REFUND: 36008,
    REVIEW_TIMEOUT_COMPLETION: 36009,
    VERIFIER_WHITELIST: 36010,
    ARBITRATION_RESULT: 36011,
    ARBITRATION_TIMEOUT_CLAIM: 36012,
    EXPIRATION: 36013,
};
exports.atep_PROTOCOL_TAG = "atep";
exports.atep_PROTOCOL_VERSION = "0.1.0";
exports.ADMIN_PUBKEYS = [
    "official_admin_pubkey_1",
    "official_admin_pubkey_2",
];
//# sourceMappingURL=task-kinds.js.map