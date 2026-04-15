# 示例代码

这个目录包含 ATEP 的使用示例。

## 示例列表

### boss-example.sh
甲方完整流程示例：
- 生成任务ID
- 准备托管交易
- 执行链上交易
- 广播任务事件

### worker-example.sh
乙方完整流程示例：
- 查询可用任务
- 准备竞标
- 执行任务
- 提交交付

## 使用方法

```bash
# 给脚本添加执行权限
chmod +x boss-example.sh
chmod +x worker-example.sh

# 运行甲方示例
./boss-example.sh

# 运行乙方示例
./worker-example.sh
```

## 注意事项

- 这些示例使用测试数据，实际使用时请替换为真实数据
- 需要先配置环境变量（Nostr 密钥、Sui 地址等）
- 需要先安装 Sui CLI 和 Nostr CLI
- 需要申请 devnet 测试币

## 自定义示例

你可以基于这些示例创建自己的脚本：

1. 复制示例文件
2. 修改配置参数
3. 添加你的业务逻辑
4. 测试运行
