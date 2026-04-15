# 快速开始

5分钟上手 ATEP CLI。

## 测试环境配置

ATEP 提供测试环境索引器供用户测试使用：

```bash
# 设置测试环境索引器（可选，CLI已默认配置）
export INDEXER_URL=https://indexer.atep.work

# 设置devnet包ID（可选，CLI已默认配置）
export SUI_PACKAGE_ID=0x955313e42d8b2e7e34c435dd35c3c727043721a1c7c07eb3a3b0ecbdece9c9
```

**注意**：测试环境索引器可能不稳定，仅供测试使用。生产环境请自行部署索引器。

## 安装

### 1. 克隆仓库

```bash
git clone https://github.com/your-org/atep.git
cd atep
```

### 2. 安装依赖

```bash
npm install
```

### 3. 安装外部工具

**Sui CLI** - [官方安装文档](https://docs.sui.io/build/install)

```bash
# macOS
brew install sui

# Linux
cargo install --locked --git https://github.com/MystenLabs/sui.git sui

# 验证安装
sui --version
```

**Nostr CLI** - [nostr-cli](https://github.com/fiatjaf/nostr-cli)

```bash
npm install -g nostr-cli
```

## 基本使用

### 作为甲方：发布任务

```bash
# 1. 生成任务ID
cd cli
npm run atep:cli -- create-task-id \
  --pubkey "your_nostr_pubkey" \
  --task-name "开发网站"

# 输出示例：
# {
#   "task_id": "0xabc123..."
# }

# 2. 准备托管交易
npm run atep:cli -- prepare-escrow \
  --task-id "0xabc123..." \
  --expected-ttl 3600 \
  --boss-pubkey "your_nostr_pubkey" \
  --verifier-nostr-pubkey "verifier_pubkey" \
  --arbitrator-sui-address "verifier_address" \
  --payload-hash "0000000000000000000000000000000000000000000000000000000000000001" \
  --acceptance-hash "0000000000000000000000000000000000000000000000000000000000000002"

# 输出会包含 Sui CLI 命令，复制并执行

# 3. 执行链上交易
sui client call [输出的命令]

# 4. 准备广播事件
npm run atep:cli -- prepare-announce \
  --task-id "0xabc123..." \
  --task-object-id "0xobject_id" \
  --boss-pubkey "your_nostr_pubkey"

# 输出会包含 Nostr 事件数据，使用 Nostr CLI 广播
```

### 作为乙方：接任务

```bash
# 1. 查询任务
npm run atep:cli -- query \
  --indexer-url http://your-indexer.com:7071

# 2. 竞标
npm run atep:cli -- prepare-bid \
  --task-id "0xabc123..." \
  --worker-pubkey "your_nostr_pubkey" \
  --worker-sui-address "your_address" \
  --bid-amount 1000000000

# 3. 广播竞标（使用 Nostr CLI）
nostr-cli publish [输出的数据]

# 4. 执行任务（你的业务逻辑）

# 5. 提交交付
npm run atep:cli -- prepare-submit-escrow \
  --task-object-id "0xobject_id" \
  --delivery-hash "delivery_hash"

# 6. 执行链上交易
sui client call [输出的命令]
```

## 测试网

### 申请测试币

```bash
sui client faucet
```

### 查看余额

```bash
sui client gas
```

## 常见问题

### Q: 如何生成 Nostr 密钥？

A: 使用 Nostr CLI：

```bash
nostr-cli generate
```

### Q: 如何获取 Sui 地址？

A: 使用 Sui CLI：

```bash
sui client active-address
```

### Q: 索引器连接不上怎么办？

A: 检查索引器是否启动，检查网络连接。

### Q: 链上交易失败怎么办？

A: 检查 gas 余额，检查参数格式，查看错误信息。

## 下一步

- 阅读 [完整文档](./README.md)
- 查看 [CLI 使用文档](./cli/README.md)
- 查看 [合约文档](./contracts-sui/README.md)
- 加入 [Discord 社区](https://discord.gg/your-link)

## 需要帮助？

- 提交 [GitHub Issue](https://github.com/your-org/atep/issues)
- 发送邮件至 layne.chn@gmail.com
