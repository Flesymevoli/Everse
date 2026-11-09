# 开局准备（2026-11-09）

新建存档 → 准备角色/世界/玩家身份 → 选择、编辑或主动生成开场 → 确认 → 展示开场 → 自由互动。所有复杂字段可选，没有额外快速模式。生成只更新草稿，不自动进入聊天；失败或停止保留原草稿，不自动重试。手动修改需点击保存准备才能刷新续填。

## 参考依据

实际阅读 DSH Tavern 提交 `741a9bd7f56b049e824bced5b3c9020cf33d02a2`：

- [opening-preparation.js](https://github.com/flizzywine/dsh-tavern/blob/741a9bd7f56b049e824bced5b3c9020cf33d02a2/tavern-plugin/lib/domain/opening-preparation.js)：准备草稿、选择开场、玩家名与生成。
- [session-opening.js](https://github.com/flizzywine/dsh-tavern/blob/741a9bd7f56b049e824bced5b3c9020cf33d02a2/tavern-plugin/lib/domain/session-opening.js)：已有剧情的开场保护。
- [opening-preview.js](https://github.com/flizzywine/dsh-tavern/blob/741a9bd7f56b049e824bced5b3c9020cf33d02a2/tavern-plugin/src/client/opening-preview.js)：预览与明确开始动作。

仅参考行为，独立实现；未复制其代码、UI、脚本执行、iframe 或 Agent 机制。

## 已实现边界

- 身份折叠区可主动“按作品设定生成角色引导”：一次请求提取最多 8 个问题，附可核对的原文依据；有作者选项时可点选，也能自由改答或跳过。无明确要求时返回空列表。不是完整条件分支脚本执行器，不保证模型提取绝对准确。
- `server/opening-guide.ts` 校验结构与引用、记录用量、不自动重试；`shared/opening-guide.ts` 保存问题及答案。资料改变使旧引导失效，需要重新读取或移除。长 Word 使用现有检索片段，可能遗漏尚未检索的作者规则；不声称分析过全文。
- 答案随准备保存，确认后进入当前存档，开场和后续请求均包含已回答项。生成引导不覆盖开场。已开始的故事可用右侧故事引导修订人物与世界，不重新执行开局。

- `shared/preparation.ts`：草稿校验；`src/OpeningPreparation.tsx`：准备与预览。
- `server/preparation.ts`：资源解析、开场请求、确认事务；`server/app.ts`：保存/生成/开始接口及并发锁。
- 草稿与玩家信息存入原 `session_options`。确认时原子创建简单资源、绑定存档并写入一条开场。原导入作品不变，后续仍使用原上下文与模型模块。
- 界面新建均进入准备。旧 API 未传 `prepare:true` 保持原行为。旧有剧情不强制迁移；旧空白存档可补开场。已确认存档禁止重新开局覆盖原文。
- 简单人物使用 V2 角色卡，简单世界沿用现有 Yuno 世界书结构；不声称增加了高级酒馆字段执行能力。生成使用现有预设、模型参数和世界书模块。

## “输入格式不正确”排查

原 `app.onError` 把所有 Zod 校验错误压成同一句，无法判断实际字段。已复现回复预算 `reserve:0` 被要求最小 64 的校验拒绝；旧数字输入清空后可能产生 0。现在 `server/validation.ts` 返回字段和限制，不回显输入值或 Key。没有此前失败请求记录，无法断定用户当时恰好触发此字段。

空白开局是另一问题：原创建接口允许空开场，前端直接显示聊天。新流程禁止空开场确认，并让空白旧存档进入准备。
