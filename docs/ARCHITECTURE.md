# 架构

TypeScript strict、React/Vite、Node 24/Hono、node:sqlite、Chat Completions。Node 自带 SQLite 避免额外原生编译。

server/cards.ts 校验并保留卡片原始字段；context.ts 编排角色、关键词条目和近期完整对话；provider.ts 解析模型 SSE；store.ts 管理 SQLite；app.ts 处理 HTTP 与回合并发。浏览器只负责交互，密钥仅存页面内存。

导入 → SQLite 作品 → 新建会话 → 编排/预算检查 → 模型流 → 事务保存完整输入与回复。生成失败不提交半轮。裁剪只影响请求历史，数据库保留所有原文。Token 为保守估算，不等同供应商 tokenizer。

