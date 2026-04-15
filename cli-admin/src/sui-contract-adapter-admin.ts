import 'dotenv/config'; // 自动读取 .env 文件
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { SuiContractAdapter, SUI_CONFIG } from './sui-contract-adapter';

// 强制启用管理员模式（cli-admin 专用包）
process.env.ATEP_ADMIN_MODE = 'true';

export const ADMIN_CONFIG = {
  ...SUI_CONFIG,
  // 从环境变量读取，如果没有则使用空字符串（需要手动填写）
  MULTI_SIG_ADMIN_ID: process.env.MULTI_SIG_ADMIN_ID || '',
};

/**
 * 管理员版 Sui 合约适配器
 * 扩展用户版本，添加多签管理功能
 */
export class SuiContractAdminAdapter extends SuiContractAdapter {
  constructor(network: 'devnet' | 'testnet' | 'mainnet' = 'devnet') {
    super(network);
  }

  // ==================== 多签管理功能 ====================

  /**
   * 准备提议更新捐赠地址交易（纯服务模式）
   * 返回未签名交易数据，由外部签名后执行
   */
  async prepareProposeUpdateDonation(params: { 
    multiSigAdminId: string;
    newDonationRecipient: string;
  }) {
    const client = new SuiClient({ url: getFullnodeUrl('devnet') });
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${ADMIN_CONFIG.PACKAGE_ID}::atep::propose_update_donation`,
      arguments: [
        tx.object(params.multiSigAdminId),
        tx.object(ADMIN_CONFIG.CONFIG_ID),
        tx.pure(params.newDonationRecipient),
        tx.object(ADMIN_CONFIG.CLOCK_ID),
      ],
    });

    // 设置 Gas 预算
    tx.setGasBudget(10000000);

    // 返回未签名交易数据
    return {
      transaction: tx,
      description: "提议更新捐赠地址",
      function: `${ADMIN_CONFIG.PACKAGE_ID}::atep::propose_update_donation`,
      arguments: [
        params.multiSigAdminId,
        ADMIN_CONFIG.CONFIG_ID,
        params.newDonationRecipient,
        ADMIN_CONFIG.CLOCK_ID,
      ],
      note: "需要管理员签名，24小时后可批准"
    };
  }

  /**
   * 准备批准更新捐赠地址交易（纯服务模式）
   * 返回未签名交易数据，由外部签名后执行
   */
  async prepareApproveUpdateDonation(params: { 
    multiSigAdminId: string;
  }) {
    const client = new SuiClient({ url: getFullnodeUrl('devnet') });
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${ADMIN_CONFIG.PACKAGE_ID}::atep::approve_update_donation`,
      arguments: [
        tx.object(params.multiSigAdminId),
        tx.object(ADMIN_CONFIG.CONFIG_ID),
        tx.object(ADMIN_CONFIG.CLOCK_ID),
      ],
    });

    // 设置 Gas 预算
    tx.setGasBudget(10000000);

    // 返回未签名交易数据
    return {
      transaction: tx,
      description: "批准更新捐赠地址",
      function: `${ADMIN_CONFIG.PACKAGE_ID}::atep::approve_update_donation`,
      arguments: [
        params.multiSigAdminId,
        ADMIN_CONFIG.CONFIG_ID,
        ADMIN_CONFIG.CLOCK_ID,
      ],
      note: "需要第二个管理员签名"
    };
  }

  /**
   * 准备取消待执行操作交易（纯服务模式）
   * 返回未签名交易数据，由外部签名后执行
   */
  async prepareCancelPendingOperation(params: { 
    multiSigAdminId: string;
  }) {
    const client = new SuiClient({ url: getFullnodeUrl('devnet') });
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${ADMIN_CONFIG.PACKAGE_ID}::atep::cancel_pending_operation`,
      arguments: [
        tx.object(params.multiSigAdminId),
        tx.object(ADMIN_CONFIG.CONFIG_ID),
        tx.object(ADMIN_CONFIG.CLOCK_ID),
      ],
    });

    // 设置 Gas 预算
    tx.setGasBudget(10000000);

    // 返回未签名交易数据
    return {
      transaction: tx,
      description: "取消待执行操作",
      function: `${ADMIN_CONFIG.PACKAGE_ID}::atep::cancel_pending_operation`,
      arguments: [
        params.multiSigAdminId,
        ADMIN_CONFIG.CONFIG_ID,
        ADMIN_CONFIG.CLOCK_ID,
      ],
      note: "需要管理员签名"
    };
  }

  /**
   * 发布仲裁员白名单到 Nostr
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
    if (!this.nostrPublisher) {
      throw new Error('Nostr publisher not set. Call setNostrPublisher() first.');
    }

    return this.nostrPublisher.publishVerifierWhitelist(params);
  }

  /**
   * 准备转移管理员权限交易（纯服务模式）
   * 返回未签名交易数据，由外部签名后执行
   */
  async prepareTransferAdminCap(params: { 
    adminCapId: string;
    recipient: string;
  }) {
    const client = new SuiClient({ url: getFullnodeUrl('devnet') });
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${ADMIN_CONFIG.PACKAGE_ID}::atep::transfer_admin_cap`,
      arguments: [
        tx.object(params.adminCapId),
        tx.pure(params.recipient),
      ],
    });

    // 设置 Gas 预算
    tx.setGasBudget(10000000);

    // 返回未签名交易数据
    return {
      transaction: tx,
      description: "转移管理员权限",
      function: `${ADMIN_CONFIG.PACKAGE_ID}::atep::transfer_admin_cap`,
      arguments: [
        params.adminCapId,
        params.recipient,
      ],
      note: "需要 AdminCap 持有者签名"
    };
  }

  /**
   * 查询多签管理配置
   */
  async getMultiSigAdmin(multiSigAdminId: string) {
    const client = new SuiClient({ url: getFullnodeUrl('devnet') });
    return client.getObject({
      id: multiSigAdminId,
      options: { showContent: true, showType: true },
    });
  }

  // 注意：移除了 checkIsAdmin 方法
// 用户应该直接查询智能合约获取管理员信息
// 命令：sui client object <MULTI_SIG_ADMIN_ID>

  // 注意：移除了 getDonationRecipient 方法
// 用户应该直接查询智能合约获取捐赠地址信息
// 命令：sui client object <CONFIG_ID>

  /**
   * 检查当前地址是否为管理员
   */
  async isAdmin(multiSigAdminId: string): Promise<boolean> {
    try {
      const keypair = (this as any).keypair;
      if (!keypair) return false;

      const adminObj = await this.getMultiSigAdmin(multiSigAdminId);
      if (!adminObj.data?.content) return false;

      const content = adminObj.data.content as any;
      const admins = content.fields?.admins || [];
      const myAddress = keypair.toSuiAddress();

      return admins.some((admin: string) => admin === myAddress);
    } catch {
      return false;
    }
  }
}
