import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { SimpleTimeUtils } from './simple-time-utils';

/**
 * 管理员验证结果
 */
export interface AdminVerificationResult {
  adminId: string;
  indexerData: any;
  contractData: any;
  isConsistent: boolean;
  differences: string[];
  recommendations: string[];
}

/**
 * 管理员验证工具类
 */
export class AdminVerificationTools {
  private client: SuiClient;
  private indexerUrl: string;

  constructor(indexerUrl: string = 'http://localhost:3000') {
    this.client = new SuiClient({ url: getFullnodeUrl('devnet') });
    this.indexerUrl = indexerUrl;
  }

  /**
   * 验证多签管理配置
   */
  async verifyMultiSigAdmin(multiSigAdminId: string): Promise<AdminVerificationResult> {
    console.log(`🔍 验证多签管理配置: ${multiSigAdminId}`);

    try {
      // 获取链上数据
      const contractData = await this.getContractData(multiSigAdminId);

      // 多签管理配置主要在链上，索引器可能没有相关数据
      const result: AdminVerificationResult = {
        adminId: multiSigAdminId,
        indexerData: null, // 索引器通常不存储管理配置
        contractData,
        isConsistent: true, // 链上数据即为权威数据
        differences: [],
        recommendations: this.getAdminRecommendations(contractData)
      };

      this.displayAdminResult(result);
      return result;

    } catch (error: any) {
      console.error(`❌ 验证失败: ${error.message}`);
      
      return {
        adminId: multiSigAdminId,
        indexerData: null,
        contractData: null,
        isConsistent: false,
        differences: [`验证失败: ${error.message}`],
        recommendations: ['检查多签管理ID是否正确', '确认网络连接正常', '联系技术支持']
      };
    }
  }

  /**
   * 获取链上数据
   */
  private async getContractData(objectId: string): Promise<any> {
    try {
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
   * 获取管理员配置建议
   */
  private getAdminRecommendations(contractData: any): string[] {
    const recommendations: string[] = [];

    if (!contractData) {
      return ['❌ 无法获取链上数据，检查对象ID是否正确'];
    }

    const content = contractData.content as any;
    if (!content || !content.fields) {
      return ['❌ 对象内容格式异常'];
    }

    const fields = content.fields;

    // 检查管理员配置
    if (fields.admins && Array.isArray(fields.admins)) {
      recommendations.push(`✅ 管理员数量: ${fields.admins.length}`);
      
      if (fields.admins.length === 3) {
        recommendations.push('✅ 管理员配置正确 (3/3)');
      } else {
        recommendations.push('⚠️  管理员数量异常，期望3个');
      }
    }

    // 检查待执行操作
    if (fields.pending_op_type === 0) {
      recommendations.push('✅ 当前无待执行操作');
    } else {
      recommendations.push(`⚠️  有待执行操作: ${fields.pending_op_type}`);
      
      if (fields.proposal_time) {
        const timeLockStatus = SimpleTimeUtils.formatAdminTimeLockStatus(fields.proposal_time);
        
        if (timeLockStatus.isExpired) {
          recommendations.push('✅ 时间锁已到期，可以执行批准');
        } else {
          recommendations.push(`⏰ 时间锁剩余: ${timeLockStatus.remainingTime}`);
          recommendations.push(`📅 到期时间: ${timeLockStatus.deadline}`);
        }
      }
    }

    // 检查签名状态
    if (fields.approvals !== undefined) {
      const approvals = fields.approvals;
      const threshold = 2; // 2/3 阈值
      
      if (approvals >= threshold) {
        recommendations.push('✅ 已达到多签阈值，可以执行操作');
      } else {
        recommendations.push(`📊 当前签名: ${approvals}/3，需要${threshold}个签名`);
      }
    }

    return recommendations;
  }

  /**
   * 显示管理员验证结果
   */
  private displayAdminResult(result: AdminVerificationResult): void {
    console.log('\n📊 多签管理配置验证结果:');
    console.log(`   管理ID: ${result.adminId}`);
    console.log(`   一致性: ${result.isConsistent ? '✅ 正常' : '❌ 异常'}`);

    if (result.contractData) {
      console.log('\n⛓️  链上配置:');
      
      const content = result.contractData.content as any;
      if (content && content.fields) {
        const fields = content.fields;
        
        console.log(`   管理员数量: ${fields.admins?.length || 0}`);
        console.log(`   待执行操作: ${this.getOperationName(fields.pending_op_type)}`);
        
        if (fields.proposal_time) {
          console.log(`   提议时间: ${new Date(fields.proposal_time).toLocaleString()}`);
        }
        
        console.log(`   签名状态: ${fields.approvals || 0}/3`);
      }
    }

    if (result.differences.length > 0) {
      console.log('\n⚠️  发现问题:');
      result.differences.forEach(diff => console.log(`   - ${diff}`));
    }

    if (result.recommendations.length > 0) {
      console.log('\n💡 配置状态:');
      result.recommendations.forEach(rec => console.log(`   ${rec}`));
    }
  }

  /**
   * 获取操作名称
   */
  private getOperationName(opType: number): string {
    switch (opType) {
      case 0: return '无';
      case 1: return '更新捐赠地址';
      case 2: return '转移管理权';
      default: return '未知';
    }
  }

  /**
   * 验证白名单事件
   */
  async verifyVerifierWhitelist(since?: number): Promise<void> {
    console.log('🔍 验证仲裁员白名单事件...');

    try {
      // 这里可以添加白名单验证逻辑
      // 比如检查白名单事件的完整性、签名等
      
      console.log('✅ 白名单验证功能待实现');
      console.log('💡 建议: 使用 query-whitelist 命令查看当前白名单');
      
    } catch (error: any) {
      console.error(`❌ 白名单验证失败: ${error.message}`);
    }
  }
}
