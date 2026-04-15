import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import inquirer from "inquirer";
import { TASK_KINDS, type CancellationRefundPayload, type SelectionLockPayload, type TaskFinalizationPayload, type WorkerRefundPayload, type ProofOfTaskPayload, type ReviewTimeoutCompletionPayload, type DisputeInitiationPayload, type ArbitrationResultPayload, type ArbitrationTimeoutClaimPayload, type ExpirationPayload } from "../../nostr/src/task-kinds";
import { createTaskEvent } from "../../nostr/src/task-events";
import { SuiContractAdapter } from "./sui-contract-adapter";
import { NostrClient } from "./nostr-client";
import { VerificationTools } from "./verification-tools";
import { SimpleTimeUtils } from "./simple-time-utils";
import { keccak256 } from "js-sha3";

/** 
 * 生成任务 ID
 * 基于甲方公钥、任务名称、任务内容哈希、验收标准哈希、时间戳和随机字符生成唯一 ID
 * 公式：hash(pubkey + task_name + payload_hash + acceptance_hash + timestamp + random_6chars)
 */
function generateTaskId(
  clientPubkey: string,
  taskName: string,
  payloadHash: string,
  acceptanceHash: string,
  timestamp: number,
  randomChars: string
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error("timestamp must be a positive number");
  }
  const data = `${clientPubkey}:${taskName}:${payloadHash}:${acceptanceHash}:${timestamp}:${randomChars}`;
  return keccak256(data);
}

/** 生成6位随机字符（字母+数字） */
function generateRandom6Chars(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** CLI 配置管理 */
const CONFIG_DIR = join(homedir(), ".atep");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  relayUrl?: string;
  indexerUrl?: string;
  suiNetwork?: string;
  suiPackageId?: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getRelayUrl(cmdLineUrl?: string): string {
  if (cmdLineUrl) return cmdLineUrl;
  const config = loadConfig();
  if (config.relayUrl) return config.relayUrl;
  if (process.env.NOSTR_RELAYS) return process.env.NOSTR_RELAYS.split(',')[0];
  return "ws://localhost:7000";
}

function getIndexerUrl(cmdLineUrl?: string): string {
  if (cmdLineUrl) return cmdLineUrl;
  const config = loadConfig();
  if (config.indexerUrl) return config.indexerUrl;
  return "https://indexer.atep.work";
}
interface CliOptions {
  input?: string;
  inputFile?: string;
  output?: "jsonl" | "pretty";
  relayUrl?: string;
  indexerUrl?: string;
}

/** 从 stdin 读取 JSON */
function readStdin(): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", reject);
  });
}

/** 统一加载 JSON 输入 */
async function loadJsonInput<T>(opts: CliOptions, interactivePrompt?: () => Promise<T>): Promise<T> {
  if (opts.inputFile) {
    const content = readFileSync(resolve(opts.inputFile), "utf8");
    return JSON.parse(content) as T;
  }
  if (opts.input) {
    return JSON.parse(opts.input) as T;
  }
  if (!process.stdin.isTTY) {
    const content = await readStdin();
    if (content.trim().length === 0) {
      throw new Error("stdin is empty");
    }
    return JSON.parse(content) as T;
  }
  if (interactivePrompt) {
    return await interactivePrompt();
  }
  throw new Error("no input provided; use --input, --input-file, pipe JSON via stdin, or run interactively");
}

/** 输出统一结果 */
function emit(payload: unknown, output: "jsonl" | "pretty") {
  if (output === "pretty") {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
}

/** 
 * 统一输出结果到终端和文件
 * 所有 prepare 命令使用此函数输出，确保格式一致
 */
function outputResult(
  data: Record<string, unknown>,
  filePath: string | undefined,
  format: "jsonl" | "pretty",
  meta?: { operation: string; version?: string }
) {
  const result = {
    ok: true,
    data: {
      ...(meta ? { meta: { version: meta.version ?? "2.0.0", operation: meta.operation } } : {}),
      ...data,
    },
  };

  if (filePath) {
    writeFileSync(resolve(filePath), JSON.stringify(result.data, null, 2));
  }

  // 简化字节数组显示
  const simplifiedData = simplifyByteArrays(result.data);

  // 终端输出使用格式化输出，提高可读性
  console.log('='.repeat(80));
  console.log(`✅ ${meta?.operation || '操作'} 成功`);
  console.log('='.repeat(80));

  // 输出格式 1: JSON 数据格式
  if (simplifiedData.json_format) {
    console.log('');
    console.log(simplifiedData.json_format.title);
    console.log('='.repeat(80));
    console.log(JSON.stringify(simplifiedData.json_format, null, 2));
    console.log('='.repeat(80));
  }

  // 输出格式 2: Sui CLI 命令格式
  if (simplifiedData.cli_format) {
    console.log('');
    console.log(simplifiedData.cli_format.title);
    console.log('='.repeat(80));
    console.log(`设置命令:`);
    console.log(`  ${simplifiedData.cli_format.setup_command}`);
    console.log('');
    console.log(`Sui 命令:`);
    console.log(`  ${simplifiedData.cli_format.sui_command}`);
    console.log('');
    console.log(`使用说明:`);
    simplifiedData.cli_format.instructions.forEach((instruction: string) => {
      console.log(`  ${instruction}`);
    });
    console.log('='.repeat(80));
  }

  // 如果没有 json_format/cli_format，输出完整数据
  if (!simplifiedData.json_format && !simplifiedData.cli_format) {
    console.log('');
    console.log('📋 任务信息:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(simplifiedData, null, 2));
    console.log('='.repeat(80));
  }

  // 输出其他信息
  console.log('');
  console.log('💡 提示:');
  console.log('='.repeat(80));
  if (simplifiedData.note) console.log(`  ${simplifiedData.note}`);
  if (simplifiedData.next_step) console.log(`  下一步: ${simplifiedData.next_step}`);
  console.log('='.repeat(80));
}

// 简化字节数组显示，将 {"0": 160, "1": 235, ...} 转换为十六进制字符串
function simplifyByteArrays(obj: any): any {
  if (Array.isArray(obj)) {
    // 数组保持不变，只递归处理元素
    return obj.map(item => simplifyByteArrays(item));
  } else if (typeof obj === 'object' && obj !== null) {
    const result: any = {};
    for (const key in obj) {
      // 检查是否是字节数组格式（{"0": number, "1": number, ...}）
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        const keys = Object.keys(obj[key]);
        // 只有当键都是数字且连续时才认为是字节数组
        if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
          const numKeys = keys.map(k => parseInt(k)).sort((a, b) => a - b);
          // 检查是否是连续的数字键
          const isConsecutive = numKeys.every((k, i) => i === 0 || k === numKeys[i-1] + 1);
          if (isConsecutive && numKeys[numKeys.length - 1] === numKeys.length - 1) {
            // 转换为十六进制字符串
            const bytes = [];
            for (let i = 0; i < keys.length; i++) {
              bytes.push(obj[key][i]);
            }
            result[key] = '0x' + Buffer.from(bytes).toString('hex');
            continue;
          }
        }
      }
      result[key] = simplifyByteArrays(obj[key]);
    }
    return result;
  }
  return obj;
}

// 确保十六进制字符串有 0x 前缀
function ensureHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex : '0x' + hex;
}

/** 十六进制字符串转 Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${cleanHex.length}`);
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Nostr 公钥解码：支持 npub1 格式和 hex 格式 */
function decodeNostrPubkey(pubkey: string): Uint8Array {
  if (pubkey.startsWith('npub1')) {
    // 简化的 npub1 解码（实际应该使用 bech32 库）
    // 这里为了演示，我们提取 npub1 后面的部分并转换为 hex
    const npubData = pubkey.slice(6); // 移除 'npub1'
    // 将 base58 字符转换为 hex（简化版本）
    const hexChars = '0123456789abcdef';
    let hex = '';
    for (let i = 0; i < npubData.length; i++) {
      const charCode = npubData.charCodeAt(i);
      hex += hexChars[(charCode * 7) % 16];
    }
    // 确保长度为 64 字符（32字节）
    while (hex.length < 64) {
      hex += '0';
    }
    hex = hex.substring(0, 64);
    return hexToBytes(hex);
  } else {
    // 纯 hex 格式
    return hexToBytes(pubkey);
  }
}

/** 广播 Nostr 事件到中继器 */
async function broadcastNostrEvent(event: any, relayUrl?: string): Promise<void> {
  const relays = relayUrl 
    ? [relayUrl] 
    : (process.env.NOSTR_RELAYS?.split(',') || ['ws://localhost:7000']);
  
  const client = new NostrClient({
    relays,
    timeout: 10000,
  });

  try {
    await client.connect();
    await client.broadcast(event);
  } catch (error: any) {
    console.error(`\n❌ 无法连接到 Nostr 中继器: ${relays.join(', ')}`);
    console.error(`\n可能的解决方案：`);
    console.error(`  1. 使用 --relay-url 指定公共中继节点`);
    console.error(`  2. 运行 'atep-cli config --set-relay <url>' 设置默认节点`);
    console.error(`  3. 设置环境变量: export NOSTR_RELAYS="ws://中继1,ws://中继2"\n`);
    throw new Error(`Nostr 中继连接失败: ${error.message}`);
  } finally {
    await client.disconnect();
  }
}

/** 创建 Sui 适配器（纯服务模式，不接触私钥） */
function createSuiAdapter(): SuiContractAdapter {
  // 从环境变量读取配置，CLI 只准备数据，不执行签名
  const network = process.env.SUI_NETWORK || 'devnet';
  const packageId = process.env.SUI_PACKAGE_ID || "0x955313e42d8b2e7e34c435dd35c3c727043721a1c7c07eb3a3b0ecbdece9c9";
  
  // SuiContractAdapter 构造函数只需要 network 参数
  // packageId 通过环境变量 SUI_PACKAGE_ID 设置，如果不设置则使用默认值
  return new SuiContractAdapter(network as 'devnet' | 'testnet' | 'mainnet');
}

/** 任务数据接口（索引器返回） */
interface TaskData {
  error?: string;
  status?: string;
  worker_pubkey?: string;
  locked_at?: number;
  bid_closing?: number;
  delivery_submitted?: boolean;
  delivered_at?: number;
  review_period?: number;
  expected_ttl?: number;
  is_in_arbitration?: boolean;
  arbitration_initiated_at?: number;
  is_locked?: boolean;
  is_completed?: boolean;
  is_reviewed?: boolean;
  review_result?: boolean;
  has_responded?: boolean;
  review_time?: number;
  response_period?: number;
}

/** 通用索引器任务状态检查结果 */
interface TaskCheckResult {
  success: boolean;
  warnings: string[];
  taskData?: TaskData;
}

/** 
 * 通用任务状态检查函数
 * 减少重复代码，统一检查模式
 */
