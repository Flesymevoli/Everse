# 架构

TypeScript strict、React/Vite、Node 24/Hono、node:sqlite、Chat Completions。Node 自带 SQLite 避免额外原生编译。

server/cards.ts 校验并保留卡片原始字段；context.ts 编排角色、关键词条目和近期完整对话；provider.ts 解析模型 SSE；store.ts 管理 SQLite；app.ts 处理 HTTP 与回合并发。浏览器只负责交互，密钥仅存页面内存。

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

src/connections.ts 校验恢复的连接元信息、按选中 ID 构建现有 Config，并显式白名单序列化名称/地址/模型到 localStorage。Key 仅在 App 状态中；恢复不读取 Key，也不恢复真实连接选择。ConnectionSettings.tsx 管理连接；ModelPicker.tsx 在阅读区切换。发送时固定捕获选中连接的配置，后端协议不变。tests/connections.test.ts 使用两个本地服务验证切换后的真实请求。
