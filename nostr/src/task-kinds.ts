/**
 * atep Nostr 事件 Kind 定义
 *
 * 这些事件类型用于 atep (Autonomous Task Exchange Protocol) 协议，
 * 表示任务生命周期在 Nostr 网络上的不同阶段。
 *
 * Kind 范围: 36001-36013 (为 atep 协议保留)
 *
 * ⚠️ 注意：这些 Kind 编号尚未在 Nostr NIP 中正式注册。
 * 在正式申请前，我们使用标签来标识 atep 协议事件，避免与其他项目冲突。
 *
 * @see https://github.com/nostr-protocol/nips Nostr 协议规范
 */
export const TASK_KINDS = {
  /** 任务公告事件（包含托管详情，由任务发布方发布） */
  ANNOUNCEMENT: 36001,

  /** 竞标提交事件（由潜在任务执行方发布） */
  BID: 36002,

  /** 选择并锁定确认事件（由任务发布方发布） */
  SELECTION_LOCK: 36003,

  /** 任务完成证明事件（由任务执行方发布） */
  PROOF_OF_TASK: 36004,

  /** 任务验收事件（接受或拒绝，由任务发布方发布） */
  FINALIZATION: 36005,

  /** 争议发起事件（当双方产生分歧时，由任一方发布） */
  DISPUTE_INITIATION: 36006,

  /** 取消与退款事件（由任务发布方发布） */
  CANCELLATION_REFUND: 36007,

  /** 乙方主动退款事件（由乙方发布，主动放弃任务） */
  WORKER_REFUND: 36008,

  /** 验收超时自动完成事件（由乙方发布，甲方未按时验收） */
  REVIEW_TIMEOUT_COMPLETION: 36009,

  /** 官方仲裁员白名单公告（由管理员发布） */
  VERIFIER_WHITELIST: 36010,

  /** 仲裁结果公告（由指定仲裁员发布） */
  ARBITRATION_RESULT: 36011,

  /** 仲裁超时认领事件（甲方在仲裁员超时后认领资金） */
  ARBITRATION_TIMEOUT_CLAIM: 36012,

  /** 竞标超时过期事件（招标期超时，任务自动过期） */
  EXPIRATION: 36013,
} as const;

/**
 * atep 协议标识
 *
 * 用于在 Nostr 事件的 tags 中标识这是 atep 协议的事件。
 * 格式：["protocol", "atep", "version"]
 */
export const atep_PROTOCOL_TAG = "atep";
export const atep_PROTOCOL_VERSION = "0.1.0";

/**
 * 有权发布/更新官方仲裁员白名单的管理员公钥列表
 *
 * 这些密钥拥有管理 VERIFIER_WHITELIST 事件的特殊权限。
 * 生产环境中，请将这些占位符替换为实际的公钥。
 *
 * @example
 * export const ADMIN_PUBKEYS = [
 *   "npub1...", // 主管理员密钥
 *   "npub2...", // 备用管理员密钥
 * ];
 */
export const ADMIN_PUBKEYS: readonly string[] = [
  "official_admin_pubkey_1", // 需要替换为实际的管理员公钥
  "official_admin_pubkey_2", // 需要替换为备用管理员公钥
];

/** 所有有效的 atep 任务事件 Kind 类型别名 */
export type TaskKind = (typeof TASK_KINDS)[keyof typeof TASK_KINDS];

/**
 * 任务在链下协议状态机中的状态
 *
 * 这些状态用于本地/服务端验证事件的合法性
 * 不直接替代链上状态
 *
 * 状态转换流程:
 * - BIDDING → LOCKED (选择执行方后)
 * - LOCKED → DELIVERED (提交完成证明后)
 * - DELIVERED → SUCCESS | REJECTED (验收后)
 * - DELIVERED → DISPUTED (发起争议时)
 * - 任意状态 → CANCELLED (取消时)
 *
 * @property BIDDING - 任务开放竞标中
 * @property LOCKED - 执行方已选定，任务进行中
 * @property DELIVERED - 已提交完成证明
 * @property SUCCESS - 任务成功完成
 * @property REJECTED - 任务被发布方拒绝
 * @property DISPUTED - 已发起争议，等待仲裁
 * @property CANCELLED - 任务已取消，退款中
 */
export type TaskStatus =
  | "BIDDING"
  | "LOCKED"
  | "DELIVERED"
  | "SUCCESS"
  | "REJECTED"
  | "DISPUTED"
  | "CANCELLED";

/**
 * TASK_KINDS.ANNOUNCEMENT 事件的 Payload 结构
 *
 * 由任务发布方发布，用于公告新任务及托管详情
 */
export interface TaskAnnouncementPayload {
  /** 全局唯一任务标识符 */
  task_id: string;

  /** 任务标题（明文） */
  task_name: string;