async function checkTaskStatus(
  indexerUrl: string,
  taskId: string,
  options: {
    expectedStatus?: string[];
    checkDeadline?: boolean;
    checkBidClosing?: boolean;
    checkLockedWorker?: string;
    checkDeliverySubmitted?: boolean;
    checkExpectedTtl?: boolean;
    // 仲裁相关检查
    checkIsLocked?: boolean;
    checkIsCompleted?: boolean;
    checkIsReviewed?: boolean;
    checkReviewResult?: boolean; // true=接受, false=拒绝
    checkHasResponded?: boolean; // true=已回应, false=未回应
    checkIsInArbitration?: boolean; // true=在仲裁中, false=不在仲裁中
    checkResponseDeadline?: boolean; // 检查回应期
  }
): Promise<TaskCheckResult> {
  const warnings: string[] = [];
  
  try {
    const response = await fetch(`${indexerUrl}/tasks/${taskId}`);
    const taskData = await response.json() as TaskData;

    if (!taskData || taskData.error) {
      return { success: false, warnings: [`任务 ${taskId} 在索引器中未找到`], taskData };
    }

    // 检查 1: 任务状态
    if (options.expectedStatus && !options.expectedStatus.includes(taskData.status || "")) {
      warnings.push(`任务状态为 "${taskData.status}"，需要 ${options.expectedStatus.join(" 或 ")} 状态`);
    }

    // 检查 2: 验收期截止
    if (options.checkDeadline && taskData.delivered_at && taskData.review_period) {
      const now = SimpleTimeUtils.nowSec();
      const deadline = taskData.delivered_at + taskData.review_period;
      if (now > deadline) {
        warnings.push(`已超过截止时间（截止: ${deadline}, 当前: ${now}）`);
      }
    }

    // 检查 3: 竞标截止
    if (options.checkBidClosing && taskData.bid_closing) {
      const now = SimpleTimeUtils.nowSec();
      if (now > taskData.bid_closing) {
        warnings.push(`竞标已截止（截止: ${taskData.bid_closing}, 当前: ${now}）`);
      }
    }

    // 检查 4: 锁定乙方
    if (options.checkLockedWorker !== undefined) {
      if (taskData.worker_pubkey !== options.checkLockedWorker) {
        warnings.push(`任务已锁定给其他乙方，不是你`);
      }
    }

    // 检查 5: 交付状态
    if (options.checkDeliverySubmitted !== undefined) {
      if (options.checkDeliverySubmitted && !taskData.delivery_submitted) {
        warnings.push(`乙方尚未提交交付`);
      }
      if (!options.checkDeliverySubmitted && taskData.delivery_submitted) {
        warnings.push(`交付已提交过，不能重复操作`);
      }
    }

    // 检查 6: 预期交付周期
    if (options.checkExpectedTtl && taskData.locked_at && taskData.expected_ttl) {
      const now = SimpleTimeUtils.nowSec();
      const deadline = taskData.locked_at + taskData.expected_ttl;
      if (now > deadline) {
        warnings.push(`已超过交付截止时间（截止: ${deadline}, 当前: ${now}）`);
      }
    }

    // 检查 7: 任务是否已锁定
    if (options.checkIsLocked !== undefined) {
      if (options.checkIsLocked && !taskData.is_locked) {
        warnings.push(`任务未锁定`);
      }
    }

    // 检查 8: 任务是否已完成
    if (options.checkIsCompleted !== undefined) {
      if (options.checkIsCompleted && taskData.is_completed) {
        warnings.push(`任务已完成`);
      }
    }

    // 检查 9: 任务是否已验收
    if (options.checkIsReviewed !== undefined) {
      if (options.checkIsReviewed && !taskData.is_reviewed) {
        warnings.push(`甲方尚未验收`);
      }
    }

    // 检查 10: 验收结果
    if (options.checkReviewResult !== undefined && taskData.review_result !== options.checkReviewResult) {
      if (options.checkReviewResult === false) {
        warnings.push(`甲方未拒绝交付（review_result 不为 false）`);
      } else {
        warnings.push(`甲方未接受交付（review_result 不为 true）`);
      }
    }

    // 检查 11: 是否已回应
    if (options.checkHasResponded !== undefined) {
      if (options.checkHasResponded && taskData.has_responded) {
        warnings.push(`乙方已回应（可能已接受拒绝或发起仲裁）`);
      }
      if (!options.checkHasResponded && !taskData.has_responded) {
        warnings.push(`乙方尚未回应`);
      }
    }

    // 检查 12: 是否在仲裁中
    if (options.checkIsInArbitration !== undefined) {
      if (options.checkIsInArbitration && !taskData.is_in_arbitration) {
        warnings.push(`任务不在仲裁中`);
      }
      if (!options.checkIsInArbitration && taskData.is_in_arbitration) {
        warnings.push(`任务已在仲裁中`);
      }
    }

    // 检查 13: 回应期截止
    if (options.checkResponseDeadline && taskData.review_time && taskData.response_period) {
      const nowMs = SimpleTimeUtils.nowMs();
      const responseDeadlineMs = taskData.review_time + taskData.response_period;
      if (nowMs > responseDeadlineMs) {
        warnings.push(`已超过回应截止时间（截止: ${responseDeadlineMs}, 当前: ${nowMs}）`);
      }
    }

    return { success: warnings.length === 0, warnings, taskData };
  } catch (error: any) {
    return { 
      success: false, 
      warnings: [`索引器查询失败: ${error.message}`],
    };
  }
}

/** 输出检查结果（统一格式） */
function printCheckResult(warnings: string[], operationName: string): void {
  if (warnings.length === 0) {
    console.log(`✓ 任务状态检查通过`);
  } else {
    console.warn(`⚠ 状态检查警告:`, warnings.join("; "));
    console.warn(`⚠ 仍生成${operationName}数据，请自行决定是否执行`);
  }
}

/**
 * ============================================================================
 * CLI 命令目录 (Command Reference)
 * ============================================================================
 * 
 * 【第1组：任务发布流程（甲方）】
 *   1.1  create-task-id              创建任务 ID（本地计算，无需签名）
 *   1.2  prepare-escrow              准备链上托管交易
 *   1.3  prepare-announce            准备 Nostr 广播（链上执行后）
 *   1.4  prepare-cancel-task-escrow  准备链上取消任务（甲方取消，先执行 Sui）
 *   1.5  prepare-cancel-task-announce 准备取消公告 Nostr 事件（链上成功后）
 *   1.6  prepare-expire-task-escrow  准备链上竞标超时过期交易（招标期超时，任意人可调用）
 *   1.7  prepare-expire-task-announce 准备过期公告 Nostr 事件（链上成功后）
 * 
 * 【第2组：竞标与锁定流程】
 *   2.1  prepare-bid                 准备竞标数据（乙方举手）
 *   2.2  prepare-lock-escrow         准备链上锁定交易（甲方锁定乙方）
 *   2.3  prepare-lock-announce       准备锁定公告 Nostr 事件
 * 
 * 【第3组：交付与验收流程】
 *   3.1.1 prepare-submit-escrow      准备链上提交交付（乙方提交）
 *   3.1.2 prepare-submit-announce    准备交付公告 Nostr 事件
 *   3.2.1 prepare-complete-escrow     准备链上确认完成（甲方验收通过）
 *   3.2.2 prepare-complete-announce   准备完成公告 Nostr 事件
 *   3.3.1 prepare-reject-escrow       准备链上拒绝交付（甲方验收拒绝）
 *   3.3.2 prepare-reject-announce     准备拒绝公告 Nostr 事件
 *   3.4.1 prepare-refund-by-worker-escrow   准备乙方主动退款（乙方放弃任务）
 *   3.4.2 prepare-refund-by-worker-announce  准备乙方主动退款公告 Nostr 事件
 *   3.5.1 prepare-claim-delivery-timeout-escrow  准备交付超时认领（乙方未按时交付）
 *   3.5.2 prepare-claim-delivery-timeout-announce 准备交付超时公告 Nostr 事件
 *   3.6.1 prepare-claim-review-timeout-escrow   准备验收超时收款（甲方未按时验收）
 *   3.6.2 prepare-claim-review-timeout-announce  准备验收超时公告 Nostr 事件
 * 
 * 【第4组：拒绝回应与仲裁流程】
 *   4.1.1 prepare-accept-rejection-escrow      接受拒绝 - 链上交易
 *   4.1.2 prepare-accept-rejection-announce     接受拒绝 - Nostr 广播
 *   4.2.1 prepare-initiate-arbitration-escrow 发起仲裁 - 链上交易
 *   4.2.2 prepare-initiate-arbitration-announce发起仲裁 - Nostr 广播
 *   4.3.1 prepare-resolve-arbitration-escrow  仲裁裁决 - 链上交易
 *   4.3.2 prepare-resolve-arbitration-announce仲裁裁决 - Nostr 广播
 *   4.4.1 prepare-claim-response-timeout-escrow   回应超时认领 - 链上（乙方未回应）
 *   4.4.2 prepare-claim-response-timeout-announce  回应超时公告 - Nostr
 *   4.5.1 prepare-claim-arbitration-timeout-escrow   仲裁超时认领 - 链上
 *   4.5.2 prepare-claim-arbitration-timeout-announce  仲裁超时公告 - Nostr
 * 
 * 【第5组：查询命令】
 *   5.1  query-task                查询任务状态
 *   5.2  query-bids                查询任务竞标列表
 * 
 * 【第6组：通用工具命令】
 *   6.1  submit-signed             提交已签名 Nostr 事件（广播）
 * 
 * 【第7组：配置管理】
 *   7.1  config                    管理 CLI 配置（设置/查看默认参数）
 * 
 * 【第8组：验证工具】
 *   8.1  verify-task               验证任务数据一致性（对比索引器与链上数据）
 *   8.2  verify-range              批量验证任务数据一致性
 * 
 * ============================================================================
 */

const program = new Command();

program
  .name("atep-cli")
  .description("atep CLI - 纯服务模式，不接触私钥。准备交易数据由外部签名后提交。")
  .version("2.0.0")
  .option("-i, --input <json>", "JSON input payload")
  .option("-f, --input-file <path>", "JSON input file path")
  .option("--output <mode>", "输出格式: jsonl | pretty", "jsonl")
  .option("--relay-url <url>", "Nostr relay URL", "ws://localhost:7000")
  .option("--indexer-url <url>", "Indexer API URL", "https://indexer.atep.work");

// ==================== 第1组：任务发布流程（甲方）====================
// 任务生命周期：创建 → 托管 → 广播 → 竞标 → 锁定

// ==================== 1.1 创建任务 ID ====================
// 
// 纯本地生成任务 ID，无需签名，无需私钥
// 公式：hash(pubkey + task_name + payload_hash + timestamp)
//

program
  .command("create-task-id")
  .description("【1.1】创建任务 ID（本地计算，无需签名）")
  .requiredOption("--pubkey <hex>", "甲方 Nostr 公钥（hex）")
  .requiredOption("--task-name <name>", "任务名称")
  .requiredOption("--payload-hash <hash>", "任务内容哈希（如 SHA-256）")
  .requiredOption("--acceptance-hash <hash>", "验收标准哈希（如 SHA-256）")
  .option("-o, --output <file>", "输出到文件")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    
    const taskId = generateTaskId(
      cmd.pubkey,
      cmd.taskName,
      cmd.payloadHash,
      cmd.acceptanceHash,
      SimpleTimeUtils.nowMs(),
      generateRandom6Chars()
    );

    const data = {
      task_id: taskId,
      task_name: cmd.taskName,
      payload_hash: cmd.payloadHash,
      acceptance_hash: cmd.acceptanceHash,
      pubkey: cmd.pubkey,
      generated_at: SimpleTimeUtils.formatTimestamp(SimpleTimeUtils.nowMs()),
      note: "保存此 ID，后续步骤需要使用",
      next_step: "使用 prepare-escrow 准备链上托管交易",
      id_formula: "hash(pubkey + task_name + payload_hash + acceptance_hash + timestamp + random_6chars)",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "create-task-id" });
  });

// ==================== 1.2 准备链上托管 ====================
// 
// 准备创建链上任务的 Sui 交易数据
// 用户签名执行后获得 task_object_id 和 tx_hash
//

