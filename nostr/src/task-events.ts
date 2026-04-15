import { TASK_KINDS, atep_PROTOCOL_TAG, atep_PROTOCOL_VERSION, type TaskKind, type TaskPayloadByKind } from "./task-kinds";

/**
 * Nostr 标签的基础形态
 *
 * 第一个元素是标签名称，后续元素是值。
 *
 * @example
 * ["task_id", "abc123"]
 * ["e", "event_id", "relay_url"]
 */
export type NostrTag = [string, ...string[]];

/**
 * 任务事件的最小公共结构
 *
 * 符合 Nostr NIP-01 事件格式，专门用于 atep 协议。
 *
 * @property kind - 事件类型（TASK_KINDS 中定义的值）
 * @property pubkey - 发布者公钥（hex 格式）
 * @property created_at - 创建时间戳（Unix 时间戳，秒）
 * @property tags - 标签数组，至少包含 ["task_id", "..."]
 * @property content - JSON 字符串格式的 payload
 * @property sig - 事件签名（可选，签名后添加）
 * @property id - 事件 ID（可选，签名后添加）
 */
export interface NostrTaskEvent<K extends TaskKind = TaskKind> {
  kind: K;
  pubkey: string;
  created_at: number;
  tags: NostrTag[];
  content: string;
  sig?: string;
  id?: string;
}

/**
 * 断言值为非空字符串
 *
 * @throws {Error} 如果值不是非空字符串
 */
function requireString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`invalid payload: ${fieldName} must be a non-empty string`);
  }
}

/**
 * 断言值为有限数字
 *
 * @throws {Error} 如果值不是有限数字
 */
function requireNumber(value: unknown, fieldName: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`invalid payload: ${fieldName} must be a finite number`);
  }
}

/**
 * 断言值为非空字符串数组
 *
 * @throws {Error} 如果值不是非空字符串数组
 */
function requireStringArray(value: unknown, fieldName: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== "string")) {
    throw new Error(`invalid payload: ${fieldName} must be a non-empty string[]`);
  }
}


/**
 * 按协议对 payload 进行基础合法性检查
 *
 * 根据不同的 Kind 类型验证对应的 payload 字段。
 *
 * @throws {Error} 如果 payload 不符合协议要求
 */
