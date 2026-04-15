import type { NostrTaskEvent } from "./task-events";

/**
 * nostr-tools 库的类型定义接口
 *
 * 用于懒加载 nostr-tools 库，避免在未安装依赖时编译报错。
 */
interface NostrToolsLike {
  finalizeEvent: (template: {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
  }, secretKey: Uint8Array) => {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
    pubkey: string;
    id: string;
    sig: string;
  };
  verifyEvent: (event: {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
    pubkey: string;
    id?: string;
    sig?: string;
  }) => boolean;
  getPublicKey: (secretKey: Uint8Array) => string;
}

/**
 * 将十六进制字符串转换为字节数组
 *
 * @param hex - 十六进制字符串
 * @returns 字节数组
 * @throws {Error} 如果输入不是有效的十六进制字符串
 */
function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("invalid private key hex");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    out[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return out;
}

/**
 * 从私钥十六进制字符串派生公钥
 *
 * 用于构造事件的 pubkey 字段。
 *
 * @param privateKeyHex - 私钥的十六进制字符串
 * @returns 公钥的十六进制字符串
 * @throws {Error} 如果私钥格式无效或缺少 nostr-tools 依赖
 *
 * @example
 * const pubkey = await derivePubkeyFromPrivateKey("abc123...");
 */
export async function derivePubkeyFromPrivateKey(privateKeyHex: string): Promise<string> {
  const tools = await loadNostrTools();
  const secretKey = hexToBytes(privateKeyHex);
  return tools.getPublicKey(secretKey);
}

/**
 * 懒加载 nostr-tools 库
 *
 * 避免在未安装依赖时编译直接报错。
 * 真正调用签名/验签时才要求安装。
 *
 * @returns nostr-tools 库的接口
 * @throws {Error} 如果未安装 nostr-tools
 */
async function loadNostrTools(): Promise<NostrToolsLike> {
  try {
    const mod = (await import("nostr-tools")) as unknown as NostrToolsLike;
    if (!mod.finalizeEvent || !mod.verifyEvent || !mod.getPublicKey) {
      throw new Error("nostr-tools exports not found");
    }
    return mod;
  } catch (_error) {
    throw new Error(
      "缺少 nostr-tools 依赖，请先安装：npm install nostr-tools",
    );
  }
}


/**
 * 对任务事件进行 Nostr 标准签名
 *
 * 返回带有 id、sig 和 pubkey 的完整事件。
 * 签名后的事件可以广播到 Nostr 中继。
 *
 * @param unsignedEvent - 未签名的事件
 * @param privateKeyHex - 私钥的十六进制字符串
 * @returns 已签名的完整事件
 * @throws {Error} 如果 pubkey 与私钥不匹配或缺少 nostr-tools 依赖
 *
 * @example
 * const unsignedEvent = createTaskEvent({...});
 * const signedEvent = await signTaskEvent(unsignedEvent, privateKey);
 * // 现在可以广播 signedEvent
 */
export async function signTaskEvent(
  unsignedEvent: Omit<NostrTaskEvent, "id" | "sig">,
  privateKeyHex: string,
): Promise<NostrTaskEvent & { id: string; sig: string; pubkey: string }> {
  const tools = await loadNostrTools();
  const secretKey = hexToBytes(privateKeyHex);
  const expectedPubkey = tools.getPublicKey(secretKey);

  if (unsignedEvent.pubkey !== expectedPubkey) {
    throw new Error("签名失败：event.pubkey 与私钥不匹配");
  }

  const signed = tools.finalizeEvent(
    {
      kind: unsignedEvent.kind,
      content: unsignedEvent.content,
      tags: unsignedEvent.tags,
      created_at: unsignedEvent.created_at,
    },
    secretKey,
  );

  return {
    ...unsignedEvent,
    id: signed.id,
    sig: signed.sig,
    pubkey: signed.pubkey,
  };
}

/**
 * 验证事件签名与事件 ID 是否一致
 *
 * 返回 true 表示"签名可信且内容未篡改"。
 *
 * @param event - 要验证的事件
 * @returns 签名是否有效
 * @throws {Error} 如果缺少 nostr-tools 依赖
 *
 * @example
 * const isValid = await verifyTaskEventSignature(event);
 * if (!isValid) {
 *   console.error("事件签名无效");
 * }
 */
export async function verifyTaskEventSignature(
  event: NostrTaskEvent,
): Promise<boolean> {
  if (!event.id || !event.sig) {
    return false;
  }
  const tools = await loadNostrTools();
  return tools.verifyEvent({
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    created_at: event.created_at,
    pubkey: event.pubkey,
    id: event.id,
    sig: event.sig,
  });
}

/**
 * 构造 lock_sig 推荐签名消息（链下字符串模板）
 *
 * 用于 SELECTION_LOCK 事件中的 lock_sig 字段。
 * 后续可按合约要求替换为 EIP-712 Typed Data。
 *
 * @param input - 锁定签名所需的参数
 * @returns JSON 格式的签名消息字符串
 *
 * @example
 * const message = buildLockSigMessage({
 *   taskId: "task_001",
 *   selectedPubkey: "executor_pubkey",
 *   startTime: 1234567890,
 *   escrowAddress: "escrow_addr",
 *   amount: "100",
 *   asset: "USDT"
 * });
 * // 然后使用钱包对 message 进行签名
 */
export function buildLockSigMessage(input: {
  taskId: string;
  selectedPubkey: string;
  startTime: number;
  escrowAddress: string;
  amount: string;
  asset: string;
}): string {
  return JSON.stringify(
    {
      protocol: "atep_LOCK_V1",
      task_id: input.taskId,
      selected_pubkey: input.selectedPubkey,
      start_time: input.startTime,
      escrow_address: input.escrowAddress,
      amount: input.amount,
      asset: input.asset,
    },
    null,
    0,
  );
}