program
  .command("prepare-escrow")
  .description("【1.2】准备链上托管交易（资金托管到合约）")
  .requiredOption("--task-id <id>", "任务 ID（create-task-id 生成）")
  .requiredOption("--expected-ttl <seconds>", "预期完成时长（秒）")
  .requiredOption("--boss-pubkey <hex>", "甲方 Nostr 公钥")
  .requiredOption("--verifier-nostr-pubkey <hex>", "仲裁员 Nostr 公钥")
  .requiredOption("--arbitrator-sui-address <address>", "仲裁员 Sui 地址")
  .requiredOption("--payload-hash <hash>", "任务内容哈希（如 SHA-256）")
  .requiredOption("--acceptance-hash <hash>", "验收标准哈希（如 SHA-256）")
  .option("-o, --output <file>", "输出待签名数据到文件")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const packageId = process.env.SUI_PACKAGE_ID || "0x955313e42d8b2e7e34c435dd35c3c727043721a1c7c07eb3a3b0ecbdecece9c9";
    const network = process.env.SUI_NETWORK || "devnet";

    // 原有的 JSON 数据格式
    const suiTxData = {
      description: "创建链上任务托管（调用 atep.move::create_task）",
      function: `${packageId}::atep::create_task`,
      typeArguments: [],
      arguments: [
        { name: "task_id", type: "vector<u8>", value: hexToBytes(cmd.taskId) },
        { name: "payment", type: "Coin<SUI>", value: "<在 Sui 钱包中选择支付 Coin 对象>" },
        { name: "expected_ttl_ms", type: "u64", value: BigInt(parseInt(cmd.expectedTtl) * 1000).toString() },
        { name: "boss_nostr_pubkey", type: "vector<u8>", value: decodeNostrPubkey(cmd.bossPubkey) },
        { name: "verifier_nostr_pubkey", type: "vector<u8>", value: decodeNostrPubkey(cmd.verifierNostrPubkey) },
        { name: "arbitrator_sui_address", type: "address", value: cmd.arbitratorSuiAddress },
        { name: "payload_hash", type: "vector<u8>", value: hexToBytes(cmd.payloadHash) },
        { name: "acceptance_hash", type: "vector<u8>", value: hexToBytes(cmd.acceptanceHash) },
      ],
    };

    // 生成 sui client call 命令
    const bossNostrPubkey = cmd.bossPubkey; // 甲方 Nostr 公钥
    const paymentCoinId = "<PAYMENT_COIN_ID>"; // 用户需要替换为实际的支付 coin ID

    const suiCommandArgs = [
      "sui", "client", "call",
      "--package", packageId,
      "--module", "atep",
      "--function", "create_task",
      "--args",
      ensureHexPrefix(cmd.taskId),
      paymentCoinId,
      String(parseInt(cmd.expectedTtl) * 1000),
      ensureHexPrefix(bossNostrPubkey),
      ensureHexPrefix(cmd.verifierNostrPubkey),
      cmd.arbitratorSuiAddress,
      ensureHexPrefix(cmd.payloadHash),
      ensureHexPrefix(cmd.acceptanceHash),
      "0x6",
      "--gas-budget", "10000000"
    ];

    const suiCommand = suiCommandArgs.join(" ");

    const data = {
      task_id: cmd.taskId,
      payload_hash: cmd.payloadHash,
      acceptance_hash: cmd.acceptanceHash,

      // 格式 1: JSON 数据格式（用于程序化处理）
      json_format: {
        title: "【格式 1】JSON 数据格式 - 适用于程序化处理和 SDK 集成",
        sui_transaction: {
          description: "创建链上任务托管（调用 atep.move::create_task）",
          network: network,
          package_id: packageId,
          unsigned: suiTxData,
          note: "请在 Sui 钱包中选择支付 Coin 对象",
        },
      },

      // 格式 2: Sui CLI 命令格式（适用于手动执行）
      cli_format: {
        title: "【格式 2】Sui CLI 命令格式 - 适用于直接复制到终端执行",
        setup_command: "export PATH=\"$HOME/.local/bin:$PATH\"",
        sui_command: suiCommand,
        instructions: [
          "1. 替换 <PAYMENT_COIN_ID> 为实际的支付 coin 对象 ID",
          "2. 确保已升级 sui CLI 到最新版本",
          "3. 复制整个命令块到终端执行",
          "4. 执行后记录 task_object_id 和 tx_hash",
        ],
      },

      expected_ttl_seconds: parseInt(cmd.expectedTtl),
      verifier_nostr_pubkey: cmd.verifierNostrPubkey,
      arbitrator_sui_address: cmd.arbitratorSuiAddress,
      note: "执行后记录 task_object_id 和 tx_hash",
      next_step: "使用 prepare-announce 准备 Nostr 广播",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "prepare-escrow" });
  });

// ==================== 1.3 准备 Nostr 广播 ====================
// 
// 链上执行后，准备 Nostr 广播数据
//

program
  .command("prepare-announce")
  .description("【1.3】准备 Nostr 广播（链上执行后）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-name <name>", "任务名称")
  .requiredOption("--payload-hash <hash>", "任务内容哈希")
  .requiredOption("--acceptance-hash <hash>", "验收标准哈希")
  .requiredOption("--pubkey <hex>", "甲方 Nostr 公钥（作为事件 pubkey）")
  .requiredOption("--expected-ttl <seconds>", "预期完成时长（秒）")
  .requiredOption("--verifier <pubkey>", "仲裁员 Nostr 公钥")
  .requiredOption("--bid-closing <seconds>", "竞标窗口时长（秒）")
  .requiredOption("--reward-amount <amount>", "奖励金额")
  .requiredOption("--task-object-id <id>", "链上任务对象 ID（执行 escrow 后获得）")
  .requiredOption("--tx-hash <hash>", "链上交易哈希（执行 escrow 后获得）")
  .option("--arbitrator-sui-address <address>", "仲裁员 Sui 地址（可选）")
  .option("-o, --output <file>", "输出待签名数据到文件")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.ANNOUNCEMENT,
      pubkey: cmd.pubkey,
      payload: {
        task_id: cmd.taskId,
        task_name: cmd.taskName,
        payload_hash: cmd.payloadHash,
        acceptance_hash: cmd.acceptanceHash,
        expected_ttl_seconds: parseInt(cmd.expectedTtl),
        verifier: [cmd.verifier],
        bid_closing_seconds: parseInt(cmd.bidClosing),
        amount: cmd.rewardAmount,
        asset: "SUI",
        sui_object_id: cmd.taskObjectId,
        tx_hash: cmd.txHash,
        arbitrator_sui_address: cmd.arbitratorSuiAddress,
      },
    });

    const data = {
      task_id: cmd.taskId,
      task_name: cmd.taskName,
      payload_hash: cmd.payloadHash,
      acceptance_hash: cmd.acceptanceHash,
      expected_ttl_seconds: parseInt(cmd.expectedTtl),
      verifier: cmd.verifier,
      bid_closing_seconds: parseInt(cmd.bidClosing),
      reward_amount: cmd.rewardAmount,
      task_object_id: cmd.taskObjectId,
      tx_hash: cmd.txHash,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "使用 Nostr 客户端（如 nos2x）签名并广播此事件",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "prepare-announce" });
  });

// ==================== 1.4 甲方取消任务（链上）====================
// 
// 甲方在任务 Open 状态且未锁定前取消任务，退还资金
//

program
  .command("prepare-cancel-task-escrow")
  .description("【1.4】准备链上取消任务交易（甲方取消，先执行 Sui）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      try {
        const response = await fetch(`${indexerUrl}/tasks/${cmd.taskId}`);
        const taskData = await response.json() as {
          error?: string;
          status?: string;
          is_open?: boolean;
          is_locked?: boolean;
          is_cancelled?: boolean;
          is_completed?: boolean;
        };

        if (!taskData || taskData.error) {
          checkWarnings.push(`任务 ${cmd.taskId} 在索引器中未找到`);
        } else {
          // 检查 1: 任务必须处于 Open 状态且未锁定
          if (!taskData.is_open) {
            checkWarnings.push(`任务不处于 Open 状态`);
          }
          if (taskData.is_locked) {
            checkWarnings.push(`任务已被锁定，无法取消`);
          }
          if (taskData.is_cancelled) {
            checkWarnings.push(`任务已取消`);
          }
          if (taskData.is_completed) {
            checkWarnings.push(`任务已完成`);
          }
        }

        if (checkWarnings.length === 0) {
          console.log(`✓ 任务状态检查通过，可以取消`);
        } else {
          console.warn(`⚠ 状态检查警告:`, checkWarnings.join("; "));
          console.warn(`⚠ 仍生成取消数据，请自行决定是否执行`);
        }
      } catch (error: any) {
        checkWarnings.push(`索引器查询失败: ${error.message}`);
        console.warn(`⚠ 无法检查任务状态:`, error.message);
        console.warn(`⚠ 仍生成取消数据，请自行决定是否执行`);
      }
    }

    const suiTxData = {
      description: "取消任务（调用 atep.move::cancel_task）",
      function: `${process.env.SUI_PACKAGE_ID}::task::cancel_task`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      note: "执行成功后资金退回甲方，然后使用 prepare-cancel-task-announce 准备 Nostr 广播（如任务已广播）",
      next_step: "prepare-cancel-task-announce（如任务已在 Nostr 广播）",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "cancel-task-escrow" });
  });

// ==================== 1.5 甲方取消任务（Nostr 广播）====================
// 
// 如果任务已在 Nostr 广播，需要广播取消公告
//

program
  .command("prepare-cancel-task-announce")
  .description("【1.5】准备取消公告 Nostr 事件（链上成功后，如任务已广播）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("--tx-hash <hash>", "链上取消交易哈希（推荐提供，用于去中心化验证）")
  .option("--reason <reason>", "取消原因", "甲方主动取消")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: CancellationRefundPayload = {
      task_id: cmd.taskId,
      sui_object_id: cmd.taskObjectId,
      reason: cmd.reason || "任务取消",
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.CANCELLATION_REFUND,
      pubkey: cmd.bossPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      boss_pubkey: cmd.bossPubkey,
      cancel_reason: cmd.reason,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后通知网络任务已取消（仅在任务已 Nostr 广播时需要）",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "cancel-task-announce" });
  });

// ==================== 1.6 竞标超时过期（链上）====================
// 
// 招标期超时后任务自动过期，任意人可调用，资金退回甲方
//

program
  .command("prepare-expire-task-escrow")
  .description("【1.6】准备链上竞标超时过期交易（招标期超时，任意人可调用）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      try {
        const response = await fetch(`${indexerUrl}/tasks/${cmd.taskId}`);
        const taskData = await response.json() as {
          error?: string;
          status?: string;
          is_open?: boolean;
          is_locked?: boolean;
          is_cancelled?: boolean;
          is_completed?: boolean;
          timeout_ms?: number;
        };

        if (!taskData || taskData.error) {
          checkWarnings.push(`任务 ${cmd.taskId} 在索引器中未找到`);
        } else {
          // 检查 1: 任务必须处于 Open 状态且未锁定
          if (!taskData.is_open) {
            checkWarnings.push(`任务不处于 Open 状态`);
          }
          if (taskData.is_locked) {
            checkWarnings.push(`任务已被锁定，无法过期`);
          }
          if (taskData.is_cancelled) {
            checkWarnings.push(`任务已取消`);
          }
          if (taskData.is_completed) {
            checkWarnings.push(`任务已完成`);
          }
          // 检查 2: 招标期必须已超时
          if (taskData.timeout_ms && SimpleTimeUtils.nowMs() <= taskData.timeout_ms) {
            checkWarnings.push(`招标期尚未超时（截止: ${taskData.timeout_ms}, 当前: ${SimpleTimeUtils.nowMs()}）`);
          }
        }

        if (checkWarnings.length === 0) {
          console.log(`✓ 任务状态检查通过，可以执行过期操作`);
        } else {
          console.warn(`⚠ 状态检查警告:`, checkWarnings.join("; "));
          console.warn(`⚠ 仍生成过期数据，请自行决定是否执行`);
        }
      } catch (error: any) {
        checkWarnings.push(`索引器查询失败: ${error.message}`);
        console.warn(`⚠ 无法检查任务状态:`, error.message);
        console.warn(`⚠ 仍生成过期数据，请自行决定是否执行`);
      }
    }

    const suiTxData = {
      description: "任务过期（调用 atep.move::expire_task）",
      function: `${process.env.SUI_PACKAGE_ID}::task::expire_task`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      note: "执行成功后资金退回甲方，然后使用 prepare-expire-task-announce 准备 Nostr 广播（如任务已广播）",
      next_step: "prepare-expire-task-announce（如任务已在 Nostr 广播）",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "expire-task-escrow" });
  });

// ==================== 1.7 竞标超时过期（Nostr 广播）====================
// 
// 如果任务已在 Nostr 广播，需要广播过期公告
//

program
  .command("prepare-expire-task-announce")
  .description("【1.7】准备过期公告 Nostr 事件（链上成功后，如任务已广播）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("--tx-hash <hash>", "链上过期交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: ExpirationPayload = {
      task_id: cmd.taskId,
      sui_object_id: cmd.taskObjectId,
      expired_at_seconds: Math.floor(SimpleTimeUtils.nowMs() / 1000),
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.EXPIRATION,
      pubkey: cmd.bossPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      boss_pubkey: cmd.bossPubkey,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后通知网络任务因招标期超时已过期（仅在任务已 Nostr 广播时需要）",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "expire-task-announce" });
  });

// ==================== 第7组：通用工具命令（广播）====================
// 
// 所有 prepare-*-announce 命令生成的已签名事件，最终都通过此命令广播
// 到 Nostr 中继器，使网络中的其他节点（包括索引器）能够接收和验证。
//

