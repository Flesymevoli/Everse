# Narrative Slice

Spend tokens on storytelling, not infrastructure.

本地优先、独立实现的 AI 文字游戏 Vertical Slice。项目暂名 Narrative Slice，使用 MIT 许可证。当前是开发版，需要 Node 24.20+，尚无桌面安装包。

## Windows 启动

在本文件所在目录打开 PowerShell。

```powershell
npm install
npm run dev
```

打开 http://127.0.0.1:5173 。后端仅监听 127.0.0.1:8787。退出开发服务用 Ctrl+C。已安装依赖的本机可直接执行第二条命令。

1. 导入 `examples/lantern.json` 或自己的 V2/V3 JSON 卡。
2. 点击“创建新游戏”，默认免费模拟模式。
3. 输入“我走向灯塔。”，发送并查看回复、Prompt Inspector 中的关键词条目。
4. 刷新网页，点击左侧存档恢复原文。
5. 使用自有 API 时展开设置，取消模拟模式，填写 Base URL（例如 https://api.example.com/v1）、模型 ID 与 API Key。密钥仅保留在当前页面内存，刷新后重填。开发者未调用付费 API。

## 已实现

角色基础信息和开场白导入、作品选择、多个本地存档、流式回复、完整回合自动保存、内嵌世界书基础关键词匹配、请求上下文和估算预算检查。原文存储于 `data/game.sqlite`，重启保留。预算只裁剪发送历史。失败回合不保存，输入保留供重试。连接意外中断时先重新打开存档确认是否已提交。

卡片的 system_prompt 和 post_history_instructions 会参与请求。纯文本渲染不执行导入内容。兼容警告列出保留但未使用的字段。

## 当前限制

- 只导入 JSON V2/V3。PNG、CHARX、独立世界书文件、预设文件、备选开场、示例对话、脚本、正则、MVU 和高级世界书策略尚未实现。
- 仅替换 {{char}} 和 {{user}}，玩家称呼固定为“玩家”。世界书扫描最近 6 条消息和本轮输入，所有命中内容按文件顺序放入系统消息。
- Token 用 UTF-8 字节与消息开销估算，偏保守，不能替代供应商精确计数。
- API 使用 Chat Completions 文本 SSE，无工具调用。供应商私有格式和所有真实模型尚未验证。
- 单机单服务进程；无多用户认证、删除/导出存档、自动记忆、桌面发行包。备份数据库前停止服务。
- 应用使用基础中性样式，作品视觉主题尚未实现。

## 检查

```powershell
npm run check
npm test
npm run build
npm run format
```

4 项自动测试覆盖卡片校验、关键词/预算、真实回环 HTTP SSE、导入到 SQLite 重新打开的完整流程。已通过类型检查、构建与上述测试。浏览器已实测导入示例、新建游戏、模拟回复、Prompt Inspector 和刷新恢复。

## 源码阅读

先读 `server/context.ts`，再沿 `server/app.ts` 追踪一次回合。cards.ts 负责格式边界，provider.ts 负责模型协议，store.ts 负责存档。界面在 src/main.tsx，样式在 src/style.css。

[产品范围](docs/PRD.md) · [轻量 UX 约定](docs/UX.md) · [架构](docs/ARCHITECTURE.md)

参考公开 [V2](https://github.com/malfoyslastname/character-card-spec-v2) 和 [V3](https://github.com/kwaroran/character-card-spec-v3) 格式规范独立实现。未复用其他酒馆项目源码。


## 阅读体验更新

暖纸色连续阅读界面、弱化的行动记录、可折叠书架与按需设置。行动建议默认关闭，按存档保存，启用后通过同次生成的末尾 JSON 区块获取 2～3 项，点击只填入输入框。格式失败保留原始正文，不自动重试。可停止上游生成，中断回合不保存，草稿保留在页面。复制已实现，消息编辑、重新生成、角色卡/世界书编辑删除仍待实现。
