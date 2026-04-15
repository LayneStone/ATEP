/**
 * Sui Contract Poller - Node.js Version
 * 
 * 功能：定时轮询 Sui 链上合约事件，推送到索引器
 * 增量更新：只处理上次轮询之后的新事件
 */

const cron = require('node-cron');

// 环境变量
const SUI_RPC_URL = process.env.SUI_RPC_URL || 'https://fullnode.devnet.sui.io:443';
const INDEXER_URL = process.env.INDEXER_URL || 'https://indexer.atep.work';
const PACKAGE_ID = process.env.PACKAGE_ID || '0x955313e42d8b2e7e34c435dd35c3c727043721a1c7c07eb3a3b0ecbdece9c9';
const INDEXER_API_TOKEN = process.env.INDEXER_API_TOKEN || 'your_api_token_here';
const POLL_INTERVAL = process.env.POLL_INTERVAL || 60;

// 存储最后轮询时间戳（内存存储，生产环境应使用数据库或 KV）
let lastPollTimestamp = Math.floor(Date.now() / 1000) - 86400; // 24小时前，确保捕获测试任务

console.log('[CONFIG] SUI_RPC_URL:', SUI_RPC_URL);
console.log('[CONFIG] INDEXER_URL:', INDEXER_URL);
console.log('[CONFIG] PACKAGE_ID:', PACKAGE_ID);
console.log('[CONFIG] POLL_INTERVAL:', POLL_INTERVAL, 'seconds');

async function pollSuiContracts() {
  console.log('[POLL] Starting Sui contract polling...');
  console.log('[POLL] Last timestamp:', lastPollTimestamp);

  try {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    
    // 获取最近的链上事件
    const events = await fetchSuiEvents(SUI_RPC_URL, PACKAGE_ID, lastPollTimestamp);
    console.log(`[POLL] Received ${events.length} new events from Sui chain`);

    // 将事件推送到索引器
    let forwardedCount = 0;
    for (const event of events) {
      try {
        await forwardContractEvent(event, INDEXER_URL, INDEXER_API_TOKEN);
        forwardedCount++;
      } catch (error) {
        console.error('[POLL] Error forwarding contract event:', error);
      }
    }

    // 无论是否有新事件，都更新时间戳，确保轮询持续推进
    lastPollTimestamp = currentTimestamp;
    console.log(`[POLL] Updated last poll timestamp to ${lastPollTimestamp}`);
    console.log(`[POLL] Forwarded ${forwardedCount} events`);
  } catch (error) {
    console.error('[POLL] Sui polling error:', error);
  }
}

async function fetchSuiEvents(rpcUrl, packageId, sinceTimestamp) {
  try {
    console.log('[FETCH] Fetching events from Sui RPC...');
    console.log('[FETCH] Package ID:', packageId);
    console.log('[FETCH] Since timestamp:', sinceTimestamp);

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_queryEvents',
        params: [{
          MoveModule: {
            package: packageId,
            module: 'atep'
          }
        }]
      })
    });

    console.log('[FETCH] Response status:', response.status);

    if (response.ok) {
      const data = await response.json();
      const events = data.result?.data || [];

      console.log('[FETCH] Total events received:', events.length);

      // 打印第一个事件的结构用于调试
      if (events.length > 0) {
        console.log('[FETCH] First event sample:', JSON.stringify(events[0], null, 2));
      }

      // 二次过滤时间戳（确保准确性）
      if (sinceTimestamp) {
        const filteredEvents = events.filter(event => {
          const eventTimestamp = event.timestampMs ? Math.floor(event.timestampMs / 1000) : 0;
          console.log(`[FETCH] Event timestamp: ${eventTimestamp}, Since: ${sinceTimestamp}, Keep: ${eventTimestamp > sinceTimestamp}`);
          return eventTimestamp > sinceTimestamp;
        });
        console.log('[FETCH] Filtered events count:', filteredEvents.length);
        return filteredEvents;
      }

      return events;
    } else {
      console.error('[FETCH] Sui RPC request failed:', response.status);
      const errorText = await response.text();
      console.error('[FETCH] Error response:', errorText);
      return [];
    }
  } catch (error) {
    console.error('[FETCH] Sui RPC error:', error);
    return [];
  }
}

