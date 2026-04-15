/**
 * 任务 ID 生成工具
 *
 * 提供确定性的 task_id 生成方法，确保链上链下一致性
 */

import { keccak256 } from "js-sha3";

/**
 * 生成任务 ID
 *
 * 基于甲方公钥、任务内容哈希和时间戳生成确定性的唯一 ID。
 * 这样可以在链上合约和 Nostr 事件中使用相同的 ID。
 *
 * @param clientPubkey - 甲方公钥（hex 格式）
 * @param payloadHash - 任务内容哈希
 * @param timestamp - 时间戳（Unix 秒），用于确保唯一性
 * @returns 任务 ID（hex 格式，64 字符）
 *
 * @example
 * const timestamp = Math.floor(Date.now() / 1000);
 * const taskId = generateTaskId(
 *   "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
 *   "sha256_hash_of_task_details",
 *   timestamp
 * );
 * // 返回: "927e7f065c000e61da8575bac010d241d23a871ec15d8d6346957dbd96ba694a"
 *
 * // 在 Nostr 事件中使用
 * const event = createTaskEvent({
 *   payload: { task_id: taskId, ... }
 * });
 *
 * // 在智能合约中使用
 * await contract.createTask({ task_id: taskId, ... });
 *
 * // 前端显示时可以截断
 * <div>任务 ID: {taskId.substring(0, 16)}...</div>
 */
export function generateTaskId(
  clientPubkey: string,
  payloadHash: string,
  timestamp: number
): string {
  // 验证时间戳
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error("timestamp must be a positive number");
  }

  // 组合输入数据
  const data = `${clientPubkey}:${payloadHash}:${timestamp}`;

  // 计算 Keccak-256 哈希（返回 64 字符的 hex 字符串）
  return keccak256(data);
}

/**
 * 验证任务 ID 是否有效
 *
 * 检查 task_id 是否由给定的参数正确生成
 *
 * @param taskId - 要验证的任务 ID
 * @param clientPubkey - 甲方公钥
 * @param payloadHash - 任务内容哈希
 * @param timestamp - 时间戳
 * @returns 是否有效
 *
 * @example
 * const isValid = verifyTaskId(
 *   "927e7f065c000e61da8575bac010d241d23a871ec15d8d6346957dbd96ba694a",
 *   clientPubkey,
 *   payloadHash,
 *   timestamp
 * );
 */
export function verifyTaskId(
  taskId: string,
  clientPubkey: string,
  payloadHash: string,
  timestamp: number
): boolean {
  const expectedId = generateTaskId(clientPubkey, payloadHash, timestamp);
  return taskId === expectedId;
}
