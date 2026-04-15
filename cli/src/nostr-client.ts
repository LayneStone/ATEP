// @ts-ignore - ws library type issues
import WebSocket from 'ws';

/**
 * Nostr 客户端配置
 */
export interface NostrClientConfig {
  relays: string[];
  timeout?: number;
}

/**
 * 简单的 Nostr 客户端
 * 使用原生 WebSocket 实现
 */
export class NostrClient {
  private config: NostrClientConfig;
  // @ts-ignore
  private connections: Map<string, WebSocket> = new Map();

  constructor(config: NostrClientConfig) {
    this.config = {
      timeout: 5000,
      ...config,
    };
  }

  /**
   * 连接到所有配置的中继器
   */
  async connect(): Promise<void> {
    const connectPromises = this.config.relays.map((url) =>
      this.connectToRelay(url)
    );

    const results = await Promise.allSettled(connectPromises);

    const successCount = results.filter(r => r.status === 'fulfilled').length;

    if (successCount === 0) {
      throw new Error('Failed to connect to any relay');
    }

    console.log(`✅ Connected to ${successCount}/${this.config.relays.length} relay(s)`);
  }

  /**
   * 连接到单个中继器
   */
  private connectToRelay(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`🔄 Connecting to ${url}...`);
        // @ts-ignore
        const ws = new WebSocket(url);

        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error(`Connection timeout after ${this.config.timeout}ms`));
        }, this.config.timeout);

        // @ts-ignore
        ws.on('open', () => {
          clearTimeout(timeout);
          this.connections.set(url, ws);
          console.log(`✅ Connected to relay: ${url}`);
          resolve();
        });

        // @ts-ignore
        ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          console.error(`❌ Connection error for ${url}:`, error.message);
          reject(error);
        });

        // @ts-ignore
        ws.on('close', () => {
          clearTimeout(timeout);
          if (!this.connections.has(url)) {
            reject(new Error('Connection closed before established'));
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 广播事件到所有已连接的中继器
   */
  async broadcast(event: any): Promise<{
    success: number;
    failed: number;
    results: Array<{ relay: string; success: boolean; error?: string }>;
  }> {
    if (this.connections.size === 0) {
      throw new Error('No relays connected. Call connect() first.');
    }

    const results: Array<{ relay: string; success: boolean; error?: string }> = [];
    let success = 0;
    let failed = 0;

    const publishPromises = Array.from(this.connections.entries()).map(
      ([url, ws]) => this.publishToRelay(url, ws, event)
    );

    const publishResults = await Promise.allSettled(publishPromises);

    publishResults.forEach((result, index) => {
      const relayUrl = Array.from(this.connections.keys())[index];
      if (result.status === 'fulfilled') {
        results.push({ relay: relayUrl, success: true });
        success++;
        console.log(`✅ Published to ${relayUrl}`);
      } else {
        results.push({
          relay: relayUrl,
          success: false,
          error: result.reason?.message || 'Unknown error',
        });
        failed++;
        console.error(`❌ Failed to publish to ${relayUrl}:`, result.reason?.message);
      }
    });

    return { success, failed, results };
  }

  /**
   * 发布事件到单个中继器
   */
  // @ts-ignore
  private publishToRelay(url: string, ws: WebSocket, event: any): Promise<void> {
    return new Promise((resolve, reject) => {
      // @ts-ignore
      if (ws.readyState !== 1) { // 1 = OPEN
        reject(new Error('WebSocket not open'));
        return;
      }

      // Nostr EVENT 消息格式: ["EVENT", <event JSON>]
      const message = JSON.stringify(['EVENT', event]);

      const timeout = setTimeout(() => {
        reject(new Error('Publish timeout'));
      }, this.config.timeout);

      // 监听 OK 响应
      // @ts-ignore
      const messageHandler = (data: any) => {
        try {
          const response = JSON.parse(data.toString());
          // Nostr OK 响应格式: ["OK", <event id>, <true|false>, <message>]
          if (response[0] === 'OK' && response[1] === event.id) {
            clearTimeout(timeout);
            // @ts-ignore
            ws.off('message', messageHandler);
            if (response[2]) {
              resolve();
            } else {
              reject(new Error(response[3] || 'Event rejected'));
            }
          }
        } catch (error) {
          // 忽略解析错误，可能是其他消息
        }
      };

      // @ts-ignore
      ws.on('message', messageHandler);

      // @ts-ignore
      ws.send(message, (error?: Error) => {
        if (error) {
          clearTimeout(timeout);
          // @ts-ignore
          ws.off('message', messageHandler);
          reject(error);
        }
      });

      // 如果 5 秒内没有收到 OK 响应，也认为成功（某些中继器不发送 OK）
      setTimeout(() => {
        clearTimeout(timeout);
        // @ts-ignore
        ws.off('message', messageHandler);
        resolve();
      }, 5000);
    });
  }

  /**
   * 断开所有中继器连接
   */
  async disconnect(): Promise<void> {
    for (const [url, ws] of this.connections.entries()) {
      try {
        ws.close();
      } catch (error) {
        console.error(`Error closing connection to ${url}:`, error);
      }
    }
    this.connections.clear();
    console.log('Disconnected from all relays');
  }

  /**
   * 获取已连接的中继器数量
   */
  getConnectedCount(): number {
    return this.connections.size;
  }

  /**
   * 获取所有已连接的中继器 URL
   */
  getConnectedRelays(): string[] {
    return Array.from(this.connections.keys());
  }
}

/**
 * 创建默认的 Nostr 客户端
 */
export function createDefaultNostrClient(): NostrClient {
  const relayUrls = process.env.NOSTR_RELAYS
    ? process.env.NOSTR_RELAYS.split(',')
    : [
        'wss://relay.damus.io',
        'wss://nos.lol',
      ];

  return new NostrClient({
    relays: relayUrls,
    timeout: 10000,
  });
}