program
  .command("submit-signed")
  .description("【7.1】提交已签名 Nostr 事件（广播到中继器）")
  .option("-i, --input <json>", "已签名 JSON 数据")
  .option("-f, --input-file <path>", "已签名 JSON 文件路径")
  .action(async () => {
    const opts = program.opts<CliOptions>();
    
    // 加载已签名数据
    const signedData = await loadJsonInput<{
      task_id: string;
      nostr_event: { signed: any };
    }>(opts);

    const opts2 = program.opts<CliOptions>();

    // 广播 Nostr 事件
    const relayUrl = getRelayUrl(opts2.relayUrl);
    await broadcastNostrEvent(signedData.nostr_event.signed, relayUrl);

    emit({
      ok: true,
      data: {
        task_id: signedData.task_id,
        nostr_event_id: signedData.nostr_event.signed.id,
        message: "Nostr 任务公告已广播",
        note: "任务已发布，请通过 query 命令关注竞标情况",
      }
    }, opts.output ?? "jsonl");
  });

// ==================== 第2组：竞标与锁定流程（乙方）====================
// 任务竞标 → 甲方锁定 → 开始执行

// ==================== 2.1 准备竞标 ====================
// 
// 乙方参与任务竞标，举手示意可以完成任务
//

program
  .command("prepare-bid")
  .description("【2.1】准备竞标数据（乙方举手）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .requiredOption("--worker-sui-address <address>", "乙方 Sui 地址")
  .option("--capability-proof <proof>", "能力证明（可选）")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      const result = await checkTaskStatus(indexerUrl, cmd.taskId, {
        expectedStatus: ["BIDDING"],
        checkBidClosing: true,
      });
      checkWarnings = result.warnings;
      
      // 额外检查：是否已有执行者被锁定
      if (result.taskData && (result.taskData.worker_pubkey || result.taskData.locked_at)) {
        checkWarnings.push(`任务已被锁定给乙方 ${result.taskData.worker_pubkey}`);
      }
      
      printCheckResult(checkWarnings, "竞标");
    }
    
    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.BID,
      pubkey: cmd.workerPubkey,
      payload: {
        task_id: cmd.taskId,
        worker_sui_address: cmd.workerSuiAddress,
        capability_proof: cmd.capabilityProof,
      },
    });

    const unsignedData = {
      task_id: cmd.taskId,
      worker_pubkey: cmd.workerPubkey,
      worker_sui_address: cmd.workerSuiAddress,
      capability_proof: cmd.capabilityProof || null,
      nostr_event: {
        description: "使用 Nostr 客户端签名",
        unsigned: nostrEvent,
      },
    };

    outputResult(unsignedData, cmd.output, opts.output ?? "jsonl", { operation: "bid" });
  });

// ==================== 2.2 锁定步骤1：链上锁定 ====================
// 
// 甲方锁定任务，指定乙方
//

program
  .command("prepare-lock-escrow")
  .description("【2.2】准备链上锁定交易（先执行 Sui）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方公钥")
  .requiredOption("--worker-sui-address <address>", "乙方 Sui 地址")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      // 1. 基础任务状态检查
      const result = await checkTaskStatus(indexerUrl, cmd.taskId, {
        expectedStatus: ["BIDDING"],
      });
      checkWarnings = result.warnings;
      
      // 额外检查：是否已有执行者被锁定
      if (result.taskData && (result.taskData.worker_pubkey || result.taskData.locked_at)) {
        checkWarnings.push(`任务已被锁定给乙方 ${result.taskData.worker_pubkey}`);
      }
      
      // 2. 检查乙方是否在竞标列表中
      try {
        const bidsResponse = await fetch(`${indexerUrl}/tasks/${cmd.taskId}/bids`);
        const bids = await bidsResponse.json() as Array<{
          worker_pubkey: string;
          worker_sui_address: string;
        }>;

        const matchingBid = bids.find(b => 
          b.worker_pubkey === cmd.workerPubkey && 
          b.worker_sui_address === cmd.workerSuiAddress
        );

        if (!matchingBid) {
          checkWarnings.push(`指定的乙方不在竞标列表中（pubkey 或 sui_address 不匹配）`);
        }
      } catch (error: any) {
        checkWarnings.push(`竞标列表查询失败: ${error.message}`);
      }
      
      printCheckResult(checkWarnings, "锁定");
    }

    const suiTxData = {
      description: "锁定任务，指定乙方（调用 atep.move::lock_task）",
      function: `${process.env.SUI_PACKAGE_ID}::task::lock_task`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
        { name: "worker_pubkey", type: "vector<u8>", value: decodeNostrPubkey(cmd.workerPubkey) },
        { name: "worker_sui_address", type: "address", value: cmd.workerSuiAddress },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      worker_pubkey: cmd.workerPubkey,
      worker_sui_address: cmd.workerSuiAddress,
      note: "执行成功后记录交易哈希，然后使用 prepare-lock-announce 准备 Nostr 广播",
      next_step: "prepare-lock-announce",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "lock-escrow" });
  });

program
  .command("prepare-lock-announce")
  .description("【2.3】准备锁定公告 Nostr 事件（链上成功后）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方公钥")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥（用于签名事件）")
  .option("--tx-hash <hash>", "链上锁定交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: SelectionLockPayload = {
      task_id: cmd.taskId,
      selected_pubkey: cmd.workerPubkey,
      lock_sig: "lock_signature_placeholder",
      start_time_seconds: Math.floor(SimpleTimeUtils.nowMs() / 1000),
      sui_object_id: cmd.taskObjectId,
    };

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.SELECTION_LOCK,
      pubkey: cmd.bossPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      worker_pubkey: cmd.workerPubkey,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后乙方可以开始执行任务",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "lock-announce" });
  });

// ==================== 任务生命周期命令（纯服务准备模式）====================

// ==================== 3.2 甲方验收步骤（接受完成）====================
//
// 3.2.1 确认完成（链上）
//

program
  .command("prepare-complete-escrow")
  .description("【3.2.1】准备链上确认完成交易（先执行 Sui）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      const result = await checkTaskStatus(indexerUrl, cmd.taskId, {
        expectedStatus: ["DELIVERED", "LOCKED"],
        checkDeadline: true,
        checkDeliverySubmitted: true,
      });
      checkWarnings = result.warnings;
      printCheckResult(checkWarnings, "确认完成");
    }

    const suiTxData = {
      description: "确认任务完成（调用 atep.move::review_delivery）",
      function: `${process.env.SUI_PACKAGE_ID}::task::review_delivery`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
        { name: "review_result", type: "bool", value: true, description: "true=接受完成, false=拒绝" },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      boss_pubkey: cmd.bossPubkey,
      note: "执行成功后记录交易哈希，然后使用 prepare-complete-announce 准备 Nostr 广播",
      next_step: "prepare-complete-announce",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "complete-escrow" });
  });

program
  .command("prepare-complete-announce")
  .description("【3.2.2】准备完成公告 Nostr 事件（链上成功后）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥（用于验证）")
  .option("--tx-hash <hash>", "链上确认完成交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: TaskFinalizationPayload = {
      task_id: cmd.taskId,
      status: "success",
      sui_object_id: cmd.taskObjectId,
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.FINALIZATION,
      pubkey: cmd.bossPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      boss_pubkey: cmd.bossPubkey,
      worker_pubkey: cmd.workerPubkey,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后任务正式完成，乙方可以收款",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "complete-announce" });
  });

// ==================== 3.3 甲方验收步骤（拒绝交付）====================
//
// 3.3.1 拒绝交付（链上）
//

program
  .command("prepare-reject-escrow")
  .description("【3.3.1】准备链上拒绝交付交易（先执行 Sui）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("--reason <reason>", "拒绝原因", "交付不符合要求")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      const result = await checkTaskStatus(indexerUrl, cmd.taskId, {
        expectedStatus: ["DELIVERED", "LOCKED"],
        checkDeadline: true,
        checkDeliverySubmitted: true,
      });
      checkWarnings = result.warnings;
      printCheckResult(checkWarnings, "拒绝交付");
    }

    const suiTxData = {
      description: "拒绝交付（调用 atep.move::review_delivery，review_result=false）",
      function: `${process.env.SUI_PACKAGE_ID}::task::review_delivery`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
        { name: "review_result", type: "bool", value: false, description: "false=拒绝交付" },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      boss_pubkey: cmd.bossPubkey,
      reject_reason: cmd.reason,
      note: "执行成功后记录交易哈希，然后使用 prepare-reject-announce 准备 Nostr 广播",
      next_step: "prepare-reject-announce",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "reject-escrow" });
  });

program
  .command("prepare-reject-announce")
  .description("【3.3.2】准备拒绝公告 Nostr 事件（链上成功后）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥（用于验证）")
  .option("--reason <reason>", "拒绝原因", "交付不符合要求")
  .option("--tx-hash <hash>", "链上拒绝交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: TaskFinalizationPayload = {
      task_id: cmd.taskId,
      status: "rejected",
      sui_object_id: cmd.taskObjectId,
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.FINALIZATION,
      pubkey: cmd.bossPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      boss_pubkey: cmd.bossPubkey,
      worker_pubkey: cmd.workerPubkey,
      reject_reason: cmd.reason,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后任务变为 REJECTED 状态，乙方可以：1)接受拒绝，2)发起仲裁",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "reject-announce" });
  });

// ==================== 3.4.1 乙方主动退款（链上）====================
//
// 乙方主动放弃任务，全额退款给甲方
//

program
  .command("prepare-refund-by-worker-escrow")
  .description("【3.4.1】准备乙方主动退款（乙方放弃任务）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .option("--reason <reason>", "主动放弃原因", "乙方主动放弃任务")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const suiTxData = {
      description: "乙方主动退款（调用 atep.move::refund_by_worker）",
      function: `${process.env.SUI_PACKAGE_ID}::task::refund_by_worker`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
        { name: "worker_nostr_pubkey", type: "bytes", value: cmd.workerPubkey },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      note: "执行成功后资金全额退回甲方，然后使用 prepare-refund-by-worker-announce 准备 Nostr 广播（如任务已广播）",
      next_step: "prepare-refund-by-worker-announce（如任务已在 Nostr 广播）",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "refund-by-worker-escrow" });
  });

// ==================== 3.4.2 乙方主动退款公告（Nostr 广播）====================
//
// 如果任务已在 Nostr 广播，需要广播乙方主动退款公告
//

program
  .command("prepare-refund-by-worker-announce")
  .description("【3.4.2】准备乙方主动退款公告 Nostr 事件（链上成功后，如任务已广播）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .option("--reason <reason>", "主动放弃原因", "乙方主动放弃任务")
  .option("--tx-hash <hash>", "链上退款交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: WorkerRefundPayload = {
      task_id: cmd.taskId,
      sui_object_id: cmd.taskObjectId,
      reason: cmd.reason || "乙方主动放弃任务",
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.WORKER_REFUND,
      pubkey: cmd.workerPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      worker_pubkey: cmd.workerPubkey,
      refund_reason: cmd.reason,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后通知网络任务因乙方主动放弃已退款（仅在任务已 Nostr 广播时需要）",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "refund-by-worker-announce" });
  });

program
  .command("prepare-submit-escrow")
  .description("【交付步骤1】准备链上提交交付交易（先执行 Sui）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      const result = await checkTaskStatus(indexerUrl, cmd.taskId, {
        expectedStatus: ["LOCKED"],
        checkLockedWorker: cmd.workerPubkey,
        checkDeliverySubmitted: false, // 检查未提交
        checkExpectedTtl: true,
      });
      checkWarnings = result.warnings;
      printCheckResult(checkWarnings, "提交交付");
    }

    const suiTxData = {
      description: "提交交付证明（调用 atep.move::submit_delivery）",
      function: `${process.env.SUI_PACKAGE_ID}::task::submit_delivery`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      worker_pubkey: cmd.workerPubkey,
      note: "执行成功后记录交易哈希，然后使用 prepare-submit-announce 准备 Nostr 广播",
      next_step: "prepare-submit-announce",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "submit-escrow" });
  });

program
  .command("prepare-submit-announce")
  .description("【3.1.2】准备交付公告 Nostr 事件（链上成功后）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .requiredOption("--delivery-hash <hash>", "交付文件哈希（如 SHA-256）")
  .option("--tx-hash <hash>", "链上交付交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: ProofOfTaskPayload = {
      task_id: cmd.taskId,
      delivery_hash: cmd.deliveryHash,
      timestamp_seconds: Math.floor(SimpleTimeUtils.nowMs() / 1000),
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.PROOF_OF_TASK,
      pubkey: cmd.workerPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      worker_pubkey: cmd.workerPubkey,
      delivery_hash: cmd.deliveryHash,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后甲方可以查看交付并进行验收",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "submit-announce" });
  });