async function forwardContractEvent(event, indexerUrl, apiToken) {
  try {
    console.log('[FORWARD] Processing event, type:', event.type);

    // 获取交易详情以提取对象 ID
    const objectId = await extractObjectIdFromEvent(event, SUI_RPC_URL);

    // 将 Sui 链上事件转换为索引器可识别的格式
    const contractEvent = {
      task_id: extractTaskId(event),
      sui_object_id: objectId,
      tx_hash: event.transactionDigest,
      sui_package_id: event.packageId,
      timestamp: event.timestampMs ? Math.floor(event.timestampMs / 1000) : Math.floor(Date.now() / 1000),
      status: extractStatus(event),
    };

    console.log('[FORWARD] Forwarding event:', contractEvent);

    const response = await fetch(indexerUrl + '/internal/contract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      body: JSON.stringify(contractEvent)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Indexer returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('[FORWARD] Event forwarded successfully');
    return result;
  } catch (error) {
    console.error('[FORWARD] Error forwarding contract event:', error);
    throw error;
  }
}

function extractTaskId(event) {
  // 从事件中提取 task_id
  if (event.parsedJson && event.parsedJson.task_id) {
    // task_id 是字节数组，需要转换为 hex 字符串
    const taskIdBytes = event.parsedJson.task_id;
    if (Array.isArray(taskIdBytes)) {
      return Buffer.from(taskIdBytes).toString('hex');
    }
    return taskIdBytes;
  }
  return null;
}

async function extractObjectIdFromEvent(event, rpcUrl) {
  try {
    // 如果事件中有 packageObjectId，直接使用
    if (event.packageObjectId) {
      return event.packageObjectId;
    }

    // 否则查询交易详情获取创建/修改的对象
    const txDigest = event.id?.txDigest;
    if (!txDigest) {
      console.warn('[EXTRACT] No txDigest in event');
      return null;
    }

    console.log('[EXTRACT] Querying transaction details for:', txDigest);

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getTransactionBlock',
        params: [txDigest, {
          showObjectChanges: true
        }]
      })
    });

    if (response.ok) {
      const data = await response.json();
      const tx = data.result;

      console.log('[EXTRACT] Transaction keys:', Object.keys(tx || {}));
      console.log('[EXTRACT] Has objectChanges:', !!(tx && tx.objectChanges));

      // 从交易中查找 Task 类型的创建对象
      if (tx && tx.objectChanges) {
        console.log('[EXTRACT] ObjectChanges count:', tx.objectChanges.length);
        for (const change of tx.objectChanges) {
          console.log('[EXTRACT] Change:', change.type, change.objectType);
          if (change.objectType && change.objectType.includes('atep::Task')) {
            if (change.type === 'created' || change.type === 'mutated') {
              console.log('[EXTRACT] Found task object:', change.objectId);
              return change.objectId;
            }
          }
        }
      }

      // 如果没有找到 Task 对象，返回 null
      console.warn('[EXTRACT] No task object found in transaction');
      return null;
    } else {
      console.error('[EXTRACT] Failed to query transaction:', response.status);
      const errorText = await response.text();
      console.error('[EXTRACT] Error response:', errorText);
      return null;
    }
  } catch (error) {
    console.error('[EXTRACT] Error extracting object ID:', error);
    return null;
  }
}

function extractObjectId(event) {
  // 从事件中提取 object_id（已废弃，使用 extractObjectIdFromEvent）
  if (event.packageObjectId) {
    return event.packageObjectId;
  }
  if (event.id && event.id.txDigest) {
    return event.id.txDigest;
  }
  return null;
}

function extractStatus(event) {
  // 从事件中提取状态
  // 根据事件类型返回对应的状态
  if (event.type) {
    if (event.type.includes('TaskCreated')) {
      return 'CREATED';
    } else if (event.type.includes('TaskLocked')) {
      return 'LOCKED';
    } else if (event.type.includes('TaskDelivered')) {
      return 'DELIVERED';
    } else if (event.type.includes('DeliveryReviewed') || event.type.includes('TaskCompleted')) {
      return 'COMPLETED';
    } else if (event.type.includes('TaskCancelled')) {
      return 'CANCELLED';
    }
  }
  return null;
}

// 启动定时任务
console.log('[START] Starting contract poller...');
console.log(`[START] Schedule: every ${POLL_INTERVAL} seconds`);

// 使用 node-cron，格式为 "秒 分 时 日 月 周"
const cronPattern = `*/${POLL_INTERVAL} * * * * *`;
cron.schedule(cronPattern, () => {
  console.log('[CRON] Triggering poll...');
  pollSuiContracts();
});

// 立即执行一次
pollSuiContracts();

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM signal received');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT signal received');
  process.exit(0);
});
