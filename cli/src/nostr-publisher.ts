import { SimplePool, type Event, type UnsignedEvent, getPublicKey, finalizeEvent } from 'nostr-tools';
import { createTaskEvent, type NostrTaskEvent } from '../../nostr/src/task-events';
import { TASK_KINDS, type TaskKind, type TaskPayloadByKind } from '../../nostr/src/task-kinds';

// 默认中继列表
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
];

export class NostrPublisher {
  private pool: SimplePool;
  private relays: string[];
  private nostrSecretKey: Uint8Array | null = null;

  constructor(relays?: string[]) {
    this.pool = new SimplePool();
    this.relays = relays || DEFAULT_RELAYS;
  }

  setNostrSecretKey(secretKey: Uint8Array) {
    this.nostrSecretKey = secretKey;
  }

  /**
   * 广播任务公告事件
   * 在链上创建任务后，调用此方法广播到 Nostr
   *
   * 注意：时间参数单位为秒（seconds）
   * - bidClosing: 投标截止时间（秒），建议 6-12 小时（21600-43200）
   * - expectedTtl: 预期交付时长（秒），从任务锁定开始计算
   */
  async publishTaskAnnouncement(
    taskId: string,
    params: {
      taskName: string;
      payloadHash: string;
      bidClosing: number;  // 秒
      expectedTtl: number; // 秒
      verifier: string[];
      arbitratorSuiAddress?: string;
      amount: string;
      txHash: string;
      suiObjectId: string;
    }
  ): Promise<{ eventId: string; publishedTo: string[] }> {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }

    // 创建 Nostr 事件
    const unsignedEvent = createTaskEvent({
      kind: TASK_KINDS.ANNOUNCEMENT,
      pubkey: this.getPublicKeyHex(),
      payload: {
        task_id: taskId,
        task_name: params.taskName,
        payload_hash: params.payloadHash,
        bid_closing_seconds: params.bidClosing,
        expected_ttl_seconds: params.expectedTtl,
        verifier: params.verifier,
        arbitrator_sui_address: params.arbitratorSuiAddress,
        amount: params.amount,
        asset: 'SUI',  // 固定值，合约只支持 SUI
        tx_hash: params.txHash,
        sui_object_id: params.suiObjectId,
      } as TaskPayloadByKind[typeof TASK_KINDS.ANNOUNCEMENT],
    });

