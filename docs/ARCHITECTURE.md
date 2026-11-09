# 架构

TypeScript strict、React/Vite、Node 24/Hono、node:sqlite、Chat Completions。Node 自带 SQLite 避免额外原生编译。

server/cards.ts 校验并保留卡片原始字段；context.ts 编排角色、关键词条目和近期完整对话；provider.ts 解析模型 SSE；store.ts 管理 SQLite；app.ts 处理 HTTP 与回合并发。浏览器只负责交互，未保存的密钥仅存页面内存；保存后由服务端使用 Windows DPAPI 加密落盘。

角色卡存储 body 新增可选 original，保存未经运行时默认值处理的 JSON 对象；旧记录不重写。导出优先 original，旧卡回退 card。alternate_greetings 是可选字段，首轮前由 greeting 接口校验索引并保存实际开场消息；生成中和已有剧情时禁止替换。后续兼容阶段见 COMPATIBILITY.md。

导入 → SQLite 作品 → 新建会话 → 编排/预算检查 → 模型流 → 事务保存完整输入与回复。生成失败不提交半轮。裁剪只影响请求历史，数据库保留所有原文。Token 为保守估算，不等同供应商 tokenizer。


## 可选建议与取消

suggestions.ts 校验末尾标记中的 JSON 数组，成功拆分正文和建议，失败保留原文。Message 的可选 raw 保存模型原始输出；上下文只取 role/content。新增 preferences 表独立保存开关，旧会话默认关闭，不迁移或重写原消息。HTTP 层为每个生成请求维护 AbortController，停止入口取消模型请求。ReadingView.tsx 负责正文与建议展示。

## 资源与聊天管理

worldbook.ts 校验独立世界书并求值，preset.ts 校验预设和采样参数，settings.ts 约束存档选项，chat-files.ts 映射 JSONL 并保留原始消息元数据。新增 assets、session_options、revisions 表；老会话不自动绑定资源。context.ts 执行启用的相对提示顺序；provider.ts 仅发送白名单采样参数。消息编辑与修订备份使用 SQLite 事务。Management.tsx 是按需打开的管理区域，不放入右侧角色栏。

## 递归、覆盖与候选回复

独立世界书每次构建上下文求值一次，递归用已命中条目内容触发下一轮；概率失败不重复抽取，默认关闭递归，0 轮数配置表示安全上限 500。深度相对聊天消息计数，不计算其他插入项；预算裁剪后重新定位。内嵌角色世界书保留原算法，尚未统一。

角色主提示/历史后指令分别覆盖启用的 main/jailbreak，受存档偏好和 forbid_overrides 限制；original 宏替换预设原内容。行动建议作为独立应用指令追加。

shared/swipes.ts 统一候选选择。Message 可选 variants/selectedVariant 与旧消息共存，模型上下文只取选中的 role/content。重新生成取最后一次玩家输入，完整成功后追加候选，不追加玩家回合；失败不写存档。JSONL 保留 swipes/swipe_id，尚未完整映射 swipe_info 等候选元数据。revisions 增加可空 expected 列；新编辑的撤销需当前消息与编辑后快照一致，防止覆盖后续候选或剧情。

## 多 API 连接

src/connections.ts 校验恢复的连接元信息、按选中 ID 构建现有 Config，并显式白名单序列化名称/地址/模型到 localStorage。临时 Key 仅在 App 状态中；已保存连接从服务端恢复 hasKey 状态，不回传明文，也不恢复真实连接选择。ConnectionSettings.tsx 管理连接；ModelPicker.tsx 在阅读区切换。发送时固定捕获选中连接的配置，后端协议不变。tests/connections.test.ts 使用两个本地服务验证切换后的真实请求。

## YunoTavern：密钥与双卡资源

secrets.ts 通过 Windows PowerShell/.NET CurrentUser DPAPI 加解密，数据经标准输入而非命令行传递；不输出子进程错误详情。connection-vault.ts 管理 connections 表，只返回元信息；生成时凭 connectionId 读取可信地址与解密 Key，不接受客户端覆盖保存连接的地址。敏感写接口要求 JSON，所有请求限制 Host 和 Origin。无明文回退；其他平台暂不支持保存 Key。

worlds.ts 定义 yuno_world_v1，assets 表以 worlds 类型保存规范化运行数据与原始 JSON。独立 ST 世界书可包装为世界书；世界书并不是 ST 新格式承诺。sessions 原 cardId 保留；纯世界会话使用空 cardId，session_options.worldId 指向世界。世界设定以独立系统消息进入上下文，世界书与手动绑定书各自求值（尚不跨书递归）。世界开场优先于角色开场。

Library.tsx 负责世界/角色分类、新建、导入、角色编辑和开局选择。角色编辑只合并允许修改字段，保留原始高级字段，并在 card_revisions 事务备份；不修改聊天原文。旧记录不强制转换。项目包名改为 yunotavern，数据目录和 Git 远程地址保持不变。

## 世界书编辑

界面统一使用“世界书”；为避免迁移旧存档，内部 worlds、worldId、yuno_world_v1 保持兼容。world-edit.ts 合并世界书元信息及编辑后的条目，未知字段保留；ST 原生 entries 导出形状不变，应用元信息写入 _yunotavern 并在重导入时恢复。BookEntryFields.tsx 共用于作品库和独立世界书管理区。assets 更新及 asset_revisions 备份在同一事务中，不更新 sessions。生成接口每轮重读资源，相关会话 busy 时拒绝资源编辑。

## 引导创建

server/creation.ts 校验简单表单并映射到现有 V2 角色卡或 yuno_world_v1 世界书；在同一 SQLite 事务创建资源及可选会话，失败回滚。shared/player.ts 在 extensions.yunotavern.player 保存玩家称呼/背景，并合并保留其他扩展；运行时选择世界书的非空玩家设定，否则回退角色卡，作为单独系统上下文参与预算，{{user}} 使用该称呼。没有设定时保持旧行为。它不是完整 ST Persona 实现。CreationGuide.tsx 仅负责现有创建表单的渐进呈现，Library 保留完整编辑入口。

## 开局准备增量

开局数据流：session_options 中的准备草稿 → 现有角色/世界资源或简单资源 → 开场预览 → SQLite 事务确认 → 原回合链路。实现见 shared/preparation.ts、server/preparation.ts、src/OpeningPreparation.tsx。生成复用原 provider/context，不引入 Agent；准备状态与草稿不允许通过通用 options 接口绕过确认写入。完整说明见 OPENING-FLOW.md。
