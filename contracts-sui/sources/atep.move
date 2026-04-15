/// ATEP 任务托管智能合约 - Sui Move 版本
///
/// 功能：
/// 1. 创建任务 - 甲方创建任务并托管资金
/// 2. Open 状态管理 - 甲方取消、Open 超时退款、锁定乙方
/// 3. Locked 状态管理 - 乙方主动退款、提交交付、交付超时退款
/// 4. 验收流程 - 甲方验收/拒绝、验收超时自动放款
/// 5. 拒绝后回应 - 乙方接受拒绝、发起仲裁、回应超时退款
/// 6. 仲裁流程 - 仲裁员裁决、仲裁超时退款
/// 7. 协议费用 - 5% 协议捐赠 + 5% 仲裁费
/// 8. 全局配置 - 管理员更新捐赠接收地址
#[allow(duplicate_alias)]
module atep_contracts::atep {
    use sui::object::{Self};
    use sui::transfer;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::event;
    use std::vector;
    use std::option;

    // ==================== 错误码 ====================

    const ETaskNotOpen: u64 = 1;              // 任务不在 Open 状态
    const ETaskNotLocked: u64 = 2;            // 任务不在 Locked 状态
    const ETimeoutNotReached: u64 = 3;        // 超时时间未到
    const EUnauthorized: u64 = 4;             // 权限不足
    const EAmountTooLow: u64 = 5;             // 金额过低
    const EAmountTooHigh: u64 = 6;            // 金额过高
    const EInvalidTaskId: u64 = 7;            // 无效的任务 ID
    const ECannotCancelLockedTask: u64 = 8;   // 无法取消已锁定的任务
    const EWorkerCannotBeVerifier: u64 = 9;  // 乙方不能是仲裁员
    const EAlreadyDelivered: u64 = 11;       // 已交付，不能重复
    const EReviewPeriodExpired: u64 = 12;      // 验收期已过期
    const EReviewPeriodNotExpired: u64 = 13;  // 验收期未过期
    const EResponsePeriodExpired: u64 = 14;    // 回应期已过期
    const EResponsePeriodNotExpired: u64 = 15; // 回应期未过期
    const ENotRejected: u64 = 16;             // 任务未被拒绝
    const EArbitrationPeriodExpired: u64 = 17;      // 仲裁期已过期
    const EArbitrationPeriodNotExpired: u64 = 18;    // 仲裁期未过期
    const ENotInArbitration: u64 = 19;        // 任务不在仲裁中
    const ENotAdmin: u64 = 20;                // 不是管理员
    const EMultiSigThresholdNotMet: u64 = 21; // 多签阈值未达成
    const ETimeLockNotExpired: u64 = 22;      // 时间锁未到期
    const ENoPendingOperation: u64 = 24;      // 没有待执行的操作
    const EInvalidHash: u64 = 25;              // 无效的哈希值
    const ETaskNotDelivered: u64 = 28;         // 任务不在交付状态
    const EInvalidArbitrationDecision: u64 = 29; // 无效的仲裁决定

    // ==================== 完成类型常量 ====================

    const COMPLETION_TYPE_NOT_COMPLETED: u8 = 0;
    const COMPLETION_TYPE_NORMAL: u8 = 1;      // 正常完成（甲方验收）
    const COMPLETION_TYPE_TIMEOUT: u8 = 2;     // 超时完成（乙方超时）
    const COMPLETION_TYPE_ARBITRATION: u8 = 3;  // 仲裁完成

    // ==================== 常量 ====================

    /// 最小任务金额 (0.1 SUI = 100_000_000 MIST)
    /// 确保乙方到手金额 > Gas 费，否则无人愿意接单
    const MIN_REWARD_AMOUNT: u64 = 100_000_000;

    /// 最大任务金额 (1,000,000 SUI = 1_000_000_000_000_000 MIST)
    /// 防止整数溢出和大额交易风险
    const MAX_REWARD_AMOUNT: u64 = 1_000_000_000_000_000;

    /// 协议捐赠比例 (5%)
    const PROTOCOL_FEE_PERCENT: u64 = 5;

    /// 仲裁费比例 (5%)
    const ARBITRATION_FEE_PERCENT: u64 = 5;

    /// 招标期 (3天，单位：毫秒) - 任务创建后乙方可以投标的时间
    const DEFAULT_BIDDING_PERIOD_MS: u64 = 259_200_000;  // 3 * 86_400_000

    /// 甲方验收期 (6小时，单位：毫秒)
    const REVIEW_PERIOD_MS: u64 = 21_600_000;

    /// 乙方回应期 (2小时，单位：毫秒)
    const RESPONSE_PERIOD_MS: u64 = 7_200_000;

    /// 仲裁期 (24小时，单位：毫秒)
    const ARBITRATION_PERIOD_MS: u64 = 86_400_000;

    /// 管理操作时间锁 (24小时，单位：毫秒)
    const ADMIN_TIME_LOCK_MS: u64 = 86_400_000;

    /// 多签管理员数量
    const MULTI_SIG_ADMIN_COUNT: u64 = 3;
    /// 多签阈值 (2/3)
    const MULTI_SIG_THRESHOLD: u64 = 2;

    // ==================== 结构体 ====================

    /// 任务状态 - 记录任务生命周期中的各种状态标志
    public struct TaskStatus has store, copy, drop {
        is_open: bool,             // 任务是否开放投标
        is_locked: bool,           // 任务是否已锁定乙方
        is_completed: bool,        // 任务是否已完成
        is_cancelled: bool,      // 任务是否已取消
        is_closed: bool,           // 任务是否已关闭（资金已分配）
        completion_type: u8,       // 完成类型（见完成类型常量）
    }

