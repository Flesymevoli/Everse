# Agent Alpha：先让故事持续，再增强引擎

本页区分已实现行为与后续设计，不把规划写成能力。

## 本次发布底线（已实现）

- 普通回合一次文本生成，不强制 Tool Calling 或多 Agent 循环。
- 模型已完整返回正文时，缺失/损坏/无依据的辅助状态不再否决正文；跳过状态更新，保存原始输出与可见警告，保留旧有效状态。断流、取消、空正文和供应商明确报告截断仍保留未提交草稿。不得自动付费修复。
- 过时的开局问答不阻断生成：提示其未采用，使用当前作品设定继续。确认开局仍需非空正文；可以手写或主动生成，无需完成固定人物表。
- 自然语言可以直接参与互动，也可明确点击“记为世界设定”将输入原文加入当前存档的持久世界观。右侧人物/状态/世界/方向可修改或清空。普通行动不自动升级成永久规则。
- 原文编辑、撤销最近编辑、Swipe 与分支继续复用原机制。结构化记忆必须有来源，编辑旧文后失效处理保留。

实现：`server/story.ts` 的 parseNarrative、`server/app.ts`、`server/preparation.ts`、`shared/director.ts`、`src/ReadingView.tsx`。验收包含本地 HTTP 返回坏状态时开场/续写仍可完成，原始回复和警告持久化。

## 后续职责边界（设计，未全部实现）

| 范畴 | 当前复用 | 下一步边界 |
| --- | --- | --- |
| Runtime | app/store/provider，版本检查、幂等提交、草稿 | 只管任务、取消、费用预算和提交，不承担文风 |
| Prompt / 生成配置 | context/preset/settings/director | 预设、Mod、前后置词按存档持久化和版本化，明确覆盖顺序；Mod 编辑器尚未实现 |
| 内容与记忆 | documents/document-plan/document-context/worldbook/story | 原件和原文保留；持续规则、参考资料、动态事实分开。按需检索，不全部包装为 Skill |
| Skill | 当前无通用运行时 | 有明确任务输入/输出的可选能力；按需挂载，不强制每轮执行 |
| 插件 | 当前无通用插件宿主 | 外部能力有独立权限、超时与失败边界，不能直接覆写原始剧情 |

优先闭环：导入长文 → 用户主动分批分析、查看/纠正分类 → 开局使用相关片段 → 一轮一次生成 → 有依据的事实保存；辅助失败仍可读、可改、可继续。现有分批分类先保持可控费用，后续才考虑用户明确开启的自动批次队列。

上下文按“玩家确认规则 + 必要持续约束 + 当前场景相关资料/事实 + 近期原文 + 当前行动”组装；同一内容去重并记录来源。短规则优先稳定，变化资料后置，避免无谓重建整个前缀。摘要只能作为可追溯索引，不能替换原文；冲突以玩家确认和较新原文为准，不让推断自行覆盖事实。分类和阶段整理增量执行，设定未改不反复分析。

世界自主发展先以回合/场景时间与 NPC 目标为输入，合并进下一次叙事请求。未游玩时默认不后台收费循环。下一步先测 30–50 轮引用召回、事实矛盾、玩家修订保持和累计 Token，再决定是否增加索引/摘要；不能先声称优于直接聊天。

## 本轮核对的参考源码（仅参考，不复制）

- AINT 固定 `9c689bd67d3732f1922df62be91c211a0c009998`：[operation.go](https://github.com/wahhheee/aint/blob/9c689bd67d3732f1922df62be91c211a0c009998/internal/runtime/operation.go) 在重写/补选项时校验 ExpectedHead 和目标回合。借鉴操作与存档版本绑定，沿用我们已有 historyKey/事务提交；不引入其完整调用循环。
- DSH Tavern 固定 `27813f2323d1559a6f7c5ad1978566be453f98e1`：[conversation-guides.js](https://github.com/flizzywine/dsh-tavern/blob/27813f2323d1559a6f7c5ad1978566be453f98e1/tavern-plugin/lib/domain/conversation-guides.js) 在当前会话上更新持久 Guide；[plugin-host-behavior.js](https://github.com/flizzywine/dsh-tavern/blob/27813f2323d1559a6f7c5ad1978566be453f98e1/tavern-plugin/lib/domain/plugin-host-behavior.js) 以插件归属和权限限制后台行为；[skill-text-context.js](https://github.com/flizzywine/dsh-tavern/blob/27813f2323d1559a6f7c5ad1978566be453f98e1/tavern-plugin/lib/domain/skill-text-context.js) 将 Skill 文本适配限定在特定服务边界。借鉴职责与故障隔离，不将其“世界书转 Skill”策略强加给本项目。

更早审查见 DIRECTION-REVIEW.md；其中早期 P0“状态失败阻断提交”的发布行为由本页替代。Alpha 优先自由叙事，通用 Skill、插件宿主、自动世界推进仍为后续工作。
