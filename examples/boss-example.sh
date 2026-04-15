#!/bin/bash
# 甲方完整流程示例

# 配置
TASK_NAME="开发网站"
EXPECTED_TTL=3600
PAYLOAD_HASH="0000000000000000000000000000000000000000000000000000000000000001"
ACCEPTANCE_HASH="0000000000000000000000000000000000000000000000000000000000000002"
BOSS_PUBKEY="your_nostr_pubkey"
VERIFIER_PUBKEY="verifier_nostr_pubkey"
VERIFIER_ADDRESS="0xverifier_address"
INDEXER_URL="https://indexer.atep.work"

echo "=== 甲方任务发布流程 ==="

# 1. 生成任务ID
echo "步骤1: 生成任务ID"
TASK_ID=$(cd cli && npm run atep:cli -- create-task-id \
  --pubkey "$BOSS_PUBKEY" \
  --task-name "$TASK_NAME" \
  --json | jq -r '.task_id')
echo "任务ID: $TASK_ID"

# 2. 准备托管交易
echo "步骤2: 准备托管交易"
cd cli
npm run atep:cli -- prepare-escrow \
  --task-id "$TASK_ID" \
  --expected-ttl "$EXPECTED_TTL" \
  --boss-pubkey "$BOSS_PUBKEY" \
  --verifier-nostr-pubkey "$VERIFIER_PUBKEY" \
  --arbitrator-sui-address "$VERIFIER_ADDRESS" \
  --payload-hash "$PAYLOAD_HASH" \
  --acceptance-hash "$ACCEPTANCE_HASH"

echo ""
echo "请复制上面的 Sui CLI 命令并执行，然后继续..."
read -p "按回车继续..."

# 3. 准备广播事件
echo "步骤3: 准备广播事件"
npm run atep:cli -- prepare-announce \
  --task-id "$TASK_ID" \
  --task-object-id "$TASK_OBJECT_ID" \
  --boss-pubkey "$BOSS_PUBKEY"

echo ""
echo "请使用 Nostr CLI 广播上面的事件数据，然后继续..."
read -p "按回车继续..."

# 4. 查询任务
echo "步骤4: 查询任务"
npm run atep:cli -- query \
  --indexer-url "$INDEXER_URL" \
  --task-id "$TASK_ID"

echo "=== 任务发布完成 ==="
