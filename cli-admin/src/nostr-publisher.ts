import { SimplePool, UnsignedEvent, finalizeEvent, nip19, getPublicKey } from 'nostr-tools';
import { SimpleTimeUtils } from './simple-time-utils';
import { TASK_KINDS } from './task-kinds';

// 默认中继列表
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
];

// 管理员专用的 Nostr 事件类型
export interface AdminWhitelistEvent {
  kind: typeof TASK_KINDS.VERIFIER_WHITELIST; // 自定义 kind 用于管理员白名单
  created_at: number;
  tags: [];
  content: string;
  pubkey: string;
  sig?: string;
}

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

  getPublicKeyHex(): string {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }
    return getPublicKey(this.nostrSecretKey);
  }

  /**
   * 广播事件到 Nostr 网络
   */
  async publishEvent(unsignedEvent: UnsignedEvent): Promise<{ eventId: string; publishedTo: string[] }> {
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
      throw new Error(`Failed to publish to any relay: ${errors.join(', ')}`);
    }

    return {
      eventId: signedEvent.id,
      publishedTo,
    };
  }

  /**
   * 发布仲裁员白名单更新（纯 Nostr 事件）
   */
  async publishVerifierWhitelist(params: {
    verifiers: Array<{
      pubkey: string;
      sui_address: string;
      effective_from: number;
      expires_at: number;
    }>;
    updated_at: number;
  }): Promise<{ eventId: string; publishedTo: string[] }> {
    if (!this.nostrSecretKey) {
      throw new Error('Nostr secret key not set');
    }

    const payload = {
      verifiers: params.verifiers,
      updated_at: params.updated_at,
    };

    const unsignedEvent: UnsignedEvent = {
      kind: TASK_KINDS.VERIFIER_WHITELIST, //  36010
      created_at: SimpleTimeUtils.nowSec(),
      tags: [],
      content: JSON.stringify(payload),
      pubkey: this.getPublicKeyHex(),
    };

    return this.publishEvent(unsignedEvent);
  }

  /**
   * 关闭连接池
   */
  close() {
    this.pool.close(this.relays);
  }
}
