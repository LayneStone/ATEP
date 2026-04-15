#!/usr/bin/env tsx

/**
 * Dev 环境智能合约状态检查
 * 检查合约部署、交易执行和数据同步情况
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 配置
const CONFIG = {
  suiNetwork: process.env.SUI_NETWORK || 'devnet',
  suiPackageId: process.env.SUI_PACKAGE_ID || '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  indexerUrl: 'http://localhost:7071',
};

// 日志工具
function log(stage: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔍 ${stage}: ${message}`);
  if (data) {
    console.log(`   数据:`, JSON.stringify(data, null, 2));
  }
}

// 执行命令
async function runCommand(command: string): Promise<any> {
  try {
    const { stdout, stderr } = await execAsync(command);
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error: any) {
    return { stdout: '', stderr: error.message };
  }
}

// 检查 Sui CLI 安装
async function checkSuiCli(): Promise<boolean> {
  log('Sui CLI', '检查 Sui CLI 安装状态');
  
  const result = await runCommand('sui --version');
  if (result.stdout) {
    log('Sui CLI', `✅ 已安装: ${result.stdout}`);
    return true;
  } else {
    log('Sui CLI', '❌ 未安装或无法访问');
    return false;
  }
}

// 检查 Sui 网络连接
async function checkSuiNetwork(): Promise<boolean> {
  log('Sui 网络', `检查 ${CONFIG.suiNetwork} 网络连接`);
  
  const result = await runCommand(`sui client --network ${CONFIG.suiNetwork} gas`);
  if (result.stdout && !result.stderr) {
    log('Sui 网络', `✅ 网络连接正常`);
    return true;
  } else {
    log('Sui 网络', `❌ 网络连接失败: ${result.stderr}`);
    return false;
  }
}

// 检查合约包部署
async function checkPackageDeployment(): Promise<boolean> {
  log('合约包', `检查包 ${CONFIG.suiPackageId} 部署状态`);
  
  const result = await runCommand(`sui client --network ${CONFIG.suiNetwork} object ${CONFIG.suiPackageId}`);
  if (result.stdout && !result.stderr) {
    log('合约包', '✅ 合约包已部署');
    log('合约包', '包信息:', result.stdout);
    return true;
  } else {
    log('合约包', `❌ 合约包未部署或无法访问: ${result.stderr}`);
    return false;
  }
}

// 检查合约对象
async function checkContractObjects(): Promise<any[]> {
  log('合约对象', '检查已部署的合约对象');
  
  // 获取当前地址的对象
  const addressResult = await runCommand(`sui client --network ${CONFIG.suiNetwork} address`);
  if (!addressResult.stdout) {
    log('合约对象', '❌ 无法获取当前地址');
    return [];
  }
  
  const currentAddress = addressResult.stdout.trim();
  log('合约对象', `当前地址: ${currentAddress}`);
  
  // 获取对象列表
  const objectsResult = await runCommand(`sui client --network ${CONFIG.suiNetwork} objects --owned-by ${currentAddress}`);
  if (objectsResult.stdout) {
    log('合约对象', '✅ 获取对象列表成功');
    
    // 解析对象列表，查找任务对象
    const objects = parseObjects(objectsResult.stdout);
    const taskObjects = objects.filter(obj => 
      obj.type && obj.type.includes('Task') && 
      obj.type.includes(CONFIG.suiPackageId)
    );
    
    log('合约对象', `找到 ${taskObjects.length} 个任务对象`);
    taskObjects.forEach(obj => {
      log('合约对象', `任务对象: ${obj.objectId} - ${obj.type}`);
    });
    
    return taskObjects;
  } else {
    log('合约对象', '❌ 无法获取对象列表');
    return [];
  }
}

// 解析对象列表
function parseObjects(output: string): any[] {
  const objects = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    if (line.includes('│') && line.includes('0x')) {
      const parts = line.split('│').map(p => p.trim());
      if (parts.length >= 3) {
        objects.push({
          objectId: parts[0],
          type: parts[1],
          version: parts[2],
        });
      }
    }
  }
  
  return objects;
}

// 检查索引器状态
async function checkIndexerStatus(): Promise<boolean> {
  log('索引器', `检查索引器 ${CONFIG.indexerUrl} 状态`);
  
  try {
    const response = await fetch(`${CONFIG.indexerUrl}/health`);
    if (response.ok) {
      log('索引器', '✅ 索引器运行正常');
      return true;
    }
  } catch (error) {
    log('索引器', '❌ 索引器无法访问');
  }
  
  return false;
}

// 检查索引器数据
async function checkIndexerData(): Promise<any> {
  log('索引器', '检查索引器数据');
  
  try {
    const response = await fetch(`${CONFIG.indexerUrl}/tasks`);
    if (response.ok) {
      const tasks = await response.json();
      log('索引器', `✅ 索引器包含 ${tasks.length} 个任务`);
      
      // 显示前几个任务
      tasks.slice(0, 3).forEach((task: any, index: number) => {
        log('索引器', `任务 ${index + 1}: ${task.task_id} - ${task.business_status}`);
      });
      
      return tasks;
    }
  } catch (error) {
    log('索引器', '❌ 无法获取索引器数据');
  }
  
  return [];
}

// 模拟合约交易执行
async function simulateContractTransaction(): Promise<void> {
  log('合约交易', '模拟合约交易执行');
  
  // 使用之前测试的任务ID
  const testTaskId = 'd34eb374afe6a74094ceee9f729a9ecc082504ad871528f560912b261de773d3';
  
  // 检查任务是否在索引器中
  try {
    const response = await fetch(`${CONFIG.indexerUrl}/tasks/${testTaskId}`);
    if (response.ok) {
      const task = await response.json();
      log('合约交易', `✅ 任务在索引器中: ${task.business_status}`);
      
      // 检查对应的链上对象
      if (task.sui_object_id) {
        const objectResult = await runCommand(`sui client --network ${CONFIG.suiNetwork} object ${task.sui_object_id}`);
        if (objectResult.stdout && !objectResult.stderr) {
          log('合约交易', `✅ 链上对象存在: ${task.sui_object_id}`);
          log('合约交易', '对象详情:', objectResult.stdout);
        } else {
          log('合约交易', `❌ 链上对象不存在: ${task.sui_object_id}`);
        }
      }
    } else {
      log('合约交易', `❌ 任务不在索引器中`);
    }
  } catch (error) {
    log('合约交易', `❌ 无法检查任务状态`);
  }
}

// 检查数据同步
async function checkDataSync(): Promise<void> {
  log('数据同步', '检查合约与索引器数据同步');
  
  // 获取链上对象
  const contractObjects = await checkContractObjects();
  
  // 获取索引器数据
  const indexerTasks = await checkIndexerData();
  
  // 比较数据
  log('数据同步', `链上对象数: ${contractObjects.length}`);
  log('数据同步', `索引器任务数: ${indexerTasks.length}`);
  
  // 检查对应关系
  const syncedObjects = contractObjects.filter(obj => {
    return indexerTasks.some((task: any) => task.sui_object_id === obj.objectId);
  });
  
  log('数据同步', `同步对象数: ${syncedObjects.length}`);
  
  if (syncedObjects.length === contractObjects.length && contractObjects.length > 0) {
    log('数据同步', '✅ 数据同步正常');
  } else {
    log('数据同步', '⚠️  数据可能不同步');
  }
}

// 主检查流程
async function checkDevEnvironment(): Promise<void> {
  log('开始', '🔍 atep Dev 环境智能合约状态检查');
  log('开始', `配置: ${JSON.stringify(CONFIG, null, 2)}`);
  
  const checks = [
    { name: 'Sui CLI', fn: checkSuiCli },
    { name: 'Sui 网络', fn: checkSuiNetwork },
    { name: '合约包部署', fn: checkPackageDeployment },
    { name: '索引器状态', fn: checkIndexerStatus },
  ];
  
  let passedChecks = 0;
  
  // 基础检查
  for (const check of checks) {
    try {
      const result = await check.fn();
      if (result) passedChecks++;
      log('进度', `${result ? '✅' : '❌'} ${check.name} 完成`);
    } catch (error: any) {
      log('进度', `❌ ${check.name} 失败: ${error.message}`);
    }
  }
  
  // 详细检查
  if (passedChecks >= 3) {
    log('详细检查', '开始详细检查...');
    
    try {
      await checkContractObjects();
      await checkIndexerData();
      await simulateContractTransaction();
      await checkDataSync();
    } catch (error: any) {
      log('详细检查', `❌ 详细检查失败: ${error.message}`);
    }
  }
  
  // 总结
  log('总结', `🎯 检查完成: ${passedChecks}/${checks.length} 项通过`);
  
  if (passedChecks === checks.length) {
    log('总结', '🎉 Dev 环境状态良好，可以进行真实交易测试');
  } else {
    log('总结', '⚠️  部分检查未通过，需要配置相关组件');
  }
  
  log('总结', '💡 建议:');
  log('总结', '1. 确保 Sui CLI 已安装并配置');
  log('总结', '2. 部署智能合约到 Dev 网络');
  log('总结', '3. 启动索引器服务');
  log('总结', '4. 配置环境变量 SUI_NETWORK 和 SUI_PACKAGE_ID');
}

// 启动检查
if (require.main === module) {
  console.log('🔧 atep Dev 环境智能合约状态检查');
  console.log('📋 检查合约部署、交易执行和数据同步情况');
  console.log('');
  
  checkDevEnvironment();
}

export { checkDevEnvironment };
