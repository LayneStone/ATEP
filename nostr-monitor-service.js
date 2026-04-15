const WebSocket = require('ws');
const http = require('http');

// 配置
const CONFIG = {
  relayUrls: (process.env.RELAY_URLS || 'wss://relay.damus.io,wss://nos.lol,wss://offchain.pub').split(','),
  indexerUrl: process.env.INDEXER_URL || 'https://indexer.atep.work',
  apiToken: process.env.API_TOKEN || process.env.INDEXER_API_TOKEN || 'your_api_token_here',
  kinds: [36001, 36002, 36003, 36004, 36005, 36006, 36007, 36008, 36009, 36010, 36011, 36012, 36013],
  reconnectInterval: 5000, // 5秒重连
  heartbeatInterval: 30000 // 30秒心跳
};

// 存储最后处理的时间戳
const lastTimestamps = new Map();

// 连接到中继器
function connectToRelay(relayUrl) {
  console.log(`Connecting to ${relayUrl}...`);
  
  const ws = new WebSocket(relayUrl);
  
  ws.on('open', () => {
    console.log(`Connected to ${relayUrl}`);
    
    // 订阅事件
    const lastTimestamp = lastTimestamps.get(relayUrl) || 0;
    const filter = {
      kinds: CONFIG.kinds,
      since: lastTimestamp
    };
    
    const subscriptionId = Date.now().toString();
    ws.send(JSON.stringify([
      'REQ',
      subscriptionId,
      filter
    ]));
    
    console.log(`Subscribed to ${relayUrl} with filter:`, filter);
  });
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message[0] === 'EVENT') {
        const event = message[2];
        await handleEvent(event, relayUrl);
      } else if (message[0] === 'EOSE') {
        console.log(`End of stored events from ${relayUrl}`);
      } else if (message[0] === 'OK') {
        console.log(`Event acknowledged by ${relayUrl}:`, message);
      }
    } catch (error) {
      console.error(`Error processing message from ${relayUrl}:`, error);
    }
  });
  
  ws.on('error', (error) => {
    console.error(`Error from ${relayUrl}:`, error.message);
  });
  
  ws.on('close', (code, reason) => {
    console.log(`Connection to ${relayUrl} closed. Code: ${code}, Reason: ${reason}`);
    
    // 5秒后重连
    setTimeout(() => {
      console.log(`Reconnecting to ${relayUrl}...`);
      connectToRelay(relayUrl);
    }, CONFIG.reconnectInterval);
  });
  
  // 心跳检测
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(heartbeat);
    }
  }, CONFIG.heartbeatInterval);
  
  return ws;
}

// 处理事件
async function handleEvent(event, relayUrl) {
  try {
    console.log(`Received event from ${relayUrl}:`, event.id, `kind: ${event.kind}`);
    
    // 解析事件内容
    let payload;
    try {
      payload = JSON.parse(event.content);
    } catch (e) {
      console.log(`Event ${event.id} content is not valid JSON, skipping`);
      return;
    }
    
    // 检查是否是 ATEP 事件（必须包含 task_id）
    if (!payload.task_id) {
      console.log(`Event ${event.id} is not an ATEP event (missing task_id), skipping`);
      return;
    }
    
    console.log(`Event ${event.id} is an ATEP event, task_id: ${payload.task_id}`);
    
    // 更新最后时间戳
    lastTimestamps.set(relayUrl, event.created_at);
    
    // 推送到索引器（不阻塞）
    forwardToIndexer(event).catch(error => {
      console.error(`Failed to forward event ${event.id}:`, error.message);
    });
    
    console.log(`Event ${event.id} processing started`);
  } catch (error) {
    console.error(`Error handling event ${event.id}:`, error);
  }
}

// 推送到索引器
async function forwardToIndexer(event) {
  try {
    const response = await fetch(CONFIG.indexerUrl + '/internal/index', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.apiToken}`
      },
      body: JSON.stringify(event)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Indexer returned ${response.status}: ${response.statusText} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`Event ${event.id} forwarded successfully`);
    return result;
  } catch (error) {
    console.error(`Error forwarding event ${event.id}:`, error.message);
    // 不抛出错误，让服务继续运行
  }
}

// 启动所有中继器连接
function start() {
  console.log('Starting Nostr monitor service...');
  console.log(`Indexer URL: ${CONFIG.indexerUrl}`);
  console.log(`Monitoring kinds: ${CONFIG.kinds.join(', ')}`);
  console.log(`Relays: ${CONFIG.relayUrls.join(', ')}`);
  
  CONFIG.relayUrls.forEach(relayUrl => {
    connectToRelay(relayUrl);
  });
  
  // 定期保存时间戳（防止重启丢失太多数据）
  setInterval(() => {
    console.log('Current timestamps:', Object.fromEntries(lastTimestamps));
  }, 60000); // 每分钟打印一次
}

// 启动服务
start();