// ==================== 第5组：超时处理流程 ====================
// 交付超时 / 验收超时 / 回应超时

// ==================== 3.4.1 交付超时认领（链上）====================
//
// 乙方未按时交付，甲方认领资金
//

program
  .command("prepare-claim-delivery-timeout-escrow")
  .description("【3.4.1】准备交付超时认领（乙方未按时交付）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    // Nostr 事件
    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.CANCELLATION_REFUND,
      pubkey: cmd.bossPubkey,
      payload: {
        task_id: cmd.taskId,
        reason: "delivery_timeout",
        sui_object_id: cmd.taskObjectId,
      },
    });

    // Sui 交易数据
    const suiTxData = {
      function: `${process.env.SUI_PACKAGE_ID}::task::claim_delivery_timeout`,
      arguments: [cmd.taskObjectId],
    };

    const unsignedData = {
      task_id: cmd.taskId,
      nostr_event: { unsigned: nostrEvent },
      sui_transaction: { unsigned: suiTxData },
    };

    outputResult(unsignedData, cmd.output, opts.output ?? "jsonl", { operation: "claim-delivery-timeout-escrow" });
  });

// ==================== 3.4.2 交付超时公告（Nostr 广播）====================
//
// 如果任务已在 Nostr 广播，需要广播交付超时公告
//

program
  .command("prepare-claim-delivery-timeout-announce")
  .description("【3.4.2】准备交付超时公告 Nostr 事件（链上成功后，如任务已广播）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("--tx-hash <hash>", "链上交付超时交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: CancellationRefundPayload = {
      task_id: cmd.taskId,
      sui_object_id: cmd.taskObjectId,
      reason: "delivery_timeout",
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.CANCELLATION_REFUND,
      pubkey: cmd.bossPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      boss_pubkey: cmd.bossPubkey,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后通知网络任务因乙方未按时交付已超时（仅在任务已 Nostr 广播时需要）",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "claim-delivery-timeout-announce" });
  });

// ==================== 3.5.1 验收超时认领（链上）====================
//
// 甲方未按时验收，乙方自动收款
//

program
  .command("prepare-claim-review-timeout-escrow")
  .description("【3.5.1】准备验收超时收款（甲方未在验收期验收）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    // Nostr 事件 - 使用 CANCELLATION_REFUND 表示超时自动完成
    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.CANCELLATION_REFUND,
      pubkey: cmd.workerPubkey,
      payload: {
        task_id: cmd.taskId,
        reason: "review_timeout_auto_complete",
        sui_object_id: cmd.taskObjectId,
      },
    });

    // Sui 交易数据
    const suiTxData = {
      function: `${process.env.SUI_PACKAGE_ID}::task::claim_review_timeout`,
      arguments: [cmd.taskObjectId],
    };

    const unsignedData = {
      task_id: cmd.taskId,
      nostr_event: { unsigned: nostrEvent },
      sui_transaction: { unsigned: suiTxData },
    };

    outputResult(unsignedData, cmd.output, opts.output ?? "jsonl", { operation: "claim-review-timeout-escrow" });
  });

// ==================== 3.5.2 验收超时公告（Nostr 广播）====================
//
// 如果任务已在 Nostr 广播，需要广播验收超时公告
//

program
  .command("prepare-claim-review-timeout-announce")
  .description("【3.5.2】准备验收超时公告 Nostr 事件（链上成功后，如任务已广播）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .option("--tx-hash <hash>", "链上验收超时交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: ReviewTimeoutCompletionPayload = {
      task_id: cmd.taskId,
      sui_object_id: cmd.taskObjectId,
      completed_at_seconds: Math.floor(SimpleTimeUtils.nowMs() / 1000),
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.REVIEW_TIMEOUT_COMPLETION,
      pubkey: cmd.workerPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      worker_pubkey: cmd.workerPubkey,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后通知网络任务因甲方未按时验收已自动完成（仅在任务已 Nostr 广播时需要）",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "claim-review-timeout-announce" });
  });

// ==================== 第6组：其他操作 ====================

// ==================== 6.1 取消任务 ====================

program
  .command("prepare-cancel")
  .description("【6.1】准备取消任务数据")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("--reason <reason>", "取消原因", "甲方主动取消")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    // Nostr 事件
    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.CANCELLATION_REFUND,
      pubkey: cmd.bossPubkey,
      payload: {
        task_id: cmd.taskId,
        reason: cmd.reason,
        sui_object_id: cmd.taskObjectId,
      },
    });

    // Sui 交易数据
    const suiTxData = {
      function: `${process.env.SUI_PACKAGE_ID}::task::cancel_task`,
      arguments: [cmd.taskObjectId],
    };

    const unsignedData = {
      task_id: cmd.taskId,
      nostr_event: { unsigned: nostrEvent },
      sui_transaction: { unsigned: suiTxData },
    };

    outputResult(unsignedData, cmd.output, opts.output ?? "jsonl", { operation: "cancel" });
  });

program
  .command("prepare-accept-rejection-escrow")
  .description("【接受拒绝步骤1】准备链上接受拒绝交易（乙方接受拒绝，先执行 Sui）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      try {
        const response = await fetch(`${indexerUrl}/tasks/${cmd.taskId}`);
        const taskData = await response.json() as {
          error?: string;
          status?: string;
          is_locked?: boolean;
          delivery_submitted?: boolean;
          is_completed?: boolean;
          is_reviewed?: boolean;
          review_result?: boolean;
          has_responded?: boolean;
          review_time?: number;
          response_period?: number;
        };

        if (!taskData || taskData.error) {
          checkWarnings.push(`任务 ${cmd.taskId} 在索引器中未找到`);
        } else {
          // 检查 1: 已锁定、已交付、未完成、已验收且被拒绝
          if (!taskData.is_locked) {
            checkWarnings.push(`任务未锁定`);
          }
          if (!taskData.delivery_submitted) {
            checkWarnings.push(`乙方尚未提交交付`);
          }
          if (taskData.is_completed) {
            checkWarnings.push(`任务已完成`);
          }
          if (!taskData.is_reviewed) {
            checkWarnings.push(`甲方尚未验收`);
          }
          if (taskData.review_result !== false) {
            checkWarnings.push(`甲方未拒绝交付（review_result 不为 false）`);
          }

          // 检查 2: 是否已回应（不能重复回应）
          if (taskData.has_responded) {
            checkWarnings.push(`乙方已回应（可能已接受拒绝或发起仲裁）`);
          }

          // 检查 3: 是否在回应期内（拒绝时间 + 2小时）
          if (taskData.review_time && taskData.response_period) {
            const nowMs = SimpleTimeUtils.nowMs();
            const responseDeadlineMs = taskData.review_time + taskData.response_period;
            if (nowMs > responseDeadlineMs) {
              checkWarnings.push(`已超过回应截止时间（截止: ${responseDeadlineMs}, 当前: ${nowMs}）`);
            }
          }
        }

        if (checkWarnings.length === 0) {
          console.log(`✓ 任务状态检查通过，可以接受拒绝`);
        } else {
          console.warn(`⚠ 状态检查警告:`, checkWarnings.join("; "));
          console.warn(`⚠ 仍生成接受拒绝数据，请自行决定是否执行`);
        }
      } catch (error: any) {
        checkWarnings.push(`索引器查询失败: ${error.message}`);
        console.warn(`⚠ 无法检查任务状态:`, error.message);
        console.warn(`⚠ 仍生成接受拒绝数据，请自行决定是否执行`);
      }
    }

    const suiTxData = {
      description: "接受拒绝（调用 atep.move::accept_rejection）",
      function: `${process.env.SUI_PACKAGE_ID}::task::accept_rejection`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      worker_pubkey: cmd.workerPubkey,
      note: "执行成功后记录交易哈希，然后使用 prepare-accept-rejection-announce 准备 Nostr 广播",
      next_step: "prepare-accept-rejection-announce",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "accept-rejection-escrow" });
  });

program
  .command("prepare-accept-rejection-announce")
  .description("【4.1.2】准备接受拒绝公告 Nostr 事件（链上成功后）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .option("--boss-pubkey <pubkey>", "甲方 Nostr 公钥（用于验证）")
  .option("--tx-hash <hash>", "链上接受拒绝交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: CancellationRefundPayload = {
      task_id: cmd.taskId,
      reason: "worker_accepted_rejection",
      sui_object_id: cmd.taskObjectId,
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.CANCELLATION_REFUND,
      pubkey: cmd.workerPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      worker_pubkey: cmd.workerPubkey,
      boss_pubkey: cmd.bossPubkey || null,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后任务正式关闭，资金退回甲方",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "accept-rejection-announce" });
  });

program
  .command("prepare-claim-response-timeout-escrow")
  .description("【新】准备回应超时退款（乙方未回应甲方的拒绝）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    // Nostr 事件
    const payload: CancellationRefundPayload = {
      task_id: cmd.taskId,
      reason: "response_timeout",
      sui_object_id: cmd.taskObjectId,
    };

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.CANCELLATION_REFUND,
      pubkey: cmd.bossPubkey,
      payload,
    });

    // Sui 交易数据
    const suiTxData = {
      function: `${process.env.SUI_PACKAGE_ID}::task::claim_response_timeout`,
      arguments: [cmd.taskObjectId],
    };

    const unsignedData = {
      task_id: cmd.taskId,
      nostr_event: { unsigned: nostrEvent },
      sui_transaction: { unsigned: suiTxData },
    };

    outputResult(unsignedData, cmd.output, opts.output ?? "jsonl", { operation: "claim-response-timeout-escrow" });
  });

// ==================== 4.4.2 回应超时公告（Nostr 广播）====================
//
// 如果任务已在 Nostr 广播，需要广播回应超时公告
//

program
  .command("prepare-claim-response-timeout-announce")
  .description("【4.4.2】准备回应超时公告 Nostr 事件（链上成功后，如任务已广播）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("--tx-hash <hash>", "链上回应超时交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: CancellationRefundPayload = {
      task_id: cmd.taskId,
      sui_object_id: cmd.taskObjectId,
      reason: "response_timeout",
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.CANCELLATION_REFUND,
      pubkey: cmd.bossPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      boss_pubkey: cmd.bossPubkey,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后通知网络任务因乙方未回应拒绝已超时（仅在任务已 Nostr 广播时需要）",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "claim-response-timeout-announce" });
  });

// ==================== 第4组：仲裁流程（乙方/仲裁员）====================
// 拒绝 → 接受拒绝 / 发起仲裁 → 裁决

// ==================== 4.1 乙方接受拒绝 ====================
//
// 4.1.1 接受拒绝（链上）
//
// 跳过重复定义，使用上面的定义

// ==================== 4.2 乙方发起仲裁 ====================
//
// 4.2.1 发起仲裁（链上）
//

program
  .command("prepare-initiate-arbitration-escrow")
  .description("【4.2.1】准备链上发起仲裁交易（乙方发起，先执行 Sui）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      const result = await checkTaskStatus(indexerUrl, cmd.taskId, {
        checkIsLocked: true,
        checkDeliverySubmitted: true,
        checkIsCompleted: true,
        checkIsReviewed: true,
        checkReviewResult: false, // 检查是否被拒绝
        checkHasResponded: true, // 检查是否已回应（不应该已回应）
        checkIsInArbitration: false, // 检查不在仲裁中
        checkResponseDeadline: true, // 检查回应期
      });
      checkWarnings = result.warnings;
      printCheckResult(checkWarnings, "发起仲裁");
    }

    const suiTxData = {
      description: "发起仲裁（调用 atep.move::initiate_arbitration）",
      function: `${process.env.SUI_PACKAGE_ID}::task::initiate_arbitration`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      worker_pubkey: cmd.workerPubkey,
      note: "执行成功后记录交易哈希，然后使用 prepare-initiate-arbitration-announce 准备 Nostr 广播",
      next_step: "prepare-initiate-arbitration-announce",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "initiate-arbitration-escrow" });
  });