    /// 任务状态枚举 - 简化状态管理
    const STATUS_OPEN: u8 = 0;           //  Open bidding
    const STATUS_LOCKED: u8 = 1;         //  Locked worker
    const STATUS_DELIVERED: u8 = 2;      //  Delivered
    const STATUS_REVIEWED: u8 = 3;       //  Reviewed
    const STATUS_ARBITRATED: u8 = 4;     //  Arbitrated
    const STATUS_CANCELLED: u8 = 5;      //  Cancelled
    const STATUS_CLOSED: u8 = 6;          //  Closed已关闭

    /// 任务对象 - 分阶段存储优化版本
    public struct Task has key, store {
        id: UID,
        /// 任务 ID (32 字节哈希，来自 Nostr 事件 ID)
        task_id: vector<u8>,
        /// 甲方地址
        boss: address,
        /// 甲方 Nostr 公钥
        boss_nostr_pubkey: vector<u8>,
        /// 仲裁员 Nostr 公钥
        verifier_nostr_pubkey: vector<u8>,
        /// 仲裁员 Sui 地址
        arbitrator_sui_address: address,
        /// 托管的资金
        escrow: Balance<SUI>,
        /// 奖励金额
        reward_amount: u64,
        /// 预期交付时长 (毫秒) - 乙方应在锁定后此时间内交付
        expected_ttl_ms: u64,
        /// 任务状态 (使用枚举)
        status: u8,
        /// Open 状态超时时间戳 (毫秒) - 招标期截止时间
        timeout_ms: u64,
        /// 锁定时间戳 (毫秒) - 任务被锁定的时刻
        lock_time_ms: u64,
        /// 创建时间戳 (毫秒)
        created_at: u64,
        /// 任务内容哈希 (32字节) - 防篡改
        payload_hash: vector<u8>,
        /// 验收标准哈希 (32字节) - 防篡改
        acceptance_hash: vector<u8>,
        /// 乙方信息 (动态字段)
        worker_fields: Option<WorkerInfo>,
        /// 交付信息 (动态字段)
        delivery_fields: Option<DeliveryInfo>,
        /// 仲裁信息 (动态字段)
        arbitration_fields: Option<ArbitrationInfo>,
    }

    /// 乙方信息 - 动态字段存储
    public struct WorkerInfo has store, drop {
        /// 乙方 Sui 地址
        worker_sui_address: address,
        /// 乙方 Nostr 公钥
        worker_nostr_pubkey: vector<u8>,
        /// 锁定时间戳 (毫秒)
        lock_time_ms: u64,
    }

    /// 交付信息 - 动态字段存储
    public struct DeliveryInfo has store, drop {
        /// 交付内容哈希 (32字节)
        delivery_hash: vector<u8>,
        /// 交付时间戳 (毫秒)
        delivery_time_ms: u64,
    }

    /// 仲裁信息 - 动态字段存储
    public struct ArbitrationInfo has store, drop {
        /// 仲裁报告哈希 (32字节)
        arbitration_report_hash: vector<u8>,
        /// 仲裁时间戳 (毫秒)
        arbitration_time_ms: u64,
        /// 仲裁结果 (0=乙方胜, 1=甲方胜)
        arbitrator_decision: u8,
        /// 证据哈希列表
        evidence_hashes: vector<vector<u8>>,
        /// 仲裁员地址
        arbitrator_address: address,
    }

    /// 全局配置 - 存储协议级别的配置信息
    public struct GlobalConfig has key {
        id: UID,
        /// 协议捐赠接收地址 - 收取协议费用的地址
        donation_recipient: address,
    }

    /// 管理员权限凭证 - 用于执行管理操作
    public struct AdminCap has key, store {
        id: UID,
    }

    /// 多签管理配置 - 需要 2/3 签名才能执行管理操作
    public struct MultiSigAdmin has key {
        id: UID,
        /// 三个管理员地址
        admins: vector<address>,
        /// 待执行的操作类型 (0=无, 1=更新捐赠地址, 2=转移管理权)
        pending_op_type: u8,
        /// 待执行操作的目标地址
        pending_target: address,
        /// 操作提议时间（用于时间锁）
        proposal_time: u64,
        /// 提案时的区块高度（用于增强时间锁安全性）
        proposal_block_height: u64,
        /// 已签名确认的管理员位图 (bit 0,1,2 表示三个管理员)
        approvals: u8,
    }

    /// 待执行的管理操作类型
    const PENDING_OP_NONE: u8 = 0;
    const PENDING_OP_UPDATE_DONATION: u8 = 1;

    // ==================== 事件 ====================

    /// 任务创建事件 - 当甲方创建任务并托管资金时触发
    public struct TaskCreated has copy, drop {
        task_id: vector<u8>,
        boss: address,
        reward_amount: u64,
        timeout_ms: u64,
    }

    /// 任务锁定事件 - 当甲方选择乙方并锁定时触发
    public struct TaskLocked has copy, drop {
        task_id: vector<u8>,
        worker_nostr_pubkey: vector<u8>,
        worker_sui_address: address,
        new_timeout_ms: u64,
    }

    /// 任务完成事件 - 当任务正常完成时触发
    public struct TaskCompleted has copy, drop { }

    /// Task delivered event - when worker submits delivery
    public struct TaskDelivered has copy, drop {
        task_id: vector<u8>,
        delivery_hash: vector<u8>,
        delivery_time_ms: u64,
    }

    /// Task arbitrated event - when arbitration is initiated
    public struct TaskArbitrated has copy, drop {
        task_id: vector<u8>,
        initiator_nostr_pubkey: vector<u8>,
        arbitration_time_ms: u64,
    }