    // 签名并发布
    return this.publishEvent(unsignedEvent as UnsignedEvent);
  }

  /**
   * 广播乙方竞价事件（举手）
   *
   * 由潜在任务执行方发布，用于提交竞标意向
   */
  async publishTaskBid(
    taskId: string,
    workerSuiAddress: string,
    capabilityProof?: string
  ): Promise<{ eventId: string; publishedTo: string[] }> {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }

    const unsignedEvent = createTaskEvent({
      kind: TASK_KINDS.BID,
      pubkey: this.getPublicKeyHex(),
      payload: {
        task_id: taskId,
        worker_sui_address: workerSuiAddress,
        capability_proof: capabilityProof,
      } as TaskPayloadByKind[typeof TASK_KINDS.BID],
    });

    return this.publishEvent(unsignedEvent as UnsignedEvent);
  }

  /**
   * 广播选择锁定事件
   *
   * 注意：startTime 单位为 Unix 时间戳（秒）
   */
  async publishSelectionLock(
    taskId: string,
    selectedPubkey: string,
    lockSig: string,
    startTime: number
  ): Promise<{ eventId: string; publishedTo: string[] }> {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }

    const unsignedEvent = createTaskEvent({
      kind: TASK_KINDS.SELECTION_LOCK,
      pubkey: this.getPublicKeyHex(),
      payload: {
        task_id: taskId,
        selected_pubkey: selectedPubkey,
        lock_sig: lockSig,
        start_time_seconds: startTime,
      } as TaskPayloadByKind[typeof TASK_KINDS.SELECTION_LOCK],
    });

    return this.publishEvent(unsignedEvent as UnsignedEvent);
  }

  /**
   * 广播交付证明事件
   *
   * 注意：timestamp 单位为 Unix 时间戳（秒）
   */
  async publishProofOfTask(
    taskId: string,
    deliveryHash: string,
    timestamp: number
  ): Promise<{ eventId: string; publishedTo: string[] }> {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }

    const unsignedEvent = createTaskEvent({
      kind: TASK_KINDS.PROOF_OF_TASK,
      pubkey: this.getPublicKeyHex(),
      payload: {
        task_id: taskId,
        delivery_hash: deliveryHash,
        timestamp_seconds: timestamp,
      } as TaskPayloadByKind[typeof TASK_KINDS.PROOF_OF_TASK],
    });

    return this.publishEvent(unsignedEvent as UnsignedEvent);
  }

  /**
   * 广播最终确认事件
   */
  async publishFinalization(
    taskId: string,
    status: 'success' | 'rejected'
  ): Promise<{ eventId: string; publishedTo: string[] }> {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }

    const unsignedEvent = createTaskEvent({
      kind: TASK_KINDS.FINALIZATION,
      pubkey: this.getPublicKeyHex(),
      payload: {
        task_id: taskId,
        status: status,
      } as TaskPayloadByKind[typeof TASK_KINDS.FINALIZATION],
    });

    return this.publishEvent(unsignedEvent as UnsignedEvent);
  }

  /**
   * 广播仲裁发起事件
   */
  async publishDisputeInitiation(
    taskId: string,
    params: {
      taskName: string;
      payloadHash: string;
      deliveryHash?: string;
      verifier: string[];
      evidenceList: string[];
      disputeReason?: string;
    }
  ): Promise<{ eventId: string; publishedTo: string[] }> {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }

    const unsignedEvent = createTaskEvent({
      kind: TASK_KINDS.DISPUTE_INITIATION,
      pubkey: this.getPublicKeyHex(),
      payload: {
        task_id: taskId,
        task_name: params.taskName,
        payload_hash: params.payloadHash,
        delivery_hash: params.deliveryHash,
        verifier: params.verifier,
        evidence_list: params.evidenceList,
        dispute_reason: params.disputeReason,
      } as TaskPayloadByKind[typeof TASK_KINDS.DISPUTE_INITIATION],
    });

    return this.publishEvent(unsignedEvent as UnsignedEvent);
  }

  /**
   * 广播取消/退款事件
   */
  async publishCancellationRefund(
    taskId: string,
    reason: string
  ): Promise<{ eventId: string; publishedTo: string[] }> {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }

    const unsignedEvent = createTaskEvent({
      kind: TASK_KINDS.CANCELLATION_REFUND,
      pubkey: this.getPublicKeyHex(),
      payload: {
        task_id: taskId,
        reason: reason,
      } as TaskPayloadByKind[typeof TASK_KINDS.CANCELLATION_REFUND],
    });

    return this.publishEvent(unsignedEvent as UnsignedEvent);
  }

  /**
   * 订阅任务的竞价事件（BID）
   * 甲方调用此方法监听有哪些乙方举手竞标
   *
   * @param taskId - 要监听的任务 ID
   * @param onBid - 收到竞价时的回调函数
   * @returns 取消订阅的函数
   */
  subscribeTaskBids(
    taskId: string,
    onBid: (event: Event, payload: { worker_sui_address: string; capability_proof?: string }) => void
  ): () => void {
    const filter = {
      kinds: [TASK_KINDS.BID],
      '#task_id': [taskId],
    };

    const unsub = (this.pool as any).subscribe(this.relays, filter, (event: Event) => {
      try {
        const payload = JSON.parse(event.content);
        if (payload.task_id === taskId) {
          onBid(event, payload);
        }
      } catch (e) {
        console.warn('Failed to parse BID event:', e);
      }
    });

    return unsub as () => void;
  }

  /**
   * 查询已收到的竞价（一次性查询）
   * 用于启动时获取历史竞价
   */
  async queryTaskBids(taskId: string, since?: number): Promise<Event[]> {
    const filter = {
      kinds: [TASK_KINDS.BID],
      '#task_id': [taskId],
      since: since || Math.floor(Date.now() / 1000) - 86400, // 默认查最近24小时
    };

    return this.pool.querySync(this.relays, filter);
  }

  private getPublicKeyHex(): string {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }
    return getPublicKey(this.nostrSecretKey);
  }

  private async publishEvent(unsignedEvent: UnsignedEvent): Promise<{ eventId: string; publishedTo: string[] }> {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }

    // 签名事件
    const signedEvent = finalizeEvent(unsignedEvent, this.nostrSecretKey);

    // 发布到所有中继
    const publishedTo: string[] = [];
    const errors: string[] = [];

    for (const relay of this.relays) {
      try {
        await this.pool.publish([relay], signedEvent);
        publishedTo.push(relay);
      } catch (error) {
        errors.push(`${relay}: ${error}`);
      }
    }

    if (publishedTo.length === 0) {
      throw new Error(`Failed to publish to any relay. Errors: ${errors.join(', ')}`);
    }

    return { eventId: signedEvent.id, publishedTo };
  }

  close() {
    this.pool.close(this.relays);
  }
}
