# SillyTavern 兼容性清单

审查日期：2026-11-09。参考官方文档与官方 release 分支源码；本轮未能通过 Git 取得 release SHA（本机 TLS 凭据错误），因此以下是查阅时的行为基线，不声称锁定版本或完成与 ST 实机的差分测试。独立实现，不复制上游 AGPL 源码。完整支持仅指表中明确限定的子能力，不代表整个模块兼容。

## 初次审查基线（最新进度见文末）

| 类别/能力 | 审查前 → 本批后 | 实际行为及本地证据 |
|---|---|---|
| 原生：V2/V3 JSON 基本字段 | 部分 → 部分 | description/personality/scenario/首条消息可用；支持 JSON 与 PNG chara/ccv3 元数据导入，缺头像保存、CHARX 资源、管理编辑、示例对话。server/cards.ts、context.ts |
| JSON 原始字段保留/导出 | 部分 → 完整（JSON 对象语义往返） | 新导入单独保存原始对象，导出不补默认值；不保证空白、重复 JSON 键或数字字面量。旧卡只能导出已有存储对象。store.ts、cards.ts |
| 备选开场 | 未支持 → 部分 | 单人聊天首轮前可选并持久保存；尚无通用 Swipe 历史和群聊随机开场。app.ts、main.tsx |
| 原生：角色系统提示/历史后指令 | 部分 → 部分 | 当前直接注入，无 ST 的偏好开关、预设覆盖和 original 宏语义。context.ts |
| 原生：世界书 | 部分 → 部分 | 仅内嵌书、enabled/constant/keys/case_sensitive；固定最近 6 消息加输入、子串匹配、按文件顺序插系统提示。不支持独立书绑定、选择逻辑、正则、整词、递归、概率、深度位置、顺序、预算、定时效果。cards.ts、context.ts |
| 原生：预设/Prompt Manager | 未支持 → 未支持 | 无导入、提示顺序、marker、注入位置、模板与启用状态的执行；不是少一个设置页。context.ts |
| 原生：模型连接与参数 | 部分 → 部分 | OpenAI-compatible 文本 SSE、输出上限；缺采样参数、stop、seed、供应商适配。provider.ts |
| 原生：聊天管理 | 部分 → 部分 | 新建、多存档、SQLite 恢复可用；不是 ST JSONL；缺命名、导入导出、编辑、删除、分支和重新生成。store.ts、app.ts |
| 原生：宏/Token | 部分 → 部分 | 只替换 char/user，user 固定“玩家”；UTF-8 字节估算，不是 tokenizer。cards.ts、context.ts |
| 原生：Persona、通用 Swipe、群聊 | 未支持 → 未支持 | 无身份绑定、候选回复元数据、群成员/选人策略。备选开场子集不等于通用 Swipe |
| 内置扩展：Regex、Quick Reply、摘要/向量检索等 | 未支持 → 未支持 | Regex 是官方内置扩展，不是第三方任意 JS 执行器；触发位置、顺序及仅显示/仅提示的作用域均待实现 |
| 第三方：酒馆助手、MVU 等 | 未支持 → 未支持 | 不属于原生兼容承诺；未知 extensions 保留并警告，绝不执行导入脚本 |

本项目行动建议标记、角色状态/背包占位均不是 ST 原生兼容成果。界面仍采用独立阅读布局；复杂管理使用按需管理区域，不恢复右侧常驻编辑器。

## 依赖顺序和验收

1. **P0 角色数据保真（本批）**：原始 JSON 往返、未知字段警告、备选开场保存。验收：扩展深层字段不变；切换开场后重开仍一致；已有剧情不可被开场选择覆盖。
2. **P1 角色输入补齐 + 世界书**：先 PNG 提取/示例对话/宏必要子集，再独立世界书导入与绑定；分批实现关键词策略、顺序位置、扫描、预算和递归。原始书与运行视图分离，未知字段逐路径报告。验收：固定测试卡的命中条目、顺序、角色和插入位置与锁定 ST 版本对照，旧卡行为变更提供显式迁移选择。
3. **P2 预设与模型参数**：先 Chat Completions 预设，解析 prompts/prompt_order/启用项及覆盖规则，再映射采样参数；Text Completion 模板单独标注不兼容。验收：本地 HTTP 捕获实际 messages 与参数；未支持项展示警告，不做“已应用”假象；不把模型密钥放进预设。
4. **P3 聊天管理**：建立消息/Swipe 元数据，再实现 ST JSONL 无损导入导出、改名、编辑、删除与分支。验收：未知 extra 保留、编辑与删除有明确确认/恢复策略、导出再导入仍一致，旧 SQLite 原文不变。
5. **P4 进阶**：Persona → 通用 Swipe → 群聊 → Regex/Quick Reply 等内置扩展；第三方功能单独评估协议与安全，不以名称宣称兼容。

