import { LocalTestRelay } from "./local-test-relay";

/**
 * Nostr 模块入口
 *
 * 对外导出任务协议 Kind、事件构造/解析与状态流转。
 * Relay 连接能力可在此基础上继续实现。
 *
 * @module nostr
 */

// 导出所有核心模块
export * from "./task-kinds";
export * from "./task-events";
export * from "./local-test-relay";
export * from "./task-signature";
export * from "./task-id-generator";

/** Nostr 中继 URL 类型 */
export type RelayUrl = string;

/**
 * Nostr 客户端配置接口
 */
export interface NostrClientConfig {
  /** 中继服务器 URL 列表 */
  relays: RelayUrl[];
}

/**
 * Nostr 客户端接口
 *
 * 定义了与 Nostr 中继交互的基本方法。
 */
export interface NostrClient {
  /** 连接到配置的中继服务器 */
  connect: () => Promise<void>;

  /** 订阅事件（使用 Nostr 过滤器） */
  subscribe: (filters: Record<string, unknown>) => Promise<void>;

  /** 发布事件到中继 */
  publish: (event: Record<string, unknown>) => Promise<void>;
}

/**
 * 创建 Nostr 客户端
 *
 * 基础客户端占位，先保证 integration 层可依赖稳定接口。
 * 后续可以接入 nostr-tools 的 relay pool。
 *
 * @param config - 客户端配置
 * @returns Nostr 客户端实例
 * @throws {Error} 如果未配置中继服务器
 *
 * @example
 * const client = createNostrClient({
 *   relays: ["wss://relay.example.com"]
 * });
 * await client.connect();
 */
export function createNostrClient(config: NostrClientConfig): NostrClient {
  return {
    connect: async () => {
      if (!config.relays.length) {
        throw new Error("nostr: at least one relay is required");
      }
    },
    subscribe: async (_filters) => {
      if (!config.relays.length) {
        throw new Error("nostr: cannot subscribe without relays");
      }
    },
    publish: async (_event) => {
      if (!config.relays.length) {
        throw new Error("nostr: cannot publish without relays");
      }
    },
  };
}

/**
 * 创建本地测试客户端（不出网）
 *
 * 方便在不连接公共中继的情况下验证发布/订阅流程。
 * 适用于单元测试和本地开发。
 *
 * @returns 本地测试中继实例
 *
 * @example
 * const testClient = createLocalTestClient();
 * testClient.publish(event);
 * testClient.subscribe(filters, (event) => {
 *   console.log("Received:", event);
 * });
 */
export function createLocalTestClient() {
  return new LocalTestRelay();
}