  /**
   * 任务规格文档的哈希值
   *
   * 推荐：存储加密任务包的哈希（如 SHA-256）
   * 实际任务内容应通过私密渠道传输
   */
  payload_hash: string;

  /**
   * 验收标准文档的哈希值
   *
   * 用于明确任务完成标准和验收要求
   * 推荐存储验收标准文档的哈希（如 SHA-256）
   * 验收标准应与任务规格配套提供
   */
  acceptance_hash: string;

  /**
   * 竞标窗口时长（单位：秒）
   * 例如：21600 表示 6 小时，43200 表示 12 小时
   * 最大值：86400（24 小时）
   */
  bid_closing_seconds: number;

  /**
   * 预期任务完成时长（单位：秒）
   * 从任务锁定开始计算
   * 例如：86400 表示 1 天，604800 表示 7 天
   */
  expected_ttl_seconds: number;

  /** 指定的仲裁员公钥列表（当前限制为 1 个） */
  verifier: string[];

  /** 仲裁员的 Sui 地址（用于链上仲裁放款） */
  arbitrator_sui_address?: string;

  // === 以下字段在用户转账后填写 ===

  /** 奖励金额（字符串格式，避免不同资产的精度问题） */
  amount: string;

  /** Settlement asset type (当前只支持 "SUI") */
  asset: string;

  /** 链上交易哈希，证明资金已存入 */
  tx_hash: string;

  /** Sui 链上任务对象 ID */
  sui_object_id: string;
}

/**
 * TASK_KINDS.BID 事件的 Payload 结构
 *
 * 由潜在任务执行方发布，用于提交竞标
 */
export interface TaskBidPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** 乙方 Sui 地址，用于锁定任务和后续资金操作 */
  worker_sui_address: string;

  /** 可选：能力证明（如历史评分、简历哈希等） */
  capability_proof?: string;
}

/**
 * TASK_KINDS.SELECTION_LOCK 事件的 Payload 结构
 *
 * 由任务发布方发布，用于确认执行方选择并锁定任务
 */
export interface SelectionLockPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** 被选中执行方的公钥 */
  selected_pubkey: string;

  /** 证明任务-执行方关系的签名 */
  lock_sig: string;

  /**
   * 官方开始时间戳（单位：秒）
   * Unix 时间戳，用于 TTL 计算
   */
  start_time_seconds: number;

  /** Sui 链上任务对象 ID */
  sui_object_id: string;

  /** 链上锁定交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

/**
 * TASK_KINDS.PROOF_OF_TASK 事件的 Payload 结构
 *
 * 由任务执行方发布，用于提交完成证明
 */
export interface ProofOfTaskPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** 交付内容哈希（与链上存储的哈希相同） */
  delivery_hash: string;

  /** 交付提交时间戳（单位：秒） */
  timestamp_seconds: number;

  /** 链上交付交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

/**
 * TASK_KINDS.FINALIZATION 事件的 Payload 结构
 *
 * 由任务发布方发布，用于接受或拒绝已完成的工作
 */
export interface TaskFinalizationPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** 验收结果：success 表示接受，rejected 表示拒绝 */
  status: "success" | "rejected";

  /** Sui 链上任务对象 ID */
  sui_object_id: string;

  /** 链上验收交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

/**
 * TASK_KINDS.DISPUTE_INITIATION 事件的 Payload 结构
 *
 * 由任一方发布，当产生争议时使用。
 * 包含任务基本信息和争议证据，便于仲裁员快速了解上下文。
 */
export interface DisputeInitiationPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** 任务名称（从 ANNOUNCEMENT 事件复制） */
  task_name: string;

  /** 任务规格哈希（从 ANNOUNCEMENT 事件复制） */
  payload_hash: string;

  /** 乙方提交的交付物哈希（从 PROOF_OF_TASK 事件复制，如果已提交） */
  delivery_hash?: string;

  /** 用于仲裁的仲裁员公钥列表（当前限制为 1 个） */
  verifier: string[];

  /**
   * 争议证据哈希列表
   *
   * 可包含：
   * - 原始任务要求的证据
   * - 交付物不符合要求的证据
   * - 沟通记录的哈希
   * - 其他补充材料的哈希
   */
  evidence_list: string[];

  /** 争议原因简述（可选，便于仲裁员快速了解） */
  dispute_reason?: string;

  /** 链上发起仲裁交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

/**
 * TASK_KINDS.CANCELLATION_REFUND 事件的 Payload 结构
 *
 * 由任务发布方发布，用于取消任务并发起退款
 */
export interface CancellationRefundPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** 取消原因（预定义或自定义字符串） */
  reason: "bid_expired" | "selection_expired" | "ttl_expired" | string;

  /** Sui 链上任务对象 ID */
  sui_object_id: string;

  /** 链上取消交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

/**
 * TASK_KINDS.WORKER_REFUND 事件的 Payload 结构
 *
 * 乙方主动放弃任务时使用
 */
