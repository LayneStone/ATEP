# 贡献指南

感谢你对 ATEP 项目的关注！我们欢迎各种形式的贡献。

## 如何贡献

### 报告问题

如果你发现了 bug 或有功能建议，请提交 GitHub Issue：

1. 描述问题或建议
2. 提供复现步骤（如果是 bug）
3. 提供环境信息（操作系统、Node.js 版本等）
4. 如果可能，提供截图或日志

### 提交代码

如果你想贡献代码，请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码规范

- 使用 TypeScript
- 遵循现有的代码风格
- 添加必要的注释
- 确保代码通过类型检查 (`npm run build`)

### 提交信息规范

请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat:` 新功能
- `fix:` 修复 bug
- `docs:` 文档更新
- `style:` 代码格式（不影响功能）
- `refactor:` 重构
- `test:` 测试相关
- `chore:` 构建或工具相关

示例：
```
feat: add task expiration handling
fix: resolve package ID configuration issue
docs: update README with new examples
```

## 开发环境

### 环境要求

- Node.js >= 20
- TypeScript >= 5.0
- Sui CLI（用于合约交互）

### 安装依赖

```bash
npm install
```

### 构建

```bash
npm run build
```

### 测试

```bash
# CLI 测试
cd cli
npm run build
npm run atep:cli -- --help

# 合约测试
cd contracts-sui
sui move test
```

## 项目结构

```
atep/
├── cli/              # CLI 工具
├── contracts-sui/    # Sui 智能合约
├── nostr/            # Nostr 协议层
├── workers/          # Cloudflare Workers
├── indexer/          # 索引器服务
└── docs/             # 文档
```

## 获取帮助

如果你在贡献过程中遇到问题：

- 提交 GitHub Issue
- 发送邮件至 layne.chn@gmail.com
- 加入我们的 Discord 群（通过邮件获取）

## 行为准则

- 尊重所有贡献者
- 保持友好和专业
- 接受建设性的批评
- 关注对社区最有利的事情

## 许可证

通过贡献代码，你同意你的贡献将使用 MIT License 许可。
