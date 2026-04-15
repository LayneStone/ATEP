import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';

/**
 * 任务数据接口（索引器返回）
 */
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
  updated_at?: number;
}

/**
 * 任务验证结果
 */
export interface VerificationResult {
  taskId: string;
  indexerData: TaskData | null;
  contractData: any;
  isConsistent: boolean;
  differences: string[];
  recommendations: string[];
}

/**
 * 批量验证结果
 */
export interface BatchVerificationResult {
  total: number;
  consistent: number;
  inconsistent: number;
  errors: number;
  details: VerificationResult[];
}

/**
 * 验证工具类
 */
export class VerificationTools {
  private client: SuiClient;
  private indexerUrl: string;

  constructor(indexerUrl: string = 'http://localhost:3000') {
    this.client = new SuiClient({ url: getFullnodeUrl('devnet') });
    this.indexerUrl = indexerUrl;
  }

  /**
   * 验证单个任务
   */
  async verifyTask(taskId: string): Promise<VerificationResult> {
    console.log(`🔍 验证任务: ${taskId}`);

    try {
      // 获取索引器数据
      const indexerData = await this.getIndexerData(taskId);
      
      // 获取链上数据
      const contractData = await this.getContractData(taskId);

      // 对比数据
      const comparison = this.compareData(indexerData, contractData);

      const result: VerificationResult = {
        taskId,
        indexerData,
        contractData,
        isConsistent: comparison.isConsistent,
        differences: comparison.differences,
        recommendations: this.getRecommendations(comparison)
      };

      this.displayResult(result);
      return result;

    } catch (error: any) {
      console.error(`❌ 验证失败: ${error.message}`);
      
      return {
        taskId,
        indexerData: null,
        contractData: null,
        isConsistent: false,
        differences: [`验证失败: ${error.message}`],
        recommendations: ['检查网络连接', '确认任务ID正确', '联系技术支持']
      };
    }
  }

  /**
   * 批量验证任务
   */
  async verifyRange(taskIds: string[]): Promise<BatchVerificationResult> {
    console.log(`🔍 批量验证 ${taskIds.length} 个任务...`);

    const results: VerificationResult[] = [];
    
    for (const taskId of taskIds) {
      const result = await this.verifyTask(taskId);
      results.push(result);
    }

    const summary: BatchVerificationResult = {
      total: taskIds.length,
      consistent: results.filter(r => r.isConsistent).length,
      inconsistent: results.filter(r => !r.isConsistent).length,
      errors: results.filter(r => r.indexerData === null).length,
      details: results
    };

    this.displayBatchSummary(summary);
    return summary;
  }

  /**
   * 获取索引器数据
   */
  private async getIndexerData(taskId: string): Promise<TaskData | null> {
    try {
      const response = await fetch(`${this.indexerUrl}/api/tasks/${taskId}`);
      if (!response.ok) {
        return null;
      }
      const data = await response.json() as TaskData;
      return data;
    } catch (error) {
      console.warn('⚠️  索引器数据获取失败:', error);
      return null;
    }
  }

  /**
   * 获取链上数据
   */
  private async getContractData(taskId: string): Promise<any> {
    try {
      // 这里需要根据实际的合约查询逻辑实现
      // 暂时返回模拟数据
      const objectId = await this.findTaskObjectId(taskId);
      if (!objectId) {
        throw new Error('任务对象未找到');
      }

      const objectData = await this.client.getObject({
        id: objectId,
        options: { showContent: true, showType: true }
      });

      return objectData.data;
    } catch (error) {
      console.warn('⚠️  链上数据获取失败:', error);
      return null;
    }
  }

  /**
   * 查找任务对象ID
   */
  private async findTaskObjectId(taskId: string): Promise<string | null> {
    // 这里需要实现根据任务ID查找对象ID的逻辑
    // 可能需要查询索引器或使用其他方法
    return null; // 暂时返回null
  }