export interface WorkerRefundPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** Sui 链上任务对象 ID */
  sui_object_id: string;

  /** 主动放弃原因 */
  reason: string;

  /** 链上退款交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

/**
 * TASK_KINDS.REVIEW_TIMEOUT_COMPLETION 事件的 Payload 结构
 *
 * 甲方未按时验收，乙方自动收款时使用
 */
export interface ReviewTimeoutCompletionPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** Sui 链上任务对象 ID */
  sui_object_id: string;

  /** 超时完成时间戳（单位：秒） */
  completed_at_seconds: number;

  /** 链上自动完成交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

export interface VerifierInfo {
  pubkey: string;
  sui_address: string;    // 仲裁员的 Sui 地址
  effective_from: number; // 生效时间戳
  expires_at: number;     // 过期时间戳
}

/**
 * TASK_KINDS.VERIFIER_WHITELIST 事件的 Payload 结构
 *
 * 由系统发布，用于更新仲裁员白名单
 */
export interface VerifierWhitelistPayload {
  /** 当前有效的仲裁员公钥列表 */
  verifiers: VerifierInfo[];
  /** 记录此次更新的时间 */
  updated_at: number;
}

/**
 * TASK_KINDS.ARBITRATION_RESULT 事件的 Payload 结构
 *
 * 由仲裁员发布，用于公布仲裁结果
 */
export interface ArbitrationResultPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** 甲方 Nostr 公钥 */
  client_pubkey: string;

  /** 乙方 Nostr 公钥 */
  worker_pubkey: string;

  /** 胜方 Nostr 公钥（甲方或乙方） */
  winner_pubkey: string;

  /** 败方 Nostr 公钥（甲方或乙方） */
  loser_pubkey: string;

  /** 仲裁报告哈希（与链上存储的哈希相同） */
  arbitration_report_hash: string;

  /** 仲裁员总结（可选，人类可读） */
  verdict_summary?: string;

  /** Sui 链上任务对象 ID */
  sui_object_id: string;

  /** 链上裁决交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

/**
 * TASK_KINDS.ARBITRATION_TIMEOUT_CLAIM 事件的 Payload 结构（kind: 36012）
 *
 * 由任务发布方（甲方）发布，用于在仲裁员超时（24小时）未裁决时认领资金。
 * 
 * **触发条件：**
 * - 任务处于仲裁中（is_in_arbitration = true）
 * - 仲裁启动后超过 24 小时（ARBITRATION_PERIOD_MS）未裁决
 * - 任务未完成（is_completed = false）
 *
 * **资金分配：**
 * - 协议捐赠：5%（给 config.donation_recipient）
 * - 退回甲方：95%
 *
 * **Payload 字段说明：**
 * - `task_id`: 任务唯一标识符
 * - `sui_object_id`: Sui 链上任务对象 ID
 * - `client_pubkey`: 甲方（任务发布方）Nostr 公钥
 * - `worker_pubkey`: 乙方（任务执行方）Nostr 公钥
 * - `verifier_pubkey`: 指定仲裁员 Nostr 公钥（从任务创建时的 ANNOUNCEMENT 事件获取）
 * - `tx_hash`: 链上认领交易哈希（可选，用于去中心化验证）
 */
export interface ArbitrationTimeoutClaimPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** Sui 链上任务对象 ID */
  sui_object_id: string;

  /** 任务发布方（甲方）公钥 */
  client_pubkey: string;

  /** 任务执行方（乙方）公钥 */
  worker_pubkey: string;

  /** 指定仲裁员公钥（超时未裁决的仲裁员） */
  verifier_pubkey: string;

  /** 完成类型（参考合约 COMPLETION_TYPE 常量）
   * - 3 = COMPLETION_TYPE_ARBITRATION（仲裁完成）
   */
  completion_type: number;

  /** 完成原因说明
   * - "arbitration_timeout": 仲裁超时（仲裁员未在24小时内裁决）
   */
  completion_reason?: string;

  /** 链上认领交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

/**
 * TASK_KINDS.EXPIRATION 事件的 Payload 结构
 *
 * 招标期超时过期时使用
 */
export interface ExpirationPayload {
  /** 关联的任务标识符 */
  task_id: string;

  /** Sui 链上任务对象 ID */
  sui_object_id: string;

  /** 过期时间戳（单位：秒） */
  expired_at_seconds: number;

  /** 链上过期交易哈希（可选，用于去中心化验证） */
  tx_hash?: string;
}

/**
 * 不同 Kind 对应不同 payload 结构。
 * 这样 TypeScript 能在编译期检查字段是否写对。
 */
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