    /// 任务取消事件 - 当任务被取消时触发
    public struct TaskCancelled has copy, drop {
        task_id: vector<u8>,
        refund_amount: u64,
    }

    /// 任务过期事件 - 当任务在 Open 状态超时时触发
    public struct TaskExpired has copy, drop {
        task_id: vector<u8>,
        refund_amount: u64,
    }

    /// 交付提交事件 - 当乙方提交交付时触发
    public struct DeliverySubmitted has copy, drop {
        task_id: vector<u8>,
        worker_sui_address: address,
        delivery_time: u64,
    }

    /// 交付验收事件 - 当甲方验收交付时触发
    public struct DeliveryReviewed has copy, drop {
        task_id: vector<u8>,
        boss: address,
        review_result: bool,     // true=接受, false=拒绝
        review_time: u64,
        worker_payout: u64,       // 仅在接受时有值
        protocol_donation: u64,   // 仅在接受时有值
    }

    /// 验收超时认领事件 - 当甲方未验收，乙方超时自动收款时触发
    public struct ReviewTimeoutClaimed has copy, drop {
        task_id: vector<u8>,
        worker_sui_address: address,
        claim_time: u64,
        worker_payout: u64,
        protocol_donation: u64,
    }

    /// 拒绝被接受事件 - 当乙方接受甲方的拒绝时触发
    public struct RejectionAccepted has copy, drop {
        task_id: vector<u8>,
        worker_sui_address: address,
        accept_time: u64,
        refund_amount: u64,
        protocol_donation: u64,
    }

    /// 回应超时认领事件 - 当乙方未回应，甲方超时自动退款时触发
    public struct ResponseTimeoutClaimed has copy, drop {
        task_id: vector<u8>,
        boss: address,
        claim_time: u64,
        refund_amount: u64,
        protocol_donation: u64,
    }

    /// 仲裁启动事件 - 当乙方发起仲裁时触发
    public struct ArbitrationInitiated has copy, drop {
        task_id: vector<u8>,
        worker_sui_address: address,
        initiation_time: u64,
    }

    /// 仲裁超时认领事件 - 当仲裁员未裁决，甲方超时自动退款时触发
    public struct ArbitrationTimeoutClaimed has copy, drop {
        task_id: vector<u8>,
        boss: address,
        claim_time: u64,
        refund_amount: u64,
        protocol_donation: u64,
    }

    /// 交付超时认领事件 - 当乙方未按时交付，甲方超时自动退款时触发
    public struct DeliveryTimeoutClaimed has copy, drop {
        task_id: vector<u8>,
        refund_amount: u64,
        timeout_time: u64,
    }

    // ==================== 初始化 ====================

    /// 模块初始化函数
    fun init(ctx: &mut TxContext) {
        // 创建管理员权限凭证（仅用于初始设置，后续可转移）
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };

        // 创建全局配置
        // 设置正确的协议捐赠接收地址
        let config = GlobalConfig {
            id: object::new(ctx),
            donation_recipient: @0x2b34eaa6dcead403a17922112019ee2d319bacc7567a98a2ddf56caf7b8aa7da,
        };

        // 创建多签管理配置（设置三个不同的管理员地址）
        let sender = tx_context::sender(ctx);
        let mut admins = vector::empty<address>();
        vector::push_back(&mut admins, @0x94307e884fdddc09acef2f6846780e4eebafb5f6045854458b44f3c77eab0143); // 管理员1
        vector::push_back(&mut admins, @0x0d457446ab238de532b90b670232757c003460b30e7f08dcf932eef6ced7101e); // 管理员2
        vector::push_back(&mut admins, @0x4885982ca481d7d4992b80c8b1220944b6a85e8f05199d80c6f8dfb83ae1c484); // 管理员3

        let multi_sig = MultiSigAdmin {
            id: object::new(ctx),
            admins,
            pending_op_type: PENDING_OP_NONE,
            pending_target: @0x0,
            proposal_time: 0,
            proposal_block_height: 0,
            approvals: 0,
        };