每批使用本地模拟 API、数据迁移回归和请求断言；真实付费模型不用于自动验收。当前尚未运行官方 ST 的同输入差分测试，后续先锁定 SHA 再建立对照夹具。

## 官方证据

- [角色定义与备选开场](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)；源码 src/endpoints/characters.js（字段格式化）、public/script.js（开场与 swipes）。
- [世界书](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)；public/scripts/world-info.js（扫描状态、选择逻辑、插入策略、预算）。
- [Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/)；public/scripts/PromptManager.js、public/scripts/openai.js（顺序及实际请求构建）。
- [聊天文件](https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/)；src/endpoints/chats.js。
- [Persona](https://docs.sillytavern.app/usage/core-concepts/personas/)、[群聊](https://docs.sillytavern.app/usage/core-concepts/groupchats/)。
- [扩展分类](https://docs.sillytavern.app/extensions/)、[内置 Regex](https://docs.sillytavern.app/extensions/regex/)。
- 上述源码均在 [官方 release 分支](https://github.com/SillyTavern/SillyTavern/tree/release)。文档说明与源码查阅不等于本项目已验证实现。

## P1 进展

已接入 PNG 元数据导入：server/png-card.ts 校验签名、块边界与 CRC，ccv3 优先于 chara；HTTP 和 UI 共用卡片校验与原始 JSON 存储。无图像像素解码，不是完整 PNG 图像验证；不保存头像，不支持 PNG 导出、CHARX、旧版无 spec JSON。12 项自动测试通过，尚未浏览器验证此次 PNG 上传。官方依据：https://github.com/SillyTavern/SillyTavern/blob/release/src/character-card-parser.js 。其余 P1–P4 项仍待实现，不计作完成。

## 四模块阶段交付（2026-11-09）

| 模块 | 当前可用 | 仍未对齐原生行为 |
|---|---|---|
| 世界书（部分支持） | 独立 ST entries 对象 JSON 导入/原始导出、按存档绑定、禁用/常驻、主关键词、二级 AND_ANY/NOT_ALL/NOT_ANY/AND_ALL、大小写、Unicode 整词、扫描深度、order 降序、position 0/1 | 内嵌书仍保留旧算法；不支持正则、递归、概率、独立 Token 预算、定时效果、分组和深度位置。未支持字段警告，非 0/1 位置条目跳过；整词 Unicode 规则未做 ST 实机差分 |
| 预设（部分支持） | 原始 JSON 导入导出、存档绑定、全局 100001 prompt_order 启用与相对顺序、静态提示及六个基础 marker、上下文/输出上限 | 不执行深度注入、角色专属顺序、示例对话 marker、模板、覆盖开关、其他宏、Text Completion 预设；跳过项显示警告。角色 system_prompt 在前，post_history 在末，区别于 ST 覆盖规则 |
| 模型参数（部分支持） | temperature/top_p/frequency_penalty/presence_penalty/seed/stop 真正发送，参数范围校验；存档覆盖预设，空值不发送，seed=-1 不发送 | 无供应商专有采样器或自动能力探测；模型可能拒绝不支持参数，需清空覆盖与预设字段 |
| 聊天管理（部分支持） | 改名、归档/恢复、JSONL 导入导出、原始头部与消息扩展保留、消息编辑与撤销、从指定消息建分支 | 归档代替永久删除，尚无重新生成、通用 Swipe 操作、附件搬运与群聊管理；导入 Swipe 元数据只保留、不执行。JSONL 非字节级往返，显式填写 mes/is_user |

管理入口：设置 → 管理世界书、预设与聊天。资源先导入后绑定当前存档，扫描与采样覆盖点击保存后生效。旧存档无绑定时沿用原有行为。assets/session_options/revisions 是新增表，不改写旧表；消息编辑备份原文，撤销仅针对人工编辑。

证据：server/worldbook.ts、preset.ts、context.ts、provider.ts、chat-files.ts、settings.ts、store.ts、app.ts；src/Management.tsx。tests/management.test.ts 用本地 HTTP 捕获真实请求，验证上下文/参数和 JSONL、分支、编辑恢复、数据库重开。尚未浏览器实测新管理入口，也未完成官方 ST 差分测试。

## 最新状态：递归与候选回复（2026-11-09）

本节更新上述历史阶段记录，仍为部分兼容，未做官方 ST 实机差分。

| 能力 | 本轮已实现 | 仍存在的边界 |
|---|---|---|
| 独立世界书 | 递归、excludeRecursion/preventRecursion/delayUntilRecursion、概率失败单次判定、position 4 深度与 role 0/1/2 | 内嵌书仍为旧算法；无分组、独立 Token 预算、定时效果、正则；递归有 500 轮安全上限，未验证与原生全部顺序/延迟语义一致 |
| 角色覆盖预设 | main/jailbreak 的偏好开关、启用状态、forbid_overrides、original 宏 | 仅全局相对提示顺序；非相对预设提示仍跳过；无完整宏系统 |
| 重新生成/Swipe | 最新助手回复重生成；保留旧候选/原始输出、选中候选持久保存并用于下轮上下文、导入 JSONL 的 swipes 可切换 | 不支持任意历史回合重生成和自动重写后续剧情；swipe_info 等元数据只保留，未完整同步其原生语义；开场选择仍为独立入口 |
| 管理界面 | 扫描/递归/覆盖设置保存入口，阅读区候选入口 | 尚未完成浏览器点击验收，不将接口测试标为 UI 验收通过 |

验证：npm run build 通过（含 tsc）；npm test 19/19 通过。tests/advanced-compat.test.ts 覆盖递归链/环、排除/阻断/延迟、概率、深度角色、覆盖与禁用、重生成保留原文、候选切换后上下文、JSONL 往返和失败不覆盖。tests/management.test.ts 覆盖本地真实 HTTP 请求参数与资源绑定、编辑撤销、分支、归档和 SQLite 重开。API Key 仍只保留页面内存。

## YunoTavern 双卡与本地连接增量

角色卡基础字段已支持新建/编辑（name/description/personality/scenario/first_mes），其他原始字段保留；并非完整角色编辑器。世界书 yuno_world_v1 是应用自身资源，支持包装独立 ST 世界书导入，不是 ST 原生分类；ST 场景角色卡仍走角色卡入口。双卡存档与 Windows DPAPI 连接保存属于应用能力，不计入原生 ST 兼容进度。世界书跨书递归、世界书专用预设 marker 尚未实现。tests/vault-worlds.test.ts 验证两类设定进入实际上下文、数据库重开、角色编辑和原文不变。

## 世界书编辑进展

作品库和独立世界书管理区均可编辑基础条目 key/content/constant/disable、新增及移除；顺序、概率、递归、位置等原字段保留，尚无对应高级编辑控件。应用世界设定/开场并非 ST 标准字段，以 _yunotavern 元信息随 ST 世界书导出。世界书编辑不改写存档；tests/world-edit.test.ts 验证下一轮上下文、旧存档/分支不变、原字段往返、重启恢复、无效输入回滚及生成期间编辑拦截。构建与 29 项模拟/系统测试通过，未使用付费模型。

## 简洁创建引导

引导沿用既有卡片与世界书格式，高级字段仍可保留/编辑；轻量玩家身份写入 extensions.yunotavern.player，属于应用扩展，不等于 ST 原生 Persona 导入/管理。{{user}} 在有玩家称呼时替换为该称呼，无设定仍为“玩家”。创建后继续使用原预设绑定、世界书求值和聊天接口。
