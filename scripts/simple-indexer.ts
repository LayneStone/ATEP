#!/usr/bin/env tsx

/**
 * 简化的索引器模拟服务
 * 提供基本的任务和竞标查询功能
 */

import { createServer } from 'http';
import { URL } from 'url';

// 模拟数据存储
const mockTasks = new Map();
const mockBids = new Map();
const mockVerifiers = new Map();

// 初始化模拟数据
function initializeMockData() {
  // 添加一些示例任务
  mockTasks.set('4f7dad01bcbc9ed4eb579b2d021a5f6db932b1912775d36c0ef07f78aab7afb4', {
    task_id: '4f7dad01bcbc9ed4eb579b2d021a5f6db932b1912775d36c0ef07f78aab7afb4',
    task_name: '智能合约开发任务',
    sui_object_id: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    boss_address: '0xboss1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    worker_address: null,
    verifier_address: '0xverifier1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    reward_amount: '1000000000',
    asset: 'SUI',
    business_status: 'BIDDING',
    created_at: 1640995200000,
    updated_at: 1640995200000,
    bid_closing_seconds: 3600,
    expected_ttl_seconds: 86400,
    delivery_submitted: false,
    is_reviewed: false,
    review_result: null,
    is_in_arbitration: false,
    has_responded: false,
    boss_nostr_pubkey: 'npub1testclient1234567890abcdef1234567890abcdef1234567890abcdef',
    verifier_nostr_pubkey: 'npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });

  // 添加示例竞标
  mockBids.set('4f7dad01bcbc9ed4eb579b2d021a5f6db932b1912775d36c0ef07f78aab7afb4', [
    {
      worker_pubkey: 'npub1worker1234567890abcdef1234567890abcdef1234567890abcdef',
      worker_sui_address: '0xworker1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      capability_proof: '过往项目链接: https://github.com/user/project',
      bid_time: '2024-01-15T10:30:00.000Z',
      event_id: 'event001'
    },
    {
      worker_pubkey: 'npub1worker567890abcdef1234567890abcdef1234567890abcdef123456',
      worker_sui_address: '0xworker567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      capability_proof: '5年区块链开发经验',
      bid_time: '2024-01-15T11:00:00.000Z',
      event_id: 'event002'
    }
  ]);

  // 添加示例仲裁员
  mockVerifiers.set('verifiers', [
    {
      pubkey: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
      sui_address: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      status: '有效',
      effective_from: '2024-01-01T00:00:00.000Z',
      expires_at: '2025-12-31T23:59:59.000Z',
      added_at: '2024-01-01T00:00:00.000Z'
    },
    {
      pubkey: 'f1e2d3c4b5a69788990011223344556677889900aabbccddeeff001122334455',
      sui_address: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
      status: '有效',
      effective_from: '2024-06-01T00:00:00.000Z',
      expires_at: '2025-05-31T23:59:59.000Z',
      added_at: '2024-06-01T00:00:00.000Z'
    }
  ]);
}

// 处理请求
function handleRequest(req: any, res: any) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    if (parsedUrl.pathname === '/tasks' && req.method === 'GET') {
      // 获取所有任务
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.from(mockTasks.values())));
      return;
    }

    if (parsedUrl.pathname === '/whitelist' && req.method === 'GET') {
      // 获取仲裁员白名单
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          whitelist: mockVerifiers.get('verifiers') || [],
          last_updated: new Date().toISOString(),
          source: 'nostr_relay'
        }
      }));
      return;
    }

    if (parsedUrl.pathname.startsWith('/tasks/') && req.method === 'GET') {
      const taskId = parsedUrl.pathname.split('/')[2];
      
      if (parsedUrl.pathname.includes('/bids')) {
        // 获取任务竞标
        const bids = mockBids.get(taskId) || [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bids));
        return;
      }
      
      // 获取单个任务
      const task = mockTasks.get(taskId);
      if (task) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found', path: parsedUrl.pathname }));
      }
      return;
    }

    if (parsedUrl.pathname === '/verifiers' && req.method === 'GET') {
      // 获取仲裁员列表
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockVerifiers.get('verifiers') || []));
      return;
    }

    // 默认响应
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: parsedUrl.pathname }));
    
  } catch (error: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

// 启动服务器
function startServer(port: number = 7071) {
  initializeMockData();
  
  const server = createServer(handleRequest);
  
  server.listen(port, () => {
    console.log(`🚀 模拟索引器服务启动在端口 ${port}`);
    console.log(`📋 可用端点:`);
    console.log(`   GET /tasks - 获取所有任务`);
    console.log(`   GET /tasks/{taskId} - 获取单个任务`);
    console.log(`   GET /tasks/{taskId}/bids - 获取任务竞标`);
    console.log(`   GET /verifiers - 获取仲裁员列表`);
    console.log(`\n💡 现在可以测试 CLI 命令了！`);
  });
  
  server.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`⚠️  端口 ${port} 已被占用，尝试端口 ${port + 1}`);
      startServer(port + 1);
    } else {
      console.error('❌ 服务器启动失败:', error);
    }
  });
}

// 启动服务器
if (require.main === module) {
  startServer();
}

export { startServer };
