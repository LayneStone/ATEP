#!/usr/bin/env ts-node

import 'dotenv/config';
import { SuiContractAdminAdapter } from './sui-contract-adapter-admin';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { program } from 'commander';
import { AdminVerificationTools } from './verification-tools';
import { SimpleTimeUtils } from './simple-time-utils';

/**
 * atep 管理员 CLI - 纯数据服务版本
 * 专注于交易准备和Nostr事件广播，不进行权限检查
 * 
 * 用户任务管理请使用: npm run dev -C ../cli
 * 
 * ============================================================
 *                        命令目录
 * ============================================================
 * 
 * ==================== 第1组：查询指导 ====================
 * 1.1 query-guide          - 智能合约查询指导
 * 
 * ==================== 第2组：捐赠地址管理 ====================
 * 2.1 propose-donation     - 准备提议更新捐赠地址交易
 * 2.2 approve-donation     - 准备批准捐赠地址更新交易
 * 2.3 cancel-pending       - 准备取消待执行操作交易
 * 
 * ==================== 第3组：白名单管理 ====================
 * 3.1 publish-whitelist    - 广播仲裁员白名单到Nostr
 * 3.2 注意：移除了 query-whitelist - 用户应直接使用 Nostr 客户端查询
 * 
 * ==================== 第4组：权限管理 ====================
 * 4.1 transfer-admin-cap   - 准备转移管理员权限交易
 * 
 * ==================== 第5组：移除的验证工具 ====================
 * 注意：移除了 verify-admin 和 verify-whitelist 命令
 * 验证应该由用户直接进行：
 * - 智能合约验证: sui client object <ID>
 * - 索引器查询: curl http://localhost:3000/api/...
 * - Nostr 事件查询: 使用 Nostr 客户端
 * 
 * ============================================================
 * 
 * 设计理念：
 * - 所有合约数据都是公开的，用户可直接查询
 * - CLI只负责交易数据准备和格式化
 * - 签名和执行由用户外部工具完成
 * - 无需任何权限检查
 * ============================================================
 */

// 验证环境变量
function validateConfig(): void {
  if (!process.env.MULTI_SIG_ADMIN_ID) {
    console.error('❌ 错误: 请设置 MULTI_SIG_ADMIN_ID 环境变量');
    console.error('💡 提示: 复制 .env.example 到 .env 并填入正确的 MultiSigAdmin ID');
    process.exit(1);
  }
}

// 创建管理员适配器（纯服务模式）
function createAdminAdapter(network: 'devnet' | 'testnet' | 'mainnet' = 'devnet'): SuiContractAdminAdapter {
  const admin = new SuiContractAdminAdapter(network);
  
  // 如果设置了 Nostr 私钥，设置 Nostr 发布器
  if (process.env.NOSTR_SECRET_KEY) {
    const { NostrPublisher } = require('./nostr-publisher');
    const publisher = new NostrPublisher();
    publisher.setNostrSecretKey(Buffer.from(process.env.NOSTR_SECRET_KEY, 'hex'));
    admin.setNostrPublisher(publisher);
  }
  
  return admin;
}