program
  .command("prepare-initiate-arbitration-announce")
  .description("【4.2.2】准备发起仲裁公告 Nostr 事件（链上成功后）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .option("--task-name <name>", "任务名称（从 ANNOUNCEMENT 事件获取）")
  .option("--payload-hash <hash>", "任务内容哈希（从 ANNOUNCEMENT 事件获取）")
  .option("--delivery-hash <hash>", "交付内容哈希（从 PROOF_OF_TASK 事件获取）")
  .option("--verifier <pubkeys...>", "仲裁员公钥列表（从 ANNOUNCEMENT 事件获取）")
  .option("--evidence <hashes...>", "争议证据哈希列表")
  .option("--dispute-reason <reason>", "争议原因", "rejection_disputed")
  .option("--boss-pubkey <pubkey>", "甲方 Nostr 公钥（用于验证）")
  .option("--tx-hash <hash>", "链上发起仲裁交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: DisputeInitiationPayload = {
      task_id: cmd.taskId,
      task_name: cmd.taskName || "",
      payload_hash: cmd.payloadHash || "",
      verifier: cmd.verifier || [],
      evidence_list: cmd.evidence || [],
      dispute_reason: cmd.disputeReason,
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.DISPUTE_INITIATION,
      pubkey: cmd.workerPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      worker_pubkey: cmd.workerPubkey,
      boss_pubkey: cmd.bossPubkey || null,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "广播后任务进入仲裁状态，等待仲裁员裁决",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "initiate-arbitration-announce" });
  });

// ==================== 4.3 仲裁员裁决 ====================
//
// 4.3.1 仲裁裁决（链上）
//

program
  .command("prepare-resolve-arbitration-escrow")
  .description("【4.3.1】准备链上仲裁裁决交易（仲裁员执行，先执行 Sui）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--winner-pubkey <hex>", "胜方 Nostr 公钥（hex，甲方或乙方）")
  .requiredOption("--verifier-pubkey <hex>", "仲裁员 Nostr 公钥（hex）")
  .requiredOption("--boss-pubkey <hex>", "甲方 Nostr 公钥")
  .requiredOption("--worker-pubkey <hex>", "乙方 Nostr 公钥")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 验证胜方公钥必须是甲方或乙方之一
    const winnerIsBoss = cmd.winnerPubkey.toLowerCase() === cmd.bossPubkey.toLowerCase();
    const winnerIsWorker = cmd.winnerPubkey.toLowerCase() === cmd.workerPubkey.toLowerCase();
    if (!winnerIsBoss && !winnerIsWorker) {
      console.warn(`⚠ 警告: 胜方公钥既不是甲方也不是乙方，合约将拒绝执行`);
    }

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      const result = await checkTaskStatus(indexerUrl, cmd.taskId, {
        checkIsInArbitration: true,
        checkIsCompleted: true,
      });
      checkWarnings = result.warnings;

      // 额外检查：胜方公钥是否匹配任务记录的甲方/乙方
      if (result.taskData && result.taskData.worker_pubkey) {
        const dataWinner = cmd.winnerPubkey.toLowerCase();
        const dataBoss = (result.taskData as any).boss_pubkey?.toLowerCase();
        const dataWorker = result.taskData.worker_pubkey.toLowerCase();
        if (dataWinner !== dataBoss && dataWinner !== dataWorker) {
          checkWarnings.push(`胜方公钥与任务记录的甲方/乙方不匹配`);
        }
      }

      // 额外检查：仲裁期是否已超时
      if (result.taskData && result.taskData.arbitration_initiated_at && (result.taskData as any).arbitration_period) {
        const nowMs = SimpleTimeUtils.nowMs();
        const arbitrationDeadlineMs = result.taskData.arbitration_initiated_at + (result.taskData as any).arbitration_period;
        if (nowMs > arbitrationDeadlineMs) {
          checkWarnings.push(`已超过仲裁裁决截止时间（截止: ${arbitrationDeadlineMs}, 当前: ${nowMs}）`);
        }
      }

      printCheckResult(checkWarnings, "仲裁裁决");
    }

    const suiTxData = {
      description: "仲裁裁决（调用 atep.move::resolve_arbitration）",
      function: `${process.env.SUI_PACKAGE_ID}::task::resolve_arbitration`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
        { name: "winner_nostr_pubkey", type: "vector<u8>", value: decodeNostrPubkey(cmd.winnerPubkey), description: "胜方 Nostr 公钥（甲方或乙方）" },
        { name: "verifier_nostr_pubkey", type: "vector<u8>", value: decodeNostrPubkey(cmd.verifierPubkey), description: "仲裁员 Nostr 公钥" },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      winner_pubkey: cmd.winnerPubkey,
      winner_is_boss: winnerIsBoss,
      winner_is_worker: winnerIsWorker,
      verifier_pubkey: cmd.verifierPubkey,
      boss_pubkey: cmd.bossPubkey,
      worker_pubkey: cmd.workerPubkey,
      note: "执行成功后记录交易哈希，然后使用 prepare-resolve-arbitration-announce 准备 Nostr 广播",
      next_step: "prepare-resolve-arbitration-announce",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "resolve-arbitration-escrow" });
  });

program
  .command("prepare-resolve-arbitration-announce")
  .description("【4.3.2】准备仲裁裁决公告 Nostr 事件（链上成功后）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--winner-pubkey <hex>", "胜方 Nostr 公钥（hex）")
  .requiredOption("--verifier-pubkey <hex>", "仲裁员 Nostr 公钥（hex，用于广播）")
  .requiredOption("--boss-pubkey <hex>", "甲方 Nostr 公钥")
  .requiredOption("--worker-pubkey <hex>", "乙方 Nostr 公钥")
  .requiredOption("--arbitration-report-hash <hash>", "仲裁报告哈希")
  .option("--verdict-summary <summary>", "仲裁员总结（可选）")
  .option("--tx-hash <hash>", "链上仲裁裁决交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    // 推断败方
    const winnerIsBoss = cmd.winnerPubkey.toLowerCase() === cmd.bossPubkey.toLowerCase();
    const loserPubkey = winnerIsBoss ? cmd.workerPubkey : cmd.bossPubkey;

    const payload: ArbitrationResultPayload = {
      task_id: cmd.taskId,
      client_pubkey: cmd.bossPubkey,
      worker_pubkey: cmd.workerPubkey,
      winner_pubkey: cmd.winnerPubkey,
      loser_pubkey: loserPubkey,
      arbitration_report_hash: cmd.arbitrationReportHash,
      sui_object_id: cmd.taskObjectId,
    };

    if (cmd.verdictSummary) {
      payload.verdict_summary = cmd.verdictSummary;
    }

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.ARBITRATION_RESULT,
      pubkey: cmd.verifierPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      winner_pubkey: cmd.winnerPubkey,
      loser_pubkey: loserPubkey,
      winner_is_boss: winnerIsBoss,
      winner_is_worker: !winnerIsBoss,
      verifier_pubkey: cmd.verifierPubkey,
      boss_pubkey: cmd.bossPubkey,
      worker_pubkey: cmd.workerPubkey,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: winnerIsBoss ? "甲方胜诉：资金扣除仲裁费(5%)后，90%退回甲方，5%协议捐赠" : "乙方胜诉：资金扣除仲裁费(5%)后，90%支付给乙方，5%协议捐赠",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "resolve-arbitration-announce" });
  });

program
  .command("prepare-claim-arbitration-timeout-escrow")
  .description("【仲裁超时步骤1】准备链上仲裁超时认领交易（甲方调用，先执行 Sui）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥")
  .option("--skip-check", "跳过状态检查（不推荐）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    // 自动检查任务状态（除非用户明确跳过）
    let checkWarnings: string[] = [];
    if (!cmd.skipCheck) {
      const result = await checkTaskStatus(indexerUrl, cmd.taskId, {
        checkIsLocked: true,
        checkIsCompleted: true,
        checkIsInArbitration: true,
      });
      checkWarnings = result.warnings;

      // 额外检查：仲裁期已超时（当前时间 > 仲裁启动时间 + 24小时）
      if (result.taskData && result.taskData.arbitration_initiated_at && (result.taskData as any).arbitration_period) {
        const nowMs = SimpleTimeUtils.nowMs();
        const arbitrationDeadlineMs = result.taskData.arbitration_initiated_at + (result.taskData as any).arbitration_period;
        if (nowMs <= arbitrationDeadlineMs) {
          checkWarnings.push(`仲裁期尚未超时（截止: ${arbitrationDeadlineMs}, 当前: ${nowMs}）`);
        }
      }

      printCheckResult(checkWarnings, "仲裁超时认领");
    }

    const suiTxData = {
      description: "仲裁超时认领（调用 atep.move::claim_arbitration_timeout）",
      function: `${process.env.SUI_PACKAGE_ID}::task::claim_arbitration_timeout`,
      arguments: [
        { name: "task_object_id", type: "object", value: cmd.taskObjectId },
      ],
    };

    const data = {
      task_id: cmd.taskId,
      sui_transaction: {
        description: "使用 Sui Wallet 签名并执行",
        network: process.env.SUI_NETWORK || "devnet",
        package_id: process.env.SUI_PACKAGE_ID,
        unsigned: suiTxData,
      },
      boss_pubkey: cmd.bossPubkey,
      note: "执行成功后记录交易哈希，然后使用 prepare-claim-arbitration-timeout-announce 准备 Nostr 广播",
      next_step: "prepare-claim-arbitration-timeout-announce",
    };

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "claim-arbitration-timeout-escrow" });
  });

program
  .command("prepare-claim-arbitration-timeout-announce")
  .description("【4.4.2】准备仲裁超时认领公告 Nostr 事件（链上成功后）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--task-object-id <id>", "Sui Task object ID")
  .requiredOption("--boss-pubkey <pubkey>", "甲方 Nostr 公钥（用于广播）")
  .requiredOption("--worker-pubkey <pubkey>", "乙方 Nostr 公钥")
  .requiredOption("--verifier-pubkey <pubkey>", "仲裁员 Nostr 公钥（超时未裁决的仲裁员）")
  .option("--tx-hash <hash>", "链上认领交易哈希（推荐提供，用于去中心化验证）")
  .option("-o, --output <file>", "输出文件路径")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();

    const payload: ArbitrationTimeoutClaimPayload = {
      task_id: cmd.taskId,
      client_pubkey: cmd.bossPubkey,
      worker_pubkey: cmd.workerPubkey,
      verifier_pubkey: cmd.verifierPubkey,
      sui_object_id: cmd.taskObjectId,
      completion_type: 3, // COMPLETION_TYPE_ARBITRATION
      completion_reason: "arbitration_timeout",
    };

    if (cmd.txHash) {
      payload.tx_hash = cmd.txHash;
    }

    const nostrEvent = createTaskEvent({
      kind: TASK_KINDS.ARBITRATION_TIMEOUT_CLAIM,
      pubkey: cmd.bossPubkey,
      payload,
    });

    const data: Record<string, unknown> = {
      task_id: cmd.taskId,
      task_object_id: cmd.taskObjectId,
      boss_pubkey: cmd.bossPubkey,
      worker_pubkey: cmd.workerPubkey,
      verifier_pubkey: cmd.verifierPubkey,
      nostr_event: {
        description: "使用 Nostr 客户端签名并广播",
        unsigned: nostrEvent,
      },
      note: "资金分配：扣除协议捐赠(5%)后，剩余95%退回甲方",
    };

    if (cmd.txHash) {
      data.tx_hash = cmd.txHash;
    }

    outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "claim-arbitration-timeout-announce" });
  });

// ==================== 6.2 查询命令 ====================

program
  .command("query")
  .description("【6.2.1】查询任务状态信息（无需签名）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--indexer-url <url>", "索引器 URL（去中心化：请指定你信任的索引器或部署自己的索引器）")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl;

    const response = await fetch(`${indexerUrl}/tasks/${cmd.taskId}`);
    const data: any = await response.json();

    emit(data, opts.output ?? "jsonl");
  });

