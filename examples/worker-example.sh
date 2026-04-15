#!/bin/bash
# 乙方完整流程示例

# 配置
WORKER_PUBKEY="your_nostr_pubkey"
WORKER_ADDRESS="0xyour_address"
INDEXER_URL="https://indexer.atep.work"

echo "=== 乙方任务接单流程 ==="

# 1. 查询可用任务
echo "步骤1: 查询可用任务"
cd cli
npm run atep:cli -- query \
  --indexer-url "$INDEXER_URL"

echo ""
echo "请输入你要竞标的任务ID:"
read TASK_ID

# 2. 准备竞标
echo "步骤2: 准备竞标"
npm run atep:cli -- prepare-bid \
  --task-id "$TASK_ID" \
  --worker-pubkey "$WORKER_PUBKEY" \
  --worker-sui-address "$WORKER_ADDRESS" \
  --bid-amount 1000000000

echo ""
echo "请使用 Nostr CLI 广播上面的事件数据，然后继续..."
read -p "按回车继续..."

# 3. 等待甲方选择
echo "步骤3: 等待甲方选择任务"
echo "你可以定期查询任务状态..."
npm run atep:cli -- query \
  --indexer-url "$INDEXER_URL" \
  --task-id "$TASK_ID"

echo ""
echo "如果任务被锁定给你，请输入 task-object-id:"
read TASK_OBJECT_ID

# 4. 执行任务（你的业务逻辑）
echo "步骤4: 执行任务"
echo "这里执行你的业务逻辑..."
echo "例如：开发网站、数据分析、内容创作等"

# 5. 准备提交交付
echo "步骤5: 准备提交交付"
DELIVERY_HASH="0000000000000000000000000000000000000000000000000000000000000003"
npm run atep:cli -- prepare-submit-escrow \
  --task-object-id "$TASK_OBJECT_ID" \
  --delivery-hash "$DELIVERY_HASH"

echo ""
echo "请复制上面的 Sui CLI 命令并执行，然后继续..."
read -p "按回车继续..."

# 6. 准备交付广播
echo "步骤6: 准备交付广播"
npm run atep:cli -- prepare-submit-announce \
  --task-id "$TASK_ID" \
  --task-object-id "$TASK_OBJECT_ID" \
  --worker-pubkey "$WORKER_PUBKEY"

echo ""
echo "请使用 Nostr CLI 广播上面的事件数据"
echo "=== 任务接单流程完成 ==="
