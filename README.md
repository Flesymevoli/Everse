# YunoTavern

Spend tokens on storytelling, not infrastructure.

本地优先的开源 AI 互动小说应用，独立 TypeScript Narrative Runtime，MIT 许可证。当前为 Windows 开发版，需要 Node.js 24.20+；尚无桌面安装包。项目旧名 Narrative Slice，现有目录、GitHub 仓库地址和数据库路径保持不变。

## Windows 启动

在项目目录打开 PowerShell：

```powershell
npm install
npm run dev
```

已安装依赖可直接执行第二条。打开 http://127.0.0.1:5173/ 。本地后端监听 127.0.0.1:8787，Ctrl+C 停止服务。数据位于 `data/game.sqlite`，备份前先停止服务；不要删除 data 目录。

## 创建作品和开始游戏

1. 左侧切换“世界书 / 角色卡”。世界书和角色卡都可新建或导入；设定可以只有几个字，程序不会自动扩写。
2. 世界书支持 Yuno 世界书 JSON（见 examples/world-card.json）和独立酒馆世界书 JSON。角色卡支持 SillyTavern V2/V3 JSON、PNG chara/ccv3 元数据。
3. 点击“新建存档”，选择世界书与角色卡，至少选择一个。世界书的开场优先；未填写则使用角色开场。两种设定均进入后续上下文。
4. 默认使用免费固定模拟回复。输入行动发送，完整回合自动保存；刷新后从卡片下展开存档继续。
5. 展开世界书可编辑名称、设定、开场和条目（关键词、内容、常驻/停用、新增/移除）。原先管理区导入的独立世界书也有编辑入口。所有绑定该书的存档从下一轮使用新内容，已有消息、开场、分支及绑定不改写。
6. 展开角色卡可编辑名称、人物设定、性格、场景和开场白。未编辑的高级字段保留，已有聊天不变；设定下一轮生效，开场修改用于新存档。编辑前副本保存在数据库，暂未提供角色卡回退 UI。

旧导入作品仍作为角色卡显示，旧存档不自动增加世界书。世界书是本应用的资源概念，不冒充 SillyTavern 的标准格式；酒馆场景角色卡仍从角色卡入口导入。

## 多 API 连接和安全保存

设置 → 添加 API 连接，填写名称、Base URL、模型 ID 与 API Key，点击“保存连接与 Key”。Base URL 通常以 `/v1` 结尾，不包含 `/chat/completions`；程序追加该路径。主界面输入框旁可选择连接，下一次发送或重新生成使用该连接。

- Windows 使用当前用户 DPAPI 加密 Key 后存入本地 SQLite，服务端在发请求时解密，列表只返回“已保存”状态，不回传 Key。刷新后选中保存的连接即可使用，无需重填。默认仍恢复免费模拟模式。
- 修改 Key：填写新值再保存；留空保留已有 Key。可单独删除已保存 Key，也可删除整个连接。修改 API 地址时必须重新填写 Key 或先删除旧 Key。
- 尚未保存的连接仍可临时使用，Key 只留在页面内存。旧浏览器连接元信息自动显示，点击保存可迁移到本机数据库。
- 不把明文 Key 存入 localStorage、存档或日志。DPAPI 绑定当前 Windows 用户；复制数据库到另一台电脑/账号不能保证解密。当前不支持其他平台的加密保存，也不降级为明文。
- 这是本机单用户应用：DPAPI 不隔离同一 Windows 账号下的恶意程序。删除是逻辑删除，不承诺清除备份/磁盘中的旧密文。不要将开发服务公开到局域网或公网。

实现依据：[Microsoft DPAPI / ProtectedData](https://learn.microsoft.com/en-us/dotnet/standard/security/how-to-use-data-protection)。无需安装额外依赖或修改系统安全设置。

## 当前功能与限制

- 连续阅读、流式回复、停止生成、可选行动建议、复制、重新生成和候选 Swipe；完整原文保留。失败或取消不写入半轮。
- 设置中的管理区支持独立世界书/Chat Completions 预设导入与绑定、常用采样参数、聊天 JSONL 导入导出、改名、归档、编辑撤销、分支。
- 独立世界书支持关键词/二级选择逻辑、递归、概率和深度插入；角色内嵌书仍为旧的基础匹配算法。不同世界书之间尚无跨书递归。
- 预设只执行部分相对顺序、marker 与角色覆盖规则，不是完整 SillyTavern 兼容。未知字段保留并提示，完整差异见兼容性清单。
- 世界书的设定作为独立系统消息置于上下文前部，属于本应用组合语义；预设没有世界书专用 marker。世界书高级字段（例如概率、深度等）的图形编辑、卡片删除尚未实现；未展示字段保存时保留。
- 无群聊、Persona、完整宏、正则脚本、CHARX、自动记忆或多人。右侧状态/背包仍为占位。JSONL 不打包世界书资源。
- Token 为 UTF-8 字节与消息开销的保守估算；真实供应商/模型尚未逐一验证。纯文本渲染，不执行导入脚本或 HTML。

## 检查与验证

```powershell
npm run check
npm test
npm run build
```

2026-11-09：类型检查、生产构建及 29 项测试通过，包括 Windows 真实 DPAPI 加密/重开/替换/删除、双本地 HTTP 服务连接切换、世界与角色组合、角色与世界书编辑保留未知字段及旧存档兼容、生成中禁止编辑共享资源。只使用假测试 Key、固定模拟回复和回环 HTTP 服务，未调用付费模型。浏览器点击验收尚未完成，接口测试不等于界面验收。

## 源码与文档

从 `server/context.ts` 开始阅读，再沿 `server/app.ts` 追踪回合。

- `server/secrets.ts`、`connection-vault.ts`：Windows 密钥保护与连接存取。
- `server/worlds.ts`、`cards.ts`、`store.ts`：世界书、角色卡与 SQLite。
- `src/Library.tsx`：分类作品库、新建/编辑、组合开局。
- `src/ConnectionSettings.tsx`、`ModelPicker.tsx`：多 API 管理与选择。

[PRD](docs/PRD.md) · [UX](docs/UX.md) · [架构](docs/ARCHITECTURE.md) · [兼容性清单](docs/COMPATIBILITY.md)

世界书编辑会事务保存修改前副本到 asset_revisions，暂未提供副本恢复 UI。保留旧版 yuno_world_v1、worlds API 和 worldId 存档字段以兼容已有数据；界面统一称“世界书”。从 ST 独立世界书导入后，应用新增的名称/背景/开场存于导出 JSON 的 `_yunotavern` 元信息中，ST entries 及其他原字段保持原路径。