// 主程序
async function main(): Promise<void> {
  validateConfig();

  program
    .name('atep-admin')
    .description('atep 管理员 CLI - 多签管理工具')
    .version('1.0.0');

  // ==================== 第1组：管理员检查命令 ====================
  
  // 注意：移除了 check-admin 命令
// 用户应该直接查询智能合约获取管理员信息
// 命令：sui client object <MULTI_SIG_ADMIN_ID>

  // 注意：移除了 check-donation 命令
// 用户应该直接查询智能合约获取捐赠地址信息
// 命令：sui client object <CONFIG_ID>

  // 查询指导 - 帮助用户直接查询合约
  program
    .command('query-guide')
    .description('查询智能合约的指导命令')
    .action(() => {
      console.log('='.repeat(80));
      console.log('📋 智能合约查询指导');
      console.log('='.repeat(80));
      console.log('');
      console.log('🔍 查询管理员列表:');
      console.log('-'.repeat(80));
      console.log(`  sui client object ${process.env.MULTI_SIG_ADMIN_ID || '<MULTI_SIG_ADMIN_ID>'}`);
      console.log('');
      console.log('💰 查询捐赠地址:');
      console.log('-'.repeat(80));
      console.log(`  sui client object ${process.env.CONFIG_ID || '<CONFIG_ID>'}`);
      console.log('');
      console.log('🌐 在线查询:');
      console.log('-'.repeat(80));
      console.log(`  https://explorer.devnet.sui.io/object/${process.env.MULTI_SIG_ADMIN_ID || '<MULTI_SIG_ADMIN_ID>'}`);
      console.log('');
      console.log('� 提示:');
      console.log('-'.repeat(80));
      console.log('  所有合约数据都是公开的，无需权限检查');
      console.log('='.repeat(80));
    });

  // ==================== 第2组：捐赠地址管理 ====================

  // 提议更新捐赠地址
  program
    .command('propose-donation')
    .description('提议更新捐赠地址')
    .requiredOption('-a, --address <address>', '新的捐赠地址')
    .option('-n, --network <network>', 'Sui 网络', 'devnet')
    .action(async (options) => {
      try {
        const admin = createAdminAdapter(options.network);

        console.log('='.repeat(80));
        console.log('✅ propose-donation 成功');
        console.log('='.repeat(80));

        const result = await admin.prepareProposeUpdateDonation({
          multiSigAdminId: process.env.MULTI_SIG_ADMIN_ID!,
          newDonationRecipient: options.address,
        });

        console.log('');
        console.log('📋 交易详情:');
        console.log('-'.repeat(80));
        console.log(`  功能: ${result.description}`);
        console.log(`  合约: ${result.function}`);
        console.log(`  说明: ${result.note}`);

        // 显示交易信息
        console.log('');
        console.log('📝 参数列表:');
        console.log('-'.repeat(80));
        console.log(`  参数数量: ${result.arguments.length}`);
        result.arguments.forEach((arg, index) => {
          console.log(`  [${index}] ${arg}`);
        });

        console.log('');
        console.log('💡 使用方法:');
        console.log('-'.repeat(80));
        console.log('  1. 使用外部钱包签名交易');
        console.log('  2. 广播签名后的交易到 Sui 网络');
        console.log('='.repeat(80));
      } catch (error: any) {
        console.error('❌ 提议失败:', error.message);
        process.exit(1);
      }
    });

  // 批准提议
  program
    .command('approve-donation')
    .description('批准捐赠地址更新提议（24小时后）')
    .option('-n, --network <network>', 'Sui 网络', 'devnet')
    .action(async (options) => {
      try {
        const admin = createAdminAdapter(options.network);

        console.log('='.repeat(80));
        console.log('✅ approve-donation 成功');
        console.log('='.repeat(80));

        const result = await admin.prepareApproveUpdateDonation({
          multiSigAdminId: process.env.MULTI_SIG_ADMIN_ID!,
        });

        console.log('');
        console.log('📋 交易详情:');
        console.log('-'.repeat(80));
        console.log(`  功能: ${result.description}`);
        console.log(`  合约: ${result.function}`);
        console.log(`  说明: ${result.note}`);

        console.log('');
        console.log('💡 使用方法:');
        console.log('-'.repeat(80));
        console.log('  1. 使用外部钱包签名交易');
        console.log('  2. 广播签名后的交易到 Sui 网络');
        console.log('='.repeat(80));
      } catch (error: any) {
        console.error('❌ 批准失败:', error.message);
        process.exit(1);
      }
    });

  // 取消待执行操作
  program
    .command('cancel-pending')
    .description('取消待执行的操作')
    .option('-n, --network <network>', 'Sui 网络', 'devnet')
    .action(async (options) => {
      try {
        const admin = createAdminAdapter(options.network);

        console.log('='.repeat(80));
        console.log('✅ cancel-pending 成功');
        console.log('='.repeat(80));

        const result = await admin.prepareCancelPendingOperation({
          multiSigAdminId: process.env.MULTI_SIG_ADMIN_ID!,
        });

        console.log('');
        console.log('📋 交易详情:');
        console.log('-'.repeat(80));
        console.log(`  功能: ${result.description}`);
        console.log(`  合约: ${result.function}`);
        console.log(`  说明: ${result.note}`);

        console.log('');
        console.log('💡 使用方法:');
        console.log('-'.repeat(80));
        console.log('  1. 使用外部钱包签名交易');
        console.log('  2. 广播签名后的交易到 Sui 网络');
        console.log('='.repeat(80));
      } catch (error: any) {
        console.error('❌ 取消失败:', error.message);
        process.exit(1);
      }
    });

  // ==================== 第3组：白名单管理 ====================

  // 广播仲裁员白名单
  program
    .command('publish-whitelist')
    .description('广播仲裁员白名单更新到 Nostr')
    .requiredOption('-v, --verifiers <verifiers...>', '仲裁员列表（格式: pubkey:sui_address:effective_from:expires_at）')
    .action(async (options) => {
      try {
        const admin = createAdminAdapter();
        
        // 解析仲裁员列表
        const verifiers = options.verifiers.map((verifier: string) => {
          const [pubkey, sui_address, effective_from, expires_at] = verifier.split(':');
          if (!pubkey || !sui_address || !effective_from || !expires_at) {
            throw new Error(`Invalid verifier format: ${verifier}. Expected: pubkey:sui_address:effective_from:expires_at`);
          }
          return {
            pubkey,
            sui_address,
            effective_from: parseInt(effective_from),
            expires_at: parseInt(expires_at),
          };
        });
        
        console.log('='.repeat(80));
        console.log('✅ publish-whitelist 成功');
        console.log('='.repeat(80));

        const result = await admin.publishVerifierWhitelist({
          verifiers,
          updated_at: SimpleTimeUtils.nowSec(),
        });

        console.log('');
        console.log('📋 广播结果:');
        console.log('-'.repeat(80));
        console.log(`  事件 ID: ${result.eventId}`);
        console.log(`  发布到: ${result.publishedTo.join(', ')}`);

        console.log('');
        console.log('📝 仲裁员列表:');
        console.log('-'.repeat(80));
        verifiers.forEach((verifier: any, index: number) => {
          console.log(`  [${index}] ${verifier.pubkey} -> ${verifier.sui_address}`);
          console.log(`       有效期: ${verifier.effective_from} - ${verifier.expires_at}`);
        });

        console.log('');
        console.log('💡 提示:');
        console.log('-'.repeat(80));
        console.log('  白名单已广播到 Nostr 网络');
        console.log('='.repeat(80));
      } catch (error: any) {
        console.error('❌ 广播失败:', error.message);
        process.exit(1);
      }
    });

  // 注意：移除了 query-whitelist 
//  Nostr 
// nostr-query --filter "#atep" --kind 36010

  // ==================== 第4组：权限管理 ====================

  // 转移管理员权限
  program
    .command('transfer-admin-cap')
    .description('转移管理员权限（需要 AdminCap 对象）')
    .requiredOption('--admin-cap-id <id>', 'AdminCap 对象 ID')
    .requiredOption('--recipient <address>', '接收者地址')
    .option('-n, --network <network>', 'Sui 网络', 'devnet')
    .action(async (options) => {
      try {
        const admin = createAdminAdapter(options.network);

        console.log('='.repeat(80));
        console.log('✅ transfer-admin-cap 成功');
        console.log('='.repeat(80));

        const result = await admin.prepareTransferAdminCap({
          adminCapId: options.adminCapId,
          recipient: options.recipient,
        });

        console.log('');
        console.log('📋 交易详情:');
        console.log('-'.repeat(80));
        console.log(`  功能: ${result.description}`);
        console.log(`  合约: ${result.function}`);
        console.log(`  说明: ${result.note}`);

        console.log('');
        console.log('📝 操作信息:');
        console.log('-'.repeat(80));
        console.log(`  AdminCap ID: ${options.adminCapId}`);
        console.log(`  接收者地址: ${options.recipient}`);

        console.log('');
        console.log('💡 使用方法:');
        console.log('-'.repeat(80));
        console.log('  1. 使用 AdminCap 持有者钱包签名交易');
        console.log('  2. 广播签名后的交易到 Sui 网络');
        console.log('');
        console.log('⚠️  警告: 此操作不可逆，请确认接收者地址正确');
        console.log('='.repeat(80));
      } catch (error: any) {
        console.error('❌ 转移失败:', error.message);
        process.exit(1);
      }
    });

  // 注意：移除了 verify-admin 和 verify-whitelist 命令
// 验证应该由用户直接进行：
// - 智能合约验证: sui client object <ID>
// - 索引器查询: curl http://localhost:3000/api/...
// - Nostr 事件查询: 使用 Nostr 客户端

  // 解析命令行参数
  await program.parseAsync(process.argv);
}

// 错误处理
main().catch((error) => {
  console.error('❌ 程序错误:', error.message);
  process.exit(1);
});