  /**
   * 对比数据
   */
  private compareData(indexerData: TaskData | null, contractData: any): {
    isConsistent: boolean;
    differences: string[];
  } {
    const differences: string[] = [];

    if (!indexerData && !contractData) {
      return { isConsistent: true, differences: ['两个数据源都为空'] };
    }

    if (!indexerData) {
      return { isConsistent: false, differences: ['索引器数据为空'] };
    }

    if (!contractData) {
      return { isConsistent: false, differences: ['链上数据为空'] };
    }

    // 对比关键字段
    if (indexerData.status !== this.extractStatus(contractData)) {
      differences.push(`状态不一致: 索引器=${indexerData.status}, 链上=${this.extractStatus(contractData)}`);
    }

    if (Math.abs((indexerData.updated_at || 0) - this.extractTimestamp(contractData)) > 5000) {
      differences.push(`时间戳差异 > 5秒`);
    }

    return {
      isConsistent: differences.length === 0,
      differences
    };
  }

  /**
   * 提取状态
   */
  private extractStatus(contractData: any): string {
    // 从合约数据中提取状态
    const content = contractData.content as any;
    if (!content || !content.fields) {
      return 'unknown';
    }

    const status = content.fields.status as any;
    if (status.fields.is_completed) return 'completed';
    if (status.fields.is_locked) return 'locked';
    if (status.fields.is_open) return 'open';
    if (status.fields.is_cancelled) return 'cancelled';
    return 'unknown';
  }

  /**
   * 提取时间戳
   */
  private extractTimestamp(contractData: any): number {
    // 从合约数据中提取时间戳
    const content = contractData.content as any;
    if (!content || !content.fields) {
      return 0;
    }

    return content.fields.updated_at || 0;
  }

  /**
   * 获取建议
   */
  private getRecommendations(comparison: { isConsistent: boolean; differences: string[] }): string[] {
    if (comparison.isConsistent) {
      return ['✅ 数据一致，索引器可信', '🎯 可以正常使用索引器数据'];
    }

    const recommendations: string[] = [];

    if (comparison.differences.some(d => d.includes('状态不一致'))) {
      recommendations.push('⚠️  状态不一致，建议等待索引器同步');
      recommendations.push('🔍 可直接使用链上数据进行操作');
    }

    if (comparison.differences.some(d => d.includes('时间戳差异'))) {
      recommendations.push('⏰ 时间戳存在差异，可能是同步延迟');
      recommendations.push('⏳ 等待几秒后重新验证');
    }

    if (comparison.differences.some(d => d.includes('为空'))) {
      recommendations.push('❌ 数据获取失败，检查网络连接');
      recommendations.push('🛠️  联系技术支持排查问题');
    }

    return recommendations;
  }

  /**
   * 显示验证结果
   */
  private displayResult(result: VerificationResult): void {
    console.log('\n📊 验证结果:');
    console.log(`   任务ID: ${result.taskId}`);
    console.log(`   一致性: ${result.isConsistent ? '✅ 一致' : '❌ 不一致'}`);

    if (result.indexerData) {
      console.log('\n📋 索引器数据:');
      console.log(`   状态: ${result.indexerData.status || 'unknown'}`);
      console.log(`   更新时间: ${result.indexerData.updated_at ? new Date(result.indexerData.updated_at).toLocaleString() : 'unknown'}`);
    }

    if (result.contractData) {
      console.log('\n⛓️  链上数据:');
      console.log(`   状态: ${this.extractStatus(result.contractData)}`);
      console.log(`   更新时间: ${new Date(this.extractTimestamp(result.contractData)).toLocaleString()}`);
    }

    if (result.differences.length > 0) {
      console.log('\n⚠️  发现差异:');
      result.differences.forEach(diff => console.log(`   - ${diff}`));
    }

    if (result.recommendations.length > 0) {
      console.log('\n💡 建议:');
      result.recommendations.forEach(rec => console.log(`   ${rec}`));
    }
  }

  /**
   * 显示批量验证摘要
   */
  private displayBatchSummary(summary: BatchVerificationResult): void {
    console.log('\n📊 批量验证摘要:');
    console.log(`   总数: ${summary.total}`);
    console.log(`   ✅ 一致: ${summary.consistent}`);
    console.log(`   ❌ 不一致: ${summary.inconsistent}`);
    console.log(`   🚫 错误: ${summary.errors}`);
    console.log(`   📈 一致率: ${((summary.consistent / summary.total) * 100).toFixed(1)}%`);

    if (summary.inconsistent > 0) {
      console.log('\n⚠️  不一致的任务:');
      summary.details
        .filter(r => !r.isConsistent)
        .forEach(r => console.log(`   - ${r.taskId}: ${r.differences.join(', ')}`));
    }
  }
}