program
  .command("query-verifiers")
  .description("【6.2.2】查询仲裁员列表（无需签名）")
  .requiredOption("--indexer-url <url>", "索引器 URL（去中心化：请指定你信任的索引器或部署自己的索引器）")
  .option("-o, --output <file>", "输出到文件")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl;
    
    try {
      // 调用索引器 API 获取仲裁员白名单
      const response = await fetch(`${indexerUrl}/whitelist`);
      const result: any = await response.json();
      
      if (!result.ok || !result.data) {
        throw new Error('索引器响应格式错误');
      }
      
      const whitelistData = result.data;
      const verifiers = whitelistData.whitelist || [];
      const now = SimpleTimeUtils.nowSec();
      
      const data = {
        count: verifiers.length,
        total_count: whitelistData.total_count || verifiers.length,
        active_count: whitelistData.active_count || verifiers.length,
        last_updated: whitelistData.last_updated,
        source: whitelistData.source || 'indexer',
        verifiers: verifiers.map((v: any) => ({
          pubkey: v.pubkey,
          sui_address: v.sui_address || 'N/A',
          status: (now >= (v.effective_from || 0) && now < (v.expires_at || 0)) ? "有效" : "无效",
          effective_from: new Date((v.effective_from || 0) * 1000).toISOString(),
          expires_at: new Date((v.expires_at || 0) * 1000).toISOString(),
          added_at: new Date((v.added_at || 0) * 1000).toISOString(),
        })),
        note: "选择合适的仲裁员后，复制 pubkey 和 sui_address 到 prepare-escrow 命令",
        usage_example: "atep-cli prepare-escrow --verifier-nostr-pubkey <pubkey> --arbitrator-sui-address <address>",
      };

      outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "query-verifiers" });
    } catch (error: any) {
      // 如果索引器不可用，提供模拟数据（用于测试）
      const mockData = {
        count: 2,
        verifiers: [
          {
            pubkey: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
            sui_address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            status: "有效",
            effective_from: "2024-01-01T00:00:00.000Z",
            expires_at: "2025-12-31T23:59:59.000Z",
            added_at: "2024-01-01T00:00:00.000Z",
          },
          {
            pubkey: "f1e2d3c4b5a69788990011223344556677889900aabbccddeeff001122334455",
            sui_address: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
            status: "有效",
            effective_from: "2024-06-01T00:00:00.000Z",
            expires_at: "2025-05-31T23:59:59.000Z",
            added_at: "2024-06-01T00:00:00.000Z",
          },
        ],
        note: "【模拟数据】索引器未响应，以上为示例仲裁员。请连接实际索引器获取真实数据。",
        usage_example: "atep-cli prepare-escrow --verifier-nostr-pubkey <pubkey> --arbitrator-sui-address <address>",
      };

      outputResult(mockData, cmd.output, opts.output ?? "jsonl", { operation: "query-verifiers" });
    }
  });

program
  .command("query-bids")
  .description("【6.2.3】查询任务竞标列表（无需签名）")
  .requiredOption("--task-id <id>", "任务 ID")
  .requiredOption("--indexer-url <url>", "索引器 URL（去中心化：请指定你信任的索引器或部署自己的索引器）")
  .option("-o, --output <file>", "输出到文件")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl;
    
    try {
      // 调用索引器 API 获取竞标列表
      const response = await fetch(`${indexerUrl}/tasks/${cmd.taskId}/bids`);
      const bids = await response.json() as Array<{
        worker_pubkey: string;
        worker_sui_address: string;
        capability_proof?: string;
        bid_time: number;
        event_id: string;
      }>;

      const data = {
        task_id: cmd.taskId,
        count: bids.length,
        bids: bids.map(b => ({
          worker_pubkey: b.worker_pubkey,
          worker_sui_address: b.worker_sui_address,
          capability_proof: b.capability_proof || null,
          bid_time: new Date(b.bid_time * 1000).toISOString(),
          event_id: b.event_id,
        })),
        note: "选择合适的乙方后，复制 pubkey 和 sui_address 到 prepare-lock-escrow 命令",
        usage_example: "atep-cli prepare-lock-escrow --worker-pubkey <pubkey> --worker-sui-address <address>",
      };

      outputResult(data, cmd.output, opts.output ?? "jsonl", { operation: "query-bids" });
    } catch (error: any) {
      // 如果索引器不可用，提供模拟数据（用于测试）
      const mockData = {
        task_id: cmd.taskId,
        count: 2,
        bids: [
          {
            worker_pubkey: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
            worker_sui_address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            capability_proof: null,
            bid_time: "2024-01-15T10:30:00.000Z",
            event_id: "event001",
          },
          {
            worker_pubkey: "f1e2d3c4b5a69788990011223344556677889900aabbccddeeff001122334455",
            worker_sui_address: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
            capability_proof: "过往项目链接: https://github.com/user/project",
            bid_time: "2024-01-15T11:00:00.000Z",
            event_id: "event002",
          },
        ],
        note: "【模拟数据】索引器未响应，以上为示例竞标。请连接实际索引器获取真实数据。",
        usage_example: "atep-cli prepare-lock-escrow --worker-pubkey <pubkey> --worker-sui-address <address>",
      };

      outputResult(mockData, cmd.output, opts.output ?? "jsonl", { operation: "query-bids" });
    }
  });

// ==================== 第8组：配置管理命令 ====================

program
  .command("config")
  .description("【8.1】管理 CLI 配置（持久化存储默认参数）")
  .option("--set-relay <url>", "设置默认 Nostr 中继节点 URL")
  .option("--set-indexer <url>", "设置默认索引器 URL")
  .option("--show", "查看当前配置")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    
    if (cmd.show) {
      const config = loadConfig();
      emit({
        ok: true,
        data: {
          config_file: CONFIG_FILE,
          settings: config,
          note: "配置存储在 ~/.atep/config.json，可通过 --set-* 选项修改",
        }
      }, opts.output ?? "jsonl");
      return;
    }

    const config = loadConfig();
    let updated = false;

    if (cmd.setRelay) {
      config.relayUrl = cmd.setRelay;
      updated = true;
    }

    if (cmd.setIndexer) {
      config.indexerUrl = cmd.setIndexer;
      updated = true;
    }

    if (updated) {
      saveConfig(config);
      emit({
        ok: true,
        data: {
          config_file: CONFIG_FILE,
          settings: config,
          message: "配置已保存",
        }
      }, opts.output ?? "jsonl");
    } else {
      emit({
        ok: false,
        error: {
          code: "NO_ACTION",
          message: "未执行任何操作。请使用 --show 查看配置，或使用 --set-relay/--set-indexer 修改配置"
        }
      }, opts.output ?? "jsonl");
    }
  });

// ==================== 第7组：任务板 ====================
// 任务板提供实时任务状态查看和统计功能

// 获取状态图标
function getStatusIcon(status: string): string {
  const icons: { [key: string]: string } = {
    'ACTIVE': '🟢',
    'BIDDING': '🔵',
    'LOCKED': '🟡',
    'DELIVERED': '🟠',
    'COMPLETED': '✅',
    'CANCELLED': '❌'
  };
  return icons[status] || '⚪';
}