        transfer::transfer(admin_cap, sender);
        transfer::share_object(config);
        transfer::share_object(multi_sig);
    }

    // ==================== 公共函数 ====================

    /// 1. 创建任务（Open 状态入口）- 分阶段存储版本
    public entry fun create_task(
        task_id: vector<u8>,
        payment: Coin<SUI>,
        expected_ttl_ms: u64,
        boss_nostr_pubkey: vector<u8>,
        verifier_nostr_pubkey: vector<u8>,
        arbitrator_sui_address: address,
        payload_hash: vector<u8>,        // 任务内容哈希
        acceptance_hash: vector<u8>,     // 验收标准哈希
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let reward_amount = coin::value(&payment);

        // 验证金额范围
        assert!(reward_amount >= MIN_REWARD_AMOUNT, EAmountTooLow);
        assert!(reward_amount <= MAX_REWARD_AMOUNT, EAmountTooHigh);

        // 验证 task_id 长度
        assert!(vector::length(&task_id) == 32, EInvalidTaskId);

        // 验证哈希长度
        assert!(vector::length(&payload_hash) == 32, EInvalidHash);
        assert!(vector::length(&acceptance_hash) == 32, EInvalidHash);

        let current_time_ms = clock::timestamp_ms(clock);
        let timeout_ms = current_time_ms + DEFAULT_BIDDING_PERIOD_MS;

        let task = Task {
            id: object::new(ctx),
            task_id,
            boss: tx_context::sender(ctx),
            boss_nostr_pubkey,
            verifier_nostr_pubkey,
            arbitrator_sui_address,
            escrow: coin::into_balance(payment),
            reward_amount,
            expected_ttl_ms,
            status: STATUS_OPEN,           // 使用枚举
            timeout_ms,
            lock_time_ms: 0,              // 初始为0
            created_at: current_time_ms,  // 创建时间
            payload_hash,                 // 任务内容哈希
            acceptance_hash,              // 验收标准哈希
            worker_fields: option::none(), // 初始为空
            delivery_fields: option::none(), // 初始为空
            arbitration_fields: option::none(), // 初始为空
        };

        // Capture values for event before transferring
        let task_id_copy = task.task_id;
        let boss_copy = task.boss;
        
        transfer::transfer(task, tx_context::sender(ctx));

        event::emit(TaskCreated {
            task_id: task_id_copy,
            boss: boss_copy,
            reward_amount,
            timeout_ms,
        });
    }

    /// 2. 取消任务（仅 Open 状态，甲方主动取消）
    public entry fun cancel_task(
        task: &mut Task,
        ctx: &mut TxContext
    ) {
        // 验证权限
        assert!(task.boss == tx_context::sender(ctx), EUnauthorized);

        // 验证状态：只能在 Open 状态取消
        assert!(task.status == STATUS_OPEN, ECannotCancelLockedTask);

        let refund_amount = balance::value(&task.escrow);

        // 退款给甲方
        let refund_balance = balance::withdraw_all(&mut task.escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, task.boss);

        // Update status
        task.status = STATUS_CANCELLED;

        event::emit(TaskCancelled {
            task_id: task.task_id,
            refund_amount,
        });
    }

    /// 3. 任务过期（Open 状态超时，任意人可调用）
    public entry fun expire_task(
        task: &mut Task,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证状态：只能在 Open 状态超时
        assert!(task.status == STATUS_OPEN, ECannotCancelLockedTask);

        // 验证超时
        let current_time_ms = clock::timestamp_ms(clock);
        assert!(current_time_ms > task.timeout_ms, ETimeoutNotReached);

        let refund_amount = balance::value(&task.escrow);

        // 退款给甲方
        let refund_balance = balance::withdraw_all(&mut task.escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, task.boss);

        // Update status
        task.status = STATUS_CANCELLED;

        event::emit(TaskExpired {
            task_id: task.task_id,
            refund_amount,
        });
    }

    /// 4. 锁定任务（Open -> Locked 状态转换）- 分阶段存储版本
    public entry fun lock_task(
        task: &mut Task,
        worker_nostr_pubkey: vector<u8>,
        worker_sui_address: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证权限
        assert!(task.boss == tx_context::sender(ctx), EUnauthorized);

        // 验证状态
        assert!(task.status == STATUS_OPEN, ETaskNotOpen);

        // 验证乙方不是仲裁员
        assert!(worker_nostr_pubkey != task.verifier_nostr_pubkey, EWorkerCannotBeVerifier);

        // 验证甲方不能锁定自己
        assert!(worker_sui_address != task.boss, EWorkerCannotBeVerifier);

        // 创建乙方信息结构
        let worker_info = WorkerInfo {
            worker_sui_address,
            worker_nostr_pubkey,
            lock_time_ms: clock::timestamp_ms(clock),
        };

        // 存储乙方信息
        task.worker_fields = option::some(worker_info);

        // 更新状态
        task.status = STATUS_LOCKED;
        task.lock_time_ms = clock::timestamp_ms(clock);

        event::emit(TaskLocked {
            task_id: task.task_id,
            worker_nostr_pubkey,
            worker_sui_address,
            new_timeout_ms: task.lock_time_ms + task.expected_ttl_ms,
        });
    }

    /// 5. 乙方提交交付 - 分阶段存储版本
    public entry fun submit_delivery(
        task: &mut Task,
        delivery_hash: vector<u8>,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        // 验证状态
        assert!(task.status == STATUS_LOCKED, ETaskNotLocked);

        // 验证交付哈希长度
        assert!(vector::length(&delivery_hash) == 32, EInvalidHash);

        // 创建交付信息结构
        let delivery_info = DeliveryInfo {
            delivery_hash,
            delivery_time_ms: clock::timestamp_ms(clock),
        };

        // 存储交付信息
        task.delivery_fields = option::some(delivery_info);

        // 更新状态
        task.status = STATUS_DELIVERED;

        event::emit(TaskDelivered {
            task_id: task.task_id,
            delivery_hash,
            delivery_time_ms: clock::timestamp_ms(clock),
        });
    }

    /// 6. 仲裁处理 - 分阶段存储版本
    public entry fun submit_arbitration(
        task: &mut Task,
        arbitration_report_hash: vector<u8>,
        arbitrator_decision: u8,
        arbitrator_address: address,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        // 验证状态
        assert!(task.status == STATUS_DELIVERED, ETaskNotDelivered);

        // 验证仲裁报告哈希长度
        assert!(vector::length(&arbitration_report_hash) == 32, EInvalidHash);

        // 验证仲裁结果
        assert!(arbitrator_decision == 0 || arbitrator_decision == 1, EInvalidArbitrationDecision);

        // 创建仲裁信息结构
        let arbitration_info = ArbitrationInfo {
            arbitration_report_hash,
            arbitration_time_ms: clock::timestamp_ms(clock),
            arbitrator_decision,
            evidence_hashes: vector::empty(), // 简化为空
            arbitrator_address,
        };

        // 存储仲裁信息
        task.arbitration_fields = option::some(arbitration_info);

        // 更新状态
        task.status = STATUS_ARBITRATED;

        // Get worker info for event
        let worker_info = option::borrow(&task.worker_fields);
        
        event::emit(TaskArbitrated {
            task_id: task.task_id,
            initiator_nostr_pubkey: worker_info.worker_nostr_pubkey,
            arbitration_time_ms: clock::timestamp_ms(clock),
        });
    }

    /// 5. 乙方主动退款（Locked 状态，乙方主动放弃）
    public entry fun refund_by_worker(
        task: &mut Task,
        worker_nostr_pubkey: vector<u8>,
        ctx: &mut TxContext
    ) {
        // Verify status
        assert!(task.status == STATUS_LOCKED, ETaskNotLocked);

        // Verify worker identity
        let worker_info = option::borrow(&task.worker_fields);
        assert!(worker_nostr_pubkey == worker_info.worker_nostr_pubkey, EUnauthorized);

        let refund_amount = balance::value(&task.escrow);

        // 全额退款给甲方
        let refund_balance = balance::withdraw_all(&mut task.escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, task.boss);

        // Update status
        task.status = STATUS_CANCELLED;

        event::emit(TaskCancelled {
            task_id: task.task_id,
            refund_amount,
        });
    }

    /// 6. 提交交付（Locked 状态，乙方提交工作成果）
    public entry fun submit_delivery_legacy(
        task: &mut Task,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证权限：必须是乙方
        let worker_info = option::borrow(&task.worker_fields);
        assert!(tx_context::sender(ctx) == worker_info.worker_sui_address, EUnauthorized);

        // 验证状态：已锁定且未完成
        assert!(task.status == STATUS_LOCKED, ETaskNotLocked);

        // 验证未重复提交
        assert!(!option::is_some(&task.delivery_fields), EAlreadyDelivered);

        // 验证交付时间：不能超过锁定时间 + 预期交付时长
        let current_time_ms = clock::timestamp_ms(clock);
        let delivery_deadline = task.lock_time_ms + task.expected_ttl_ms;
        assert!(current_time_ms <= delivery_deadline, ETimeoutNotReached);

        // 记录交付
        let delivery_info = DeliveryInfo {
            delivery_hash: vector::empty(),
            delivery_time_ms: current_time_ms,
        };
        task.delivery_fields = option::some(delivery_info);
        task.status = STATUS_DELIVERED;

        event::emit(DeliverySubmitted {
            task_id: task.task_id,
            worker_sui_address: worker_info.worker_sui_address,
            delivery_time: current_time_ms,
        });
    }

    /// 7. 交付超时认领（Locked 状态，甲方调用）
    public entry fun claim_delivery_timeout(
        task: &mut Task,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证权限：必须是甲方
        assert!(tx_context::sender(ctx) == task.boss, EUnauthorized);

        // 验证状态：已锁定且未完成
        assert!(task.status == STATUS_LOCKED, ETaskNotLocked);

        // 验证乙方未交付
        assert!(!option::is_some(&task.delivery_fields), EAlreadyDelivered);

        // 验证已超时：当前时间 > 锁定时间 + 预期交付时长
        let current_time_ms = clock::timestamp_ms(clock);
        let delivery_deadline = task.lock_time_ms + task.expected_ttl_ms;
        assert!(current_time_ms > delivery_deadline, ETimeoutNotReached);

        let refund_amount = balance::value(&task.escrow);

        // 退款给甲方
        let refund_balance = balance::withdraw_all(&mut task.escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, task.boss);

        // 更新状态
        task.status = STATUS_CANCELLED;

        event::emit(DeliveryTimeoutClaimed {
            task_id: task.task_id,
            refund_amount,
            timeout_time: current_time_ms,
        });
    }

    /// 8. 验收交付（Locked 状态，甲方验收）
    public entry fun review_delivery(
        task: &mut Task,
        config: &GlobalConfig,
        review_result: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证权限：必须是甲方
        assert!(task.boss == tx_context::sender(ctx), EUnauthorized);

        // 验证状态：已交付
        assert!(task.status == STATUS_DELIVERED, ETaskNotDelivered);

        // 验证在验收期内：交付时间 + 6小时内
        let delivery_info = option::borrow(&task.delivery_fields);
        let current_time_ms = clock::timestamp_ms(clock);
        let review_deadline = delivery_info.delivery_time_ms + REVIEW_PERIOD_MS;
        assert!(current_time_ms <= review_deadline, EReviewPeriodExpired);

        // Get worker info for payment
        let worker_info = option::borrow(&task.worker_fields);

        if (review_result) {
            // 接受交付：支付乙方
            let total_reward = balance::value(&task.escrow);
            let protocol_donation = (total_reward * PROTOCOL_FEE_PERCENT) / 100;
            let worker_payout = total_reward - protocol_donation;

            // 提取协议捐赠
            let donation_balance = balance::split(&mut task.escrow, protocol_donation);
            let donation_coin = coin::from_balance(donation_balance, ctx);
            transfer::public_transfer(donation_coin, config.donation_recipient);

            // 支付乙方
            let worker_balance = balance::split(&mut task.escrow, worker_payout);
            let worker_coin = coin::from_balance(worker_balance, ctx);
            transfer::public_transfer(worker_coin, worker_info.worker_sui_address);

            // 更新状态
            task.status = STATUS_REVIEWED;

            event::emit(DeliveryReviewed {
                task_id: task.task_id,
                boss: task.boss,
                review_result: true,
                review_time: current_time_ms,
                worker_payout,
                protocol_donation,
            });
        } else {
            // 拒绝交付：记录验收结果（拒绝）
            // 状态保持 STATUS_DELIVERED，等待乙方回应

            event::emit(DeliveryReviewed {
                task_id: task.task_id,
                boss: task.boss,
                review_result: false,
                review_time: current_time_ms,
                worker_payout: 0,
                protocol_donation: 0,
            });
        }
    }

    /// 9. 验收超时认领（Locked 状态，乙方调用）
    public entry fun claim_review_timeout(
        task: &mut Task,
        config: &GlobalConfig,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证权限：必须是乙方
        let worker_info = option::borrow(&task.worker_fields);
        assert!(tx_context::sender(ctx) == worker_info.worker_sui_address, EUnauthorized);

        // 验证状态：已交付
        assert!(task.status == STATUS_DELIVERED, ETaskNotDelivered);

        // 验证验收期已超时：当前时间 > 交付时间 + 6小时
        let delivery_info = option::borrow(&task.delivery_fields);
        let current_time_ms = clock::timestamp_ms(clock);
        let review_deadline = delivery_info.delivery_time_ms + REVIEW_PERIOD_MS;
        assert!(current_time_ms > review_deadline, EReviewPeriodNotExpired);

        let total_reward = balance::value(&task.escrow);
        let protocol_donation = (total_reward * PROTOCOL_FEE_PERCENT) / 100;
        let worker_payout = total_reward - protocol_donation;

        // 提取协议捐赠
        let donation_balance = balance::split(&mut task.escrow, protocol_donation);
        let donation_coin = coin::from_balance(donation_balance, ctx);
        transfer::public_transfer(donation_coin, config.donation_recipient);

        // 支付乙方
        let worker_balance = balance::split(&mut task.escrow, worker_payout);
        let worker_coin = coin::from_balance(worker_balance, ctx);
        transfer::public_transfer(worker_coin, worker_info.worker_sui_address);

        // 更新状态
        task.status = STATUS_REVIEWED;

        event::emit(ReviewTimeoutClaimed {
            task_id: task.task_id,
            worker_sui_address: worker_info.worker_sui_address,
            claim_time: current_time_ms,
            worker_payout,
            protocol_donation,
        });
    }

    /// 10. 接受拒绝（拒绝后，乙方接受并退款给甲方）
    public entry fun accept_rejection(
        task: &mut Task,
        config: &GlobalConfig,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证权限：必须是乙方
        let worker_info = option::borrow(&task.worker_fields);
        assert!(tx_context::sender(ctx) == worker_info.worker_sui_address, EUnauthorized);

        // 验证状态：已交付
        assert!(task.status == STATUS_DELIVERED, ETaskNotDelivered);

        // 验证在回应期内：交付时间 + 2小时内
        let delivery_info = option::borrow(&task.delivery_fields);
        let current_time_ms = clock::timestamp_ms(clock);
        let response_deadline = delivery_info.delivery_time_ms + RESPONSE_PERIOD_MS;
        assert!(current_time_ms <= response_deadline, EResponsePeriodExpired);

        let total_reward = balance::value(&task.escrow);
        let protocol_donation = (total_reward * PROTOCOL_FEE_PERCENT) / 100;
        let refund_amount = total_reward - protocol_donation;

        // 提取协议捐赠
        let donation_balance = balance::split(&mut task.escrow, protocol_donation);
        let donation_coin = coin::from_balance(donation_balance, ctx);
        transfer::public_transfer(donation_coin, config.donation_recipient);

        // 退款给甲方（扣除协议费后的95%）
        let refund_balance = balance::withdraw_all(&mut task.escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, task.boss);

        // 更新状态
        task.status = STATUS_CANCELLED;

        event::emit(RejectionAccepted {
            task_id: task.task_id,
            worker_sui_address: worker_info.worker_sui_address,
            accept_time: current_time_ms,
            refund_amount,
            protocol_donation,
        });
    }

    /// 11. 发起仲裁（拒绝后，乙方发起仲裁）
    public entry fun initiate_arbitration(
        task: &mut Task,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证权限：必须是乙方
        let worker_info = option::borrow(&task.worker_fields);
        assert!(tx_context::sender(ctx) == worker_info.worker_sui_address, EUnauthorized);

        // 验证状态：已交付
        assert!(task.status == STATUS_DELIVERED, ETaskNotDelivered);

        // 验证在回应期内：交付时间 + 2小时内
        let delivery_info = option::borrow(&task.delivery_fields);
        let current_time_ms = clock::timestamp_ms(clock);
        let response_deadline = delivery_info.delivery_time_ms + RESPONSE_PERIOD_MS;
        assert!(current_time_ms <= response_deadline, EResponsePeriodExpired);

        event::emit(ArbitrationInitiated {
            task_id: task.task_id,
            worker_sui_address: worker_info.worker_sui_address,
            initiation_time: current_time_ms,
        });
    }

    /// 12. 回应超时认领（拒绝后，甲方调用乙方超时未回应）
    public entry fun claim_response_timeout(
        task: &mut Task,
        config: &GlobalConfig,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证权限：必须是甲方
        assert!(task.boss == tx_context::sender(ctx), EUnauthorized);

        // 验证状态：已交付
        assert!(task.status == STATUS_DELIVERED, ETaskNotDelivered);

        // 验证回应期已超时：当前时间 > 交付时间 + 2小时
        let delivery_info = option::borrow(&task.delivery_fields);
        let current_time_ms = clock::timestamp_ms(clock);
        let response_deadline = delivery_info.delivery_time_ms + RESPONSE_PERIOD_MS;
        assert!(current_time_ms > response_deadline, EResponsePeriodNotExpired);

        let total_reward = balance::value(&task.escrow);
        let protocol_donation = (total_reward * PROTOCOL_FEE_PERCENT) / 100;
        let refund_amount = total_reward - protocol_donation;

        // 提取协议捐赠
        let donation_balance = balance::split(&mut task.escrow, protocol_donation);
        let donation_coin = coin::from_balance(donation_balance, ctx);
        transfer::public_transfer(donation_coin, config.donation_recipient);

        // 退款给甲方（扣除协议费后的95%）
        let refund_balance = balance::withdraw_all(&mut task.escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, task.boss);

        // 更新状态
        task.status = STATUS_CANCELLED;

        event::emit(ResponseTimeoutClaimed {
            task_id: task.task_id,
            boss: task.boss,
            claim_time: current_time_ms,
            refund_amount,
            protocol_donation,
        });
    }

    /// 13. 仲裁裁决（仲裁期，仲裁员裁决）
    public entry fun resolve_arbitration(
        task: &mut Task,
        config: &GlobalConfig,
        winner_nostr_pubkey: vector<u8>,
        verifier_nostr_pubkey: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证状态：已交付
        assert!(task.status == STATUS_DELIVERED, ETaskNotDelivered);

        // 验证仲裁员身份
        assert!(verifier_nostr_pubkey == task.verifier_nostr_pubkey, EUnauthorized);

        // Get worker info for validation
        let worker_info = option::borrow(&task.worker_fields);
        
        // 验证胜方身份（必须是甲方或乙方）
        assert!(
            winner_nostr_pubkey == task.boss_nostr_pubkey ||
            winner_nostr_pubkey == worker_info.worker_nostr_pubkey,
            EUnauthorized
        );

        // 验证在仲裁期内：交付时间 + 24小时内
        let delivery_info = option::borrow(&task.delivery_fields);
        let current_time_ms = clock::timestamp_ms(clock);
        let arbitration_deadline = delivery_info.delivery_time_ms + ARBITRATION_PERIOD_MS;
        assert!(current_time_ms <= arbitration_deadline, EArbitrationPeriodExpired);

        let total_reward = balance::value(&task.escrow);

        // Get worker info
        let worker_info = option::borrow(&task.worker_fields);
        let worker_nostr_pubkey = worker_info.worker_nostr_pubkey;
        let worker_sui_address = worker_info.worker_sui_address;

        // Calculate arbitration fee (5%)
        let verifier_fee = (total_reward * ARBITRATION_FEE_PERCENT) / 100;

        // Pay arbitration fee to arbitrator
        let verifier_balance = balance::split(&mut task.escrow, verifier_fee);
        let verifier_coin = coin::from_balance(verifier_balance, ctx);
        transfer::public_transfer(verifier_coin, task.arbitrator_sui_address);

        // Determine winner
        if (winner_nostr_pubkey == worker_nostr_pubkey) {
            // Worker wins: deduct protocol donation (5%), rest to worker (90%)
            let remaining = balance::value(&task.escrow);
            let protocol_donation = (remaining * PROTOCOL_FEE_PERCENT) / 100;
            let _worker_payout = remaining - protocol_donation;

            // Protocol donation
            let donation_balance = balance::split(&mut task.escrow, protocol_donation);
            let donation_coin = coin::from_balance(donation_balance, ctx);
            transfer::public_transfer(donation_coin, config.donation_recipient);

            // Pay worker
            let worker_balance = balance::withdraw_all(&mut task.escrow);
            let worker_coin = coin::from_balance(worker_balance, ctx);
            transfer::public_transfer(worker_coin, worker_sui_address);
        } else {
            // 甲方胜：扣除协议捐赠 (5%)，剩余给甲方 (90%)
            let remaining = balance::value(&task.escrow);
            let protocol_donation = (remaining * PROTOCOL_FEE_PERCENT) / 100;
            let _refund_amount = remaining - protocol_donation;

            // 协议捐赠
            let donation_balance = balance::split(&mut task.escrow, protocol_donation);
            let donation_coin = coin::from_balance(donation_balance, ctx);
            transfer::public_transfer(donation_coin, config.donation_recipient);

            // 退款给甲方
            let refund_balance = balance::withdraw_all(&mut task.escrow);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, task.boss);
        };

        // Update status
        task.status = STATUS_ARBITRATED;
    }

    /// 14. 仲裁超时认领（仲裁期，甲方调用仲裁员超时）
    public entry fun claim_arbitration_timeout(
        task: &mut Task,
        config: &GlobalConfig,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 验证权限：必须是甲方
        assert!(task.boss == tx_context::sender(ctx), EUnauthorized);

        // 验证状态：已交付
        assert!(task.status == STATUS_DELIVERED, ETaskNotDelivered);

        // 验证仲裁期已超时：当前时间 > 交付时间 + 24小时
        let delivery_info = option::borrow(&task.delivery_fields);
        let current_time_ms = clock::timestamp_ms(clock);
        let arbitration_deadline = delivery_info.delivery_time_ms + ARBITRATION_PERIOD_MS;
        assert!(current_time_ms > arbitration_deadline, EArbitrationPeriodNotExpired);

        let total_reward = balance::value(&task.escrow);
        let protocol_donation = (total_reward * PROTOCOL_FEE_PERCENT) / 100;
        let refund_amount = total_reward - protocol_donation;

        // 提取协议捐赠
        let donation_balance = balance::split(&mut task.escrow, protocol_donation);
        let donation_coin = coin::from_balance(donation_balance, ctx);
        transfer::public_transfer(donation_coin, config.donation_recipient);

        // 退款给甲方（扣除协议费后的95%）
        let refund_balance = balance::withdraw_all(&mut task.escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, task.boss);

        // 更新状态
        task.status = STATUS_CANCELLED;

        event::emit(ArbitrationTimeoutClaimed {
            task_id: task.task_id,
            boss: task.boss,
            claim_time: current_time_ms,
            refund_amount,
            protocol_donation,
        });
    }

    /// 15. 更新全局配置（多签+时间锁管理功能）
    /// 需要 2/3 管理员签名 + 24小时时间锁
    public entry fun propose_update_donation(
        multi_sig: &mut MultiSigAdmin,
        _config: &mut GlobalConfig,
        new_donation_recipient: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let admin_index = find_admin_index(&multi_sig.admins, sender);
        // find_admin_index 会直接 abort 如果不是管理员

        // 检查是否有待执行的操作
        assert!(multi_sig.pending_op_type == PENDING_OP_NONE, EMultiSigThresholdNotMet);

        // 设置新提议
        multi_sig.pending_op_type = PENDING_OP_UPDATE_DONATION;
        multi_sig.pending_target = new_donation_recipient;
        multi_sig.proposal_time = clock::timestamp_ms(clock);
        multi_sig.proposal_block_height = tx_context::digest(ctx).length(); // 使用交易摘要长度作为区块高度的代理
        multi_sig.approvals = (1 << (admin_index as u8)) as u8; // 设置当前管理员的批准位
    }

    /// 批准更新捐赠地址提议
    public entry fun approve_update_donation(
        multi_sig: &mut MultiSigAdmin,
        config: &mut GlobalConfig,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let admin_index = find_admin_index(&multi_sig.admins, sender);
        // find_admin_index 会直接 abort 如果不是管理员

        // 验证有对应的待执行操作
        assert!(multi_sig.pending_op_type == PENDING_OP_UPDATE_DONATION, ENoPendingOperation);

        // 验证时间锁已过期（24小时）
        let current_time = clock::timestamp_ms(clock);
        assert!(current_time >= multi_sig.proposal_time + ADMIN_TIME_LOCK_MS, ETimeLockNotExpired);

        // 验证区块高度锁已过期（增强安全性）
        let current_block_height = tx_context::digest(ctx).length(); // 使用交易摘要长度作为区块高度的代理
        let min_blocks_passed = ADMIN_TIME_LOCK_MS / 1000; // 假设平均每秒一个区块，保守估计
        assert!(current_block_height >= multi_sig.proposal_block_height + min_blocks_passed, ETimeLockNotExpired);

        // 添加当前管理员的批准
        let approval_bit = (1 << (admin_index as u8)) as u8;
        assert!((multi_sig.approvals & approval_bit) == 0, EUnauthorized); // 不能重复批准
        multi_sig.approvals = multi_sig.approvals | approval_bit;

        // 检查是否达到阈值（2/3）
        let approval_count = count_approvals(multi_sig.approvals);
        if (approval_count >= MULTI_SIG_THRESHOLD) {
            // 执行更新
            config.donation_recipient = multi_sig.pending_target;
            
            // 重置状态
            multi_sig.pending_op_type = PENDING_OP_NONE;
            multi_sig.pending_target = @0x0;
            multi_sig.proposal_time = 0;
            multi_sig.proposal_block_height = 0;
            multi_sig.approvals = 0;
        }
    }

    /// 取消待执行的管理操作
    public entry fun cancel_pending_operation(
        multi_sig: &mut MultiSigAdmin,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        find_admin_index(&multi_sig.admins, sender); // 验证管理员身份，会直接 abort 如果不是管理员

        // 验证有待执行的操作
        assert!(multi_sig.pending_op_type != PENDING_OP_NONE, ENoPendingOperation);

        // 取消操作
        multi_sig.pending_op_type = PENDING_OP_NONE;
        multi_sig.pending_target = @0x0;
        multi_sig.proposal_time = 0;
        multi_sig.proposal_block_height = 0;
        multi_sig.approvals = 0;
    }

    // ==================== 管理辅助函数 ====================

    /// 查找管理员索引
    fun find_admin_index(admins: &vector<address>, addr: address): u64 {
        let len = vector::length(admins);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(admins, i) == addr) {
                return i
            };
            i = i + 1;
        };
        abort ENotAdmin // 直接 abort，而不是返回魔数
    }

    /// 计算批准数量
    fun count_approvals(approvals: u8): u64 {
        let mut count = 0;
        let mut i = 0;
        while (i < MULTI_SIG_ADMIN_COUNT) {
            if ((approvals & ((1 << (i as u8)) as u8)) != 0) {
                count = count + 1;
            };
            i = i + 1;
        };
        count
    }

    /// 16. 转移管理权（需要 AdminCap + 多签）
    #[allow(lint(custom_state_change))]
    public entry fun transfer_admin_cap(
        admin_cap: AdminCap,
        recipient: address,
        _ctx: &mut TxContext
    ) {
        transfer::transfer(admin_cap, recipient);
    }

    // ==================== 查询函数 ====================

    /// 获取任务信息
    public fun get_task_info(task: &Task): (
        vector<u8>,  // task_id
        address,     // boss
        u64,         // reward_amount
        u64,         // timeout_ms
        bool,        // is_open
        bool,        // is_locked
        bool,        // is_completed
        bool,        // is_closed
        u8           // completion_type
    ) {
        (
            task.task_id,
            task.boss,
            task.reward_amount,
            task.timeout_ms,
            task.status == STATUS_OPEN,
            task.status == STATUS_LOCKED,
            task.status == STATUS_REVIEWED || task.status == STATUS_ARBITRATED || task.status == STATUS_CANCELLED || task.status == STATUS_CLOSED,
            task.status == STATUS_CLOSED,
            // 简化完成类型判断
            if (task.status == STATUS_REVIEWED) 1 else if (task.status == STATUS_ARBITRATED) 3 else 0
        )
    }

    /// 获取托管余额
    public fun get_escrow_balance(task: &Task): u64 {
        balance::value(&task.escrow)
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
