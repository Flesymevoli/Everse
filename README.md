# Everse

**Spend tokens on storytelling, not infrastructure.**

本地优先、免费开源的 AI 互动小说应用（MIT，Alpha）。输入几个字的设定即可准备故事，也能导入 Word DOCX、TXT/Markdown、SillyTavern 角色卡、世界书和部分预设。只需要文本生成 API，不要求 Tool Calling。

当前优先保证自由叙事、玩家干预和持续游玩。Agent 引擎仍在迭代：尚无成熟的自主世界调度、通用 Skill/插件运行时，也未证明长篇成本优于直接聊天。

## 让 AI 帮你安装

把下面这段话发给能操作本机文件和终端的 AI：

> 请安装并启动 https://github.com/Flesymevoli/Everse 。先阅读 README.md、AGENTS.md 和 docs/INSTALL.md。在新的独立目录安装；Windows 执行 start.cmd，不要覆盖已有存档或修改全局 Node.js。先检查页面和本地存档，不要索取或调用我的真实 API Key。启动成功后告诉我本机地址和如何再次启动。

Windows 10/11 x64 推荐方式：下载本仓库 ZIP，**解压到可写目录后双击 `start.cmd`**。或使用 Git：

```powershell
git clone https://github.com/Flesymevoli/Everse.git Everse
cd Everse
.\start.cmd
```

首次启动需要网络：脚本从 Node.js 官网下载指定版本的便携运行时并校验 SHA-256，在项目目录安装锁定依赖、构建页面，然后启动并打开浏览器。无需管理员权限、不安装全局 Node.js、不修改系统 PATH 或 PowerShell 执行策略。以后仍运行同一文件；未变更时跳过安装和构建。

默认地址 **http://127.0.0.1:5173/**。保留启动窗口，Ctrl+C 停止。若端口被占用，脚本会报错，不会杀掉其他程序。Windows ARM64 下载入口已提供，但本轮只实际验证 x64。macOS/Linux 可尝试已有 Node.js 24.20+ 的命令行方式，尚未验收，且不支持保存 API Key。

已有 Node.js 24.20+：

```powershell
npm run setup
npm start
```

安装详解、无浏览器启动、端口、备份及更新见 [INSTALL](docs/INSTALL.md)。这是一键源码安装，尚无签名桌面安装包。

## 第一次游玩

1. 点击“创建故事 / 导入设定”，填可选存档名和几句背景，或导入设定文件。
2. 点击“进入故事”，不需要填写开场或预览。角色卡自带开场会保留；没有开场也能进入。身份可以留空，按作品初始化要求在正文中直接回复。
3. 直接输入，或点击“按设定开始”让 AI 引导；仅主动生成时调用 API，进入和刷新不会自动调用。生成前请添加并选中自己的模型。
4. 设置里添加 API 地址、模型和 Key，点击“保存连接与 Key”，再从输入框旁选中该连接。Base URL 通常以 `/v1` 结尾，不包含 `/chat/completions`。
5. 存档自动保留完整剧情。三点菜单可改名、打开存档设置、确认删除存档（永久删除，其他存档和共享作品不受影响）；重新生成/Swipe、消息编辑/撤销和分支可用于调整不满意的内容。

右侧“设定与剧情引导”中的“记为世界设定”会将独立输入框的原文保存到当前存档，不发送行动、不调用 AI。右侧故事引导可随时修改人物、状态/背包、世界观和剧情走向，下一轮生效；清空字段可撤销相应引导。普通聊天中的内容会保存为剧情，但不会擅自把所有发言提升为永久世界规则。

完整正文已生成、辅助状态格式不合格时，保留正文并提示状态未更新；旧状态不被错误数据覆盖，不自动付费重试。断流、取消、空回复与 API 明确报告截断仍保留草稿，避免把半段故事当成完整结果。

## 数据与 API Key

- 数据：`data/game.sqlite`；停止应用后备份整个 `data/` 目录。重新安装和启动不删除存档。
- Windows 保存 Key 使用当前用户 DPAPI 加密；列表不回传明文。可修改、删除，也可只在页面临时使用。跨 Windows 账号/机器迁移后可能需重新填写 Key。
- 不要把 `data/`、`.runtime/`、`.env` 或 Key 上传 GitHub。服务只监听回环地址，没有公网多用户认证，**不要将它暴露到公网**。
- 模型费用由所配置的服务商收取；软件本身免费。安装和自动测试不调用付费模型。

## 当前支持与边界

- 角色卡 V2/V3 JSON、PNG；独立世界书关键词、递归、概率和深度插入；部分 Chat Completions 预设与模型参数。未知字段保留并提示，不宣称完整酒馆兼容。
- 世界书/角色卡创建编辑，修改从下一轮生效；聊天 JSONL 导入导出。JSONL 不包含应用完整状态与文档，完整备份用 SQLite。
- 连续阅读、固定输入框、流式生成/停止、编号行动建议、Prompt Inspector。
- 正文选中后局部 AI 改写或手动编辑，预览确认后保存；支持恢复最近编辑（需尚未新增剧情）。选区可跨同一回复的多个段落。相关旧状态失效，可明确填写事实修订；不会自动重写后续情节。
- Word DOCX 原件与全文保存，分段检索；可主动分批 AI 分类并人工修正。没有默认一次分析全文；长 TXT/Markdown 仍有大小和上下文限制。
- 带原文依据的事实记录、玩家修订和基本检索；**模型记忆准确性不受保证**。无复杂 RPG 规则、自动后台世界、群聊、多人或任意第三方脚本执行。

详见 [兼容性](docs/COMPATIBILITY.md)、[Word 导入](docs/WORD-IMPORT.md)、[预算](docs/BUDGETS.md)。

## 开发与验证

```powershell
npm ci
npm run dev         # 开发模式：Vite 5173 + API 8787
npm run check
npm test
npm run build
npm run test:install # 隔离临时数据，实测单服务页面与模拟互动
```

普通使用与开发模式共用 5173，不能同时启动。测试仅使用模拟和回环 HTTP 服务；Windows 上包含 DPAPI 测试。CI 配置见 `.github/workflows/ci.yml`。

从 `server/story.ts`、`server/context.ts` 和 `server/app.ts` 阅读运行链路。安装入口为 `start.cmd` / `scripts/launcher.mjs`；单服务入口为 `server/index.ts`。

[PRD](docs/PRD.md) · [UX](docs/UX.md) · [架构](docs/ARCHITECTURE.md) · [Agent 增量方向](docs/AGENT-ALPHA.md) · [发布验证](docs/PUBLIC-RELEASE.md)

正文选区现在使用批注式小框，保留陶土色预览。“同步更新设定”在确认后保存当前存档修订并按需加入后续请求，不覆盖原卡片/世界书。右栏按同次生成提供的有依据字段展示人物和物品，允许手动修正；不预设统一 RPG 属性。旧存档不自动补算，需开启故事记忆后继续一轮；模型缺失/错误状态不阻断正文。

界面风格与交互约定见 [风格规范](docs/STYLE-GUIDE.md)。书架按世界/作品展开存档，角色卡与世界书的高级功能收纳在「管理角色卡与世界书」。