program
  .command("board")
  .description("【7.1】任务板 - 实时查看任务状态")
  .option("--list", "显示所有任务列表")
  .option("--biddable", "显示可竞标任务列表")
  .option("--my-tasks", "显示我的任务列表")
  .option("--pubkey <pubkey>", "用户公钥（查看我的任务时需要）")
  .option("--watch", "实时刷新任务板")
  .action(async (cmd: any) => {
    const opts = program.opts<CliOptions>();
    const indexerUrl = opts.indexerUrl ?? "https://indexer.atep.work";

    try {
      if (cmd.list) {
        // 显示所有任务列表
        console.log('📋 任务列表');
        console.log('='.repeat(30));
        console.log('task_id'.padEnd(18) + 'sui_object_id'.padEnd(18) + 'task_name'.padEnd(25) + 'reward_amount'.padEnd(15) + 'asset'.padEnd(8) + 'business_status');
        console.log('-'.repeat(103));
        
        try {
          // 从索引器获取任务列表
          const response = await fetch(`${indexerUrl}/tasks`);
          if (response.ok) {
            const result: any = await response.json();
            const tasks = result.data || result; // 处理不同的响应格式
            
            // 按创建时间排序（从大到小）
            tasks.sort((a: any, b: any) => b.created_at - a.created_at);
            
            if (tasks.length === 0) {
              console.log('📭 当前没有任务');
            } else {
              tasks.forEach((task: any) => {
                const statusIcon = getStatusIcon(task.business_status);
                const row = [
                  task.task_id.padEnd(18),
                  task.sui_object_id.padEnd(18),
                  (task.task_name || 'N/A').padEnd(25),
                  task.reward_amount.padEnd(15),
                  task.asset.padEnd(8),
                  statusIcon + task.business_status
                ];
                console.log(row.join(' '));
              });
            }
          } else {
            throw new Error('索引器请求失败');
          }
        } catch (error) {
          console.log('⚠️ 索引器不可用，显示模拟数据');
          
          // 模拟链上数据，按创建时间排序（从小到大）
          const tasks = [
            { task_id: 'task_001', sui_object_id: '0xobj001', task_name: '数据分析和报告', reward_amount: '1500000000', asset: 'SUI', business_status: 'COMPLETED', created_at: 1000 },
            { task_id: 'task_002', sui_object_id: '0xobj002', task_name: '移动端 UI 设计', reward_amount: '2000000000', asset: 'SUI', business_status: 'DELIVERED', created_at: 2000 },
            { task_id: 'task_003', sui_object_id: '0xobj003', task_name: '游戏后端 API 开发', reward_amount: '4000000000', asset: 'SUI', business_status: 'LOCKED', created_at: 3000 },
            { task_id: 'task_004', sui_object_id: '0xobj004', task_name: 'NFT 市场前端开发', reward_amount: '3000000000', asset: 'SUI', business_status: 'BIDDING', created_at: 4000 },
            { task_id: 'task_005', sui_object_id: '0xobj005', task_name: 'DeFi 智能合约审计', reward_amount: '5000000000', asset: 'SUI', business_status: 'BIDDING', created_at: 5000 }
          ];
          
          // 按创建时间排序（从小到大）
          tasks.sort((a, b) => a.created_at - b.created_at);
          
          tasks.forEach((task: any) => {
            const statusIcon = getStatusIcon(task.business_status);
            const row = [
              task.task_id.padEnd(18),
              task.sui_object_id.padEnd(18),
              task.task_name.padEnd(25),
              task.reward_amount.padEnd(15),
              task.asset.padEnd(8),
              statusIcon + task.business_status
            ];
            console.log(row.join(' '));
          });
        }
        
      } else if (cmd.biddable) {
        // 显示可竞标任务列表（状态为BIDDING且未锁定）
        console.log('🎯 可竞标任务列表');
        console.log('='.repeat(30));
        console.log('task_id'.padEnd(18) + 'sui_object_id'.padEnd(18) + 'task_name'.padEnd(25) + 'reward_amount'.padEnd(15) + 'asset'.padEnd(8) + 'business_status');
        console.log('-'.repeat(103));
        
        try {
          // 从索引器获取任务列表
          const response = await fetch(`${indexerUrl}/tasks`);
          if (response.ok) {
            const allTasks = await response.json() as Array<{
              task_id: string;
              sui_object_id: string;
              task_name?: string;
              reward_amount: string;
              asset: string;
              business_status: string;
              created_at: number;
            }>;
            
            // 筛选状态为BIDDING且未锁定的任务
            const biddableTasks = allTasks.filter(task => 
              task.business_status === 'BIDDING' || task.business_status === 'ACTIVE'
            );
            
            // 按创建时间排序（从大到小）
            biddableTasks.sort((a, b) => b.created_at - a.created_at);
            
            if (biddableTasks.length === 0) {
              console.log('📭 当前没有可竞标的任务');
            } else {
              biddableTasks.forEach(task => {
                const statusIcon = getStatusIcon(task.business_status);
                const row = [
                  task.task_id.padEnd(18),
                  task.sui_object_id.padEnd(18),
                  (task.task_name || 'N/A').padEnd(25),
                  task.reward_amount.padEnd(15),
                  task.asset.padEnd(8),
                  statusIcon + task.business_status
                ];
                console.log(row.join(' '));
              });
            }
          } else {
            throw new Error('索引器请求失败');
          }
        } catch (error) {
          console.log('⚠️ 索引器不可用，显示模拟数据');
          
          // 筛选状态为BIDDING且未锁定的任务
          const biddableTasks = [
            { task_id: 'task_004', sui_object_id: '0xobj004', task_name: 'NFT 市场前端开发', reward_amount: '3000000000', asset: 'SUI', business_status: 'BIDDING', created_at: 4000 },
            { task_id: 'task_005', sui_object_id: '0xobj005', task_name: 'DeFi 智能合约审计', reward_amount: '5000000000', asset: 'SUI', business_status: 'BIDDING', created_at: 5000 }
          ];
          
          // 按创建时间排序（从小到大）
          biddableTasks.sort((a, b) => a.created_at - b.created_at);
          
          if (biddableTasks.length === 0) {
            console.log('📭 当前没有可竞标的任务');
          }
          
          biddableTasks.forEach(task => {
            const statusIcon = getStatusIcon(task.business_status);
            const row = [
              task.task_id.padEnd(18),
              task.sui_object_id.padEnd(18),
              task.task_name.padEnd(25),
              task.reward_amount.padEnd(15),
              task.asset.padEnd(8),
              statusIcon + task.business_status
            ];
            console.log(row.join(' '));
          });
        }
        
      } else if (cmd.myTasks) {
        // 显示我的任务列表（我发布的、我执行的、我竞标中的）
        if (!cmd.pubkey) {
          console.log('❌ 查看我的任务需要提供 --pubkey 参数');
          console.log('💡 使用示例: atep-cli board --my-tasks --pubkey npub1yourpubkey');
          return;
        }
        
        console.log(`👤 我的任务列表 (${cmd.pubkey.substring(0, 20)}...)`);
        console.log('='.repeat(40));
        console.log('task_id'.padEnd(18) + 'sui_object_id'.padEnd(18) + 'task_name'.padEnd(25) + 'reward_amount'.padEnd(15) + 'asset'.padEnd(8) + 'business_status');
        console.log('-'.repeat(103));
        
        try {
          // 从索引器获取所有任务
          const response = await fetch(`${indexerUrl}/tasks`);
          if (response.ok) {
            const allTasks = await response.json() as Array<{
              task_id: string;
              sui_object_id: string;
              task_name?: string;
              reward_amount: string;
              asset: string;
              business_status: string;
              created_at: number;
              boss_pubkey?: string;
              worker_pubkey?: string;
              bids?: Array<{ worker_pubkey: string }>;
            }>;
            
            // 筛选与用户相关的任务
            const myTasks = allTasks.filter(task => {
              const isMyPublished = task.boss_pubkey === cmd.pubkey;
              const isMyExecuting = task.worker_pubkey === cmd.pubkey;
              const isMyBidding = task.bids?.some(bid => bid.worker_pubkey === cmd.pubkey);
              
              return isMyPublished || isMyExecuting || isMyBidding;
            }).map(task => {
              // 确定用户角色
              let role: 'published' | 'executing' | 'bidding';
              if (task.boss_pubkey === cmd.pubkey) role = 'published';
              else if (task.worker_pubkey === cmd.pubkey) role = 'executing';
              else role = 'bidding';
              
              return {
                ...task,
                role
              };
            });
            
            // 按创建时间排序（从大到小）
            myTasks.sort((a, b) => b.created_at - a.created_at);
            
            if (myTasks.length === 0) {
              console.log('📭 您还没有参与任何任务');
            } else {
              myTasks.forEach(task => {
                const statusIcon = getStatusIcon(task.business_status);
                const roleIcon = task.role === 'published' ? '🏠' : task.role === 'executing' ? '🔧' : '💼';
                const row = [
                  task.task_id.padEnd(18),
                  task.sui_object_id.padEnd(18),
                  (task.task_name || 'N/A').padEnd(25),
                  task.reward_amount.padEnd(15),
                  task.asset.padEnd(8),
                  roleIcon + statusIcon + task.business_status
                ];
                console.log(row.join(' '));
              });
              
              console.log('\n📝 角色说明:');
              console.log('🏠 我发布的  🔧 我执行的  💼 我竞标中的');
            }
          } else {
            throw new Error('索引器请求失败');
          }
        } catch (error) {
          console.log('⚠️ 索引器不可用，显示模拟数据');
          
          // 模拟用户的任务：我发布的、我执行的、我竞标中的
          const myTasks = [
            { task_id: 'task_001', sui_object_id: '0xobj001', task_name: '数据分析和报告', reward_amount: '1500000000', asset: 'SUI', business_status: 'COMPLETED', role: 'published', created_at: 1000 },
            { task_id: 'task_003', sui_object_id: '0xobj003', task_name: '游戏后端 API 开发', reward_amount: '4000000000', asset: 'SUI', business_status: 'LOCKED', role: 'executing', created_at: 3000 },
            { task_id: 'task_004', sui_object_id: '0xobj004', task_name: 'NFT 市场前端开发', reward_amount: '3000000000', asset: 'SUI', business_status: 'BIDDING', role: 'bidding', created_at: 4000 }
          ];
          
          // 按创建时间排序（从小到大）
          myTasks.sort((a, b) => a.created_at - b.created_at);
          
          if (myTasks.length === 0) {
            console.log('📭 您还没有参与任何任务');
          } else {
            myTasks.forEach(task => {
              const statusIcon = getStatusIcon(task.business_status);
              const roleIcon = task.role === 'published' ? '🏠' : task.role === 'executing' ? '🔧' : '💼';
              const row = [
                task.task_id.padEnd(18),
                task.sui_object_id.padEnd(18),
                task.task_name.padEnd(25),
                task.reward_amount.padEnd(15),
                task.asset.padEnd(8),
                roleIcon + statusIcon + task.business_status
              ];
              console.log(row.join(' '));
            });
            
            console.log('\n📝 角色说明:');
            console.log('🏠 我发布的  🔧 我执行的  💼 我竞标中的');
          }
        }
        
      } else if (cmd.watch) {
        // 实时刷新任务板
        console.log('🔄 实时任务板 (按 Ctrl+C 退出)');
        console.log('='.repeat(30));
        
        let refreshCount = 0;
        let tasks: any[] = []; // Move tasks variable outside try-catch blocks
        const refreshInterval = setInterval(async () => {
          try {
            refreshCount++;
            
            // 清屏并显示最新数据
            console.clear();
            console.log(' atep 实时任务板');
            console.log(` 更新时间: ${new Date().toLocaleString()} (第${refreshCount}次更新)`);
            console.log('='.repeat(50));
            
            try {
              // 从索引器获取实时数据
              const response = await fetch(`${indexerUrl}/tasks`);
              if (response.ok) {
                const result: any = await response.json();
                tasks = result.data || result;
                
                // Sort by creation time
                tasks.sort((a: { created_at: number }, b: { created_at: number }) => a.created_at - b.created_at);
                
                console.log('task_id'.padEnd(18) + 'sui_object_id'.padEnd(18) + 'task_name'.padEnd(25) + 'reward_amount'.padEnd(15) + 'asset'.padEnd(8) + 'business_status');
                console.log('-'.repeat(103));
                
                tasks.forEach((task: { task_id: string, sui_object_id: string, task_name: string, reward_amount: string, asset: string, business_status: string, created_at: number }) => {
                  const statusIcon = getStatusIcon(task.business_status);
                  const row = [
                    task.task_id.padEnd(18),
                    task.sui_object_id.padEnd(18),
                    (task.task_name || 'N/A').padEnd(25),
                    task.reward_amount.padEnd(15),
                    task.asset.padEnd(8),
                    statusIcon + task.business_status
                  ];
                  console.log(row.join(' '));
                });
                
                console.log(`\n 数据源: 索引器 (${tasks.length} 个任务)`);
              } else {
                throw new Error('索引器请求失败');
              }
            } catch (indexerError: any) {
              console.log(' 索引器不可用，显示模拟数据');
              
              // 模拟实时数据
              tasks = [
                { task_id: 'task_001', sui_object_id: '0xobj001', task_name: '数据分析和报告', reward_amount: '1500000000', asset: 'SUI', business_status: 'COMPLETED', created_at: 1000 },
                { task_id: 'task_002', sui_object_id: '0xobj002', task_name: '移动端 UI 设计', reward_amount: '2000000000', asset: 'SUI', business_status: 'DELIVERED', created_at: 2000 },
                { task_id: 'task_003', sui_object_id: '0xobj003', task_name: '游戏后端 API 开发', reward_amount: '4000000000', asset: 'SUI', business_status: 'LOCKED', created_at: 3000 },
                { task_id: 'task_004', sui_object_id: '0xobj004', task_name: 'NFT 市场前端开发', reward_amount: '3000000000', asset: 'SUI', business_status: 'BIDDING', created_at: 4000 },
                { task_id: 'task_005', sui_object_id: '0xobj005', task_name: 'DeFi 智能合约审计', reward_amount: '5000000000', asset: 'SUI', business_status: 'BIDDING', created_at: 5000 }
              ];
              
              // 按创建时间排序
              tasks.sort((a: any, b: any) => a.created_at - b.created_at);
              
              console.log('task_id'.padEnd(18) + 'sui_object_id'.padEnd(18) + 'task_name'.padEnd(25) + 'reward_amount'.padEnd(15) + 'asset'.padEnd(8) + 'business_status');
              console.log('-'.repeat(103));
            
              tasks.forEach((task: any) => {
                const statusIcon = getStatusIcon(task.business_status);
                const row = [
                  task.task_id.padEnd(18),
                  task.sui_object_id.padEnd(18),
                  task.task_name.padEnd(25),
                  task.reward_amount.padEnd(15),
                  task.asset.padEnd(8),
                  statusIcon + task.business_status
                ];
                console.log(row.join(' '));
              });
              
              console.log(`\n 数据源: 模拟数据 (${tasks.length} 个任务)`);
            }
            
            console.log(`\n 总计: ${tasks.length} 个任务`);
            
          } catch (error) {
            console.log(' 更新失败，继续监听...');
          }
        }, 5000); // 每5秒刷新
        
        // 处理退出
        process.on('SIGINT', () => {
          clearInterval(refreshInterval);
          console.log('\n 已退出实时任务板');
          console.log('\n👋 已退出实时任务板');
        });
        
      } else {
        console.log('📋 任务板使用指南:');
        console.log('  atep-cli board --list                              # 显示所有任务列表');
        console.log('  atep-cli board --biddable                          # 显示可竞标任务列表');
        console.log('  atep-cli board --my-tasks --pubkey <pubkey>        # 显示我的任务列表');
        console.log('  atep-cli board --watch                             # 实时刷新任务板');
        console.log();
        console.log('💡 示例:');
        console.log('  atep-cli board --list');
        console.log('  atep-cli board --biddable');
        console.log('  atep-cli board --my-tasks --pubkey npub1yourpubkey');
        console.log('  atep-cli board --watch');
        console.log();
        console.log('📋 列表字段说明:');
        console.log('  task_id: 任务唯一标识');
        console.log('  sui_object_id: Sui 对象 ID');
        console.log('  task_name: 来自 Nostr 事件或为空');
        console.log('  reward_amount: 任务奖励金额 (MIST)');
        console.log('  asset: 奖励货币类型');
        console.log('  business_status: BIDDING(竞标中) LOCKED(已锁定) DELIVERED(已交付) COMPLETED(已完成)');
      }
    } catch (error: any) {
      console.error('❌ 任务板操作失败:', error.message);
    }
  });

// ==================== 第8组：验证工具 ====================
// 验证工具提供数据一致性检查，对比索引器与链上数据

// 验证任务数据一致性
program
  .command("verify-task")
  .description("【9.1】验证任务数据一致性（对比索引器与链上数据）")
  .requiredOption("--task-id <id>", "任务 ID")
  .option("--indexer-url <url>", "索引器 URL", "http://localhost:3000")
  .action(async (cmd, opts) => {
    try {
      const verifier = new VerificationTools(cmd.indexerUrl);
      await verifier.verifyTask(cmd.taskId);
    } catch (error: any) {
      const output = (program.opts() as CliOptions).output ?? "jsonl";
      emit({ ok: false, error: { code: "VERIFY_ERROR", message: error.message } }, output);
      process.exitCode = 1;
    }
  });

// 批量验证任务
program
  .command("verify-range")
  .description("【9.2】批量验证任务数据一致性")
  .requiredOption("--task-ids <ids>", "任务 ID 列表（逗号分隔）")
  .option("--indexer-url <url>", "索引器 URL", "http://localhost:3000")
  .action(async (cmd, opts) => {
    try {
      const taskIds = cmd.taskIds.split(',').map((id: string) => id.trim());
      const verifier = new VerificationTools(cmd.indexerUrl);
      await verifier.verifyRange(taskIds);
    } catch (error: any) {
      const output = (program.opts() as CliOptions).output ?? "jsonl";
      emit({ ok: false, error: { code: "VERIFY_ERROR", message: error.message } }, output);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error) => {
  const output = (program.opts() as CliOptions).output ?? "jsonl";
  emit({ ok: false, error: { code: "CLI_ERROR", message: error.message } }, output);
  process.exitCode = 1;
});
