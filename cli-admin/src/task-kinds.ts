/**
 * atep Nostr  - Kind 
 * 
 *  cli-admin 
 *  nostr/src/task-kinds.ts 
 */

export const TASK_KINDS = {
  /**   */
  ANNOUNCEMENT: 36001,

  /**  */
  BID: 36002,

  /**  */
  SELECTION_LOCK: 36003,

  /**  */
  PROOF_OF_TASK: 36004,

  /**  */
  FINALIZATION: 36005,

  /**  */
  DISPUTE_INITIATION: 36006,

  /**  */
  CANCELLATION_REFUND: 36007,

  /**  */
  WORKER_REFUND: 36008,

  /**  */
  REVIEW_TIMEOUT_COMPLETION: 36009,

  /**   */
  VERIFIER_WHITELIST: 36010,

  /**  */
  ARBITRATION_RESULT: 36011,

  /**  */
  ARBITRATION_TIMEOUT_CLAIM: 36012,

  /**  */
  EXPIRATION: 36013,
} as const;

/**   */
export type TaskKind = (typeof TASK_KINDS)[keyof typeof TASK_KINDS];
