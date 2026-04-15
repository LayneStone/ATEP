import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { NostrPublisher } from './nostr-publisher';

/**
 * Sui 合约配置
 */
export const SUI_CONFIG = {
  NETWORK: 'devnet' as const,
  PACKAGE_ID: '0x955313e42d8b2e7e34c435dd35c3c727043721a1c7c07eb3a3b0ecbdece9c9',
  CONFIG_ID: '0x9417cf510aa4a7cd7f368e0cf81fe60059561d44a0400cb9e1925ac49fbb3ce9',
  CLOCK_ID: '0x6',
};

/**
 * Sui 合约错误类型
 */
export class SuiContractError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'SuiContractError';
  }
}

/**
 * 交易结果类型
 */
export interface TransactionResult {
  txHash: string;
  success: boolean;
  taskObjectId?: string;
  error?: string;
}

/**
 * 重试配置
 */
interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
};

/**
 * Sui 合约适配器
 */
export class SuiContractAdapter {
  protected client: SuiClient;
  protected keypair?: Ed25519Keypair;
  protected nostrPublisher?: NostrPublisher;

  constructor(network: 'devnet' | 'testnet' | 'mainnet' = 'devnet') {
    this.client = new SuiClient({ url: getFullnodeUrl(network) });
  }

  setKeypair(keypair: Ed25519Keypair) {
    this.keypair = keypair;
  }

  /**
   * 设置 Nostr 发布器（可选）
   * 设置后，管理员操作会自动广播到 Nostr
   */
  setNostrPublisher(publisher: NostrPublisher) {
    this.nostrPublisher = publisher;
  }

  getAddress(): string {
    if (!this.keypair) throw new Error('Keypair not set');
    return this.keypair.toSuiAddress();
  }

  async createTask(params: {
    taskId: Uint8Array;
    rewardAmount: bigint;
    expectedTtlMs: bigint;
    bossNostrPubkey: Uint8Array;
    verifierNostrPubkey: Uint8Array;
    arbitratorSuiAddress?: string;
    paymentCoin: string;
  }) {
    if (!this.keypair) throw new Error('Keypair not set');

    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::create_task`,
      arguments: [
        tx.pure(Array.from(params.taskId)),
        tx.object(params.paymentCoin),
        tx.pure(params.expectedTtlMs.toString()),
        tx.pure(Array.from(params.bossNostrPubkey)),
        tx.pure(Array.from(params.verifierNostrPubkey)),
        tx.pure(params.arbitratorSuiAddress || '0x0'),
        tx.object(SUI_CONFIG.CLOCK_ID),
      ],
    });

    tx.setGasBudget(10000000);
    const address = this.keypair.getPublicKey().toSuiAddress();
    const coins = await this.client.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
    const gasCoin = coins.data.find(c => c.coinObjectId !== params.paymentCoin);
    if (!gasCoin) throw new Error('Need a separate coin for gas payment');
    tx.setGasPayment([{ objectId: gasCoin.coinObjectId, version: gasCoin.version, digest: gasCoin.digest }]);

    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair,
      transactionBlock: tx,
      options: { showEffects: true, showEvents: true, showObjectChanges: true },
    });

    const taskObjectId = (result.objectChanges as any[])?.find(
      (change: any) => change.type === 'created' && change.objectType?.includes('::atep::Task')
    )?.objectId;

    if (!taskObjectId) throw new Error('Failed to extract task object ID');

    return { txHash: result.digest, success: result.effects?.status?.status === 'success', taskObjectId };
  }

  async lockTask(params: { taskObjectId: string; workerNostrPubkey: Uint8Array; workerSuiAddress: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::lock_task`,
      arguments: [
        tx.object(params.taskObjectId),
        tx.pure(Array.from(params.workerNostrPubkey)),
        tx.pure(params.workerSuiAddress),
        tx.object(SUI_CONFIG.CLOCK_ID),
      ],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async submitDelivery(params: { taskObjectId: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::submit_delivery`,
      arguments: [tx.object(params.taskObjectId), tx.object(SUI_CONFIG.CLOCK_ID)],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async reviewDelivery(params: { taskObjectId: string; reviewResult: boolean }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::review_delivery`,
      arguments: [
        tx.object(params.taskObjectId),
        tx.object(SUI_CONFIG.CONFIG_ID),
        tx.pure(params.reviewResult),
        tx.object(SUI_CONFIG.CLOCK_ID),
      ],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async acceptRejection(params: { taskObjectId: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::accept_rejection`,
      arguments: [
        tx.object(params.taskObjectId),
        tx.object(SUI_CONFIG.CONFIG_ID),
        tx.object(SUI_CONFIG.CLOCK_ID),
      ],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async initiateArbitration(params: { taskObjectId: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::initiate_arbitration`,
      arguments: [tx.object(params.taskObjectId), tx.object(SUI_CONFIG.CLOCK_ID)],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async resolveArbitration(params: { taskObjectId: string; winnerNostrPubkey: Uint8Array; verifierNostrPubkey: Uint8Array }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::resolve_arbitration`,
      arguments: [
        tx.object(params.taskObjectId),
        tx.object(SUI_CONFIG.CONFIG_ID),
        tx.pure(Array.from(params.winnerNostrPubkey)),
        tx.pure(Array.from(params.verifierNostrPubkey)),
        tx.object(SUI_CONFIG.CLOCK_ID),
      ],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async cancelTask(params: { taskObjectId: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({ target: `${SUI_CONFIG.PACKAGE_ID}::atep::cancel_task`, arguments: [tx.object(params.taskObjectId)] });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async refundByWorker(params: { taskObjectId: string; workerNostrPubkey: Uint8Array }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::refund_by_worker`,
      arguments: [tx.object(params.taskObjectId), tx.pure(Array.from(params.workerNostrPubkey))],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async expireTask(params: { taskObjectId: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::expire_task`,
      arguments: [tx.object(params.taskObjectId), tx.object(SUI_CONFIG.CLOCK_ID)],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async claimDeliveryTimeout(params: { taskObjectId: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::claim_delivery_timeout`,
      arguments: [tx.object(params.taskObjectId), tx.object(SUI_CONFIG.CLOCK_ID)],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async claimReviewTimeout(params: { taskObjectId: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::claim_review_timeout`,
      arguments: [tx.object(params.taskObjectId), tx.object(SUI_CONFIG.CONFIG_ID), tx.object(SUI_CONFIG.CLOCK_ID)],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async claimResponseTimeout(params: { taskObjectId: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::claim_response_timeout`,
      arguments: [tx.object(params.taskObjectId), tx.object(SUI_CONFIG.CONFIG_ID), tx.object(SUI_CONFIG.CLOCK_ID)],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async claimArbitrationTimeout(params: { taskObjectId: string }) {
    if (!this.keypair) throw new Error('Keypair not set');
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${SUI_CONFIG.PACKAGE_ID}::atep::claim_arbitration_timeout`,
      arguments: [tx.object(params.taskObjectId), tx.object(SUI_CONFIG.CONFIG_ID), tx.object(SUI_CONFIG.CLOCK_ID)],
    });
    const result = await this.client.signAndExecuteTransactionBlock({
      signer: this.keypair, transactionBlock: tx, options: { showEffects: true, showEvents: true },
    });
    return { txHash: result.digest, success: result.effects?.status?.status === 'success' };
  }

  async getTask(taskObjectId: string) {
    return this.client.getObject({ id: taskObjectId, options: { showContent: true, showType: true } });
  }
}