function validatePayloadByKind<K extends TaskKind>(kind: K, payload: TaskPayloadByKind[K]) {
  switch (kind) {
    case TASK_KINDS.ANNOUNCEMENT: {
      const p = payload as TaskPayloadByKind[typeof TASK_KINDS.ANNOUNCEMENT];
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
    case TASK_KINDS.BID: {
      const p = payload as TaskPayloadByKind[typeof TASK_KINDS.BID];
      requireString(p.task_id, "task_id");
      if (p.capability_proof !== undefined) {
        requireString(p.capability_proof, "capability_proof");
      }
      return;
    }
    case TASK_KINDS.SELECTION_LOCK: {
      const p = payload as TaskPayloadByKind[typeof TASK_KINDS.SELECTION_LOCK];
      requireString(p.task_id, "task_id");
      requireString(p.selected_pubkey, "selected_pubkey");
      requireString(p.lock_sig, "lock_sig");
      requireNumber(p.start_time_seconds, "start_time_seconds");
      return;
    }
    case TASK_KINDS.PROOF_OF_TASK: {
      const p = payload as TaskPayloadByKind[typeof TASK_KINDS.PROOF_OF_TASK];
      requireString(p.task_id, "task_id");
      requireString(p.delivery_hash, "delivery_hash");
      requireNumber(p.timestamp_seconds, "timestamp_seconds");
      return;
    }
    case TASK_KINDS.FINALIZATION: {
      const p = payload as TaskPayloadByKind[typeof TASK_KINDS.FINALIZATION];
      requireString(p.task_id, "task_id");
      if (p.status !== "success" && p.status !== "rejected") {
        throw new Error("invalid payload: status must be success or rejected");
      }
      return;
    }
    case TASK_KINDS.DISPUTE_INITIATION: {
      const p = payload as TaskPayloadByKind[typeof TASK_KINDS.DISPUTE_INITIATION];
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
    case TASK_KINDS.CANCELLATION_REFUND: {
      const p = payload as TaskPayloadByKind[typeof TASK_KINDS.CANCELLATION_REFUND];
      requireString(p.task_id, "task_id");
      requireString(p.reason, "reason");
      return;
    }
    case TASK_KINDS.VERIFIER_WHITELIST: {
      const p = payload as TaskPayloadByKind[typeof TASK_KINDS.VERIFIER_WHITELIST];
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
    case TASK_KINDS.ARBITRATION_RESULT: {
      const p = payload as TaskPayloadByKind[typeof TASK_KINDS.ARBITRATION_RESULT];
      requireString(p.task_id, "task_id");
      requireString(p.client_pubkey, "client_pubkey");
      requireString(p.worker_pubkey, "worker_pubkey");
      requireString(p.winner_pubkey, "winner_pubkey");
      requireString(p.loser_pubkey, "loser_pubkey");
      requireString(p.arbitration_report_hash, "arbitration_report_hash");

      // 验证 winner 和 loser 必须是 client 或 worker 之一
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


/**
 * 创建任务事件
 *
 * 根据给定的参数创建一个符合 Nostr 格式的任务事件。
 * 会自动验证 payload 的合法性，并将 payload 序列化为 JSON 字符串存入 content 字段。
 *
 * @param args.kind - 事件类型
 * @param args.pubkey - 发布者公钥
 * @param args.created_at - 创建时间戳（可选，默认为当前时间）
 * @param args.payload - 事件 payload
 * @param args.extraTags - 额外的标签（可选）
 * @returns 未签名的任务事件
 * @throws {Error} 如果 payload 验证失败
 *
 * @example
 * const event = createTaskEvent({
 *   kind: TASK_KINDS.ANNOUNCEMENT,
 *   pubkey: "abc123...",
 *   payload: {
 *     task_id: "task_001",
 *     task_name: "Example Task",
 *     // ... other fields
 *   }
 * });
 */
export function createTaskEvent<K extends TaskKind>(args: {
  kind: K;
  pubkey: string;
  created_at?: number;
  payload: TaskPayloadByKind[K];
  extraTags?: NostrTag[];
}): NostrTaskEvent<K> {
  // 先做字段校验，避免把脏数据广播出去
  requireString(args.pubkey, "pubkey");
  validatePayloadByKind(args.kind, args.payload);

  // 统一把 payload 放入 content，方便中继和索引端解析
  const content = JSON.stringify(args.payload);
  const taskId = (args.payload as { task_id: string }).task_id;

  // 基础标签：task_id 和协议标识
  const baseTags: NostrTag[] = [
    ["task_id", taskId],
    ["protocol", atep_PROTOCOL_TAG, atep_PROTOCOL_VERSION],
  ];

  return {
    kind: args.kind,
    pubkey: args.pubkey,
    created_at: args.created_at ?? Math.floor(Date.now() / 1000),
    tags: args.extraTags ? [...baseTags, ...args.extraTags] : baseTags,
    content,
  };
}

/**
 * 从事件的 JSON content 中解析 payload
 *
 * 常用于：订阅到事件后，在业务层做状态流转前先验证数据。
 *
 * @param event - 任务事件
 * @returns 解析并验证后的 payload
 * @throws {Error} 如果 content 不是有效的 JSON 或 payload 验证失败
 *
 * @example
 * const payload = parseTaskEventPayload(event);
 * // 处理解析后的 payload
 * console.log(`Task ID: ${payload.task_id}`);
 */
export function parseTaskEventPayload<K extends TaskKind>(event: NostrTaskEvent<K>): TaskPayloadByKind[K] {
  let payload: unknown;
  try {
    payload = JSON.parse(event.content);
  } catch (_error) {
    throw new Error("invalid event content: must be JSON payload");
  }
  validatePayloadByKind(event.kind, payload as TaskPayloadByKind[K]);
  return payload as TaskPayloadByKind[K];
}
