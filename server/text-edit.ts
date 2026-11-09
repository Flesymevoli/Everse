import { settingContext } from "./setting-sync.js";
import { createHash } from "node:crypto";
import type { Store } from "./store.js";
import type { TextSelection } from "../shared/text-edit.js";
import { combinedCard } from "./worlds.js";
import { buildContext } from "./context.js";
import { importPreset, presetSchema, parametersSchema } from "./preset.js";
import { resolveBudget } from "./budget.js";
import { sourceContext } from "./document-context.js";
import { directorInstruction } from "../shared/director.js";
import type { Config } from "./provider.js";
export function editRevision(store: Store, id: string) {
  const s = store.session(id);
  return createHash("sha256")
    .update(
      JSON.stringify([
        s.messages,
        store.story(id).revision,
        s.options.directorRevision ?? 0,
      ]),
    )
    .digest("hex");
}
export function selectedText(
  store: Store,
  id: string,
  selection: TextSelection,
) {
  const session = store.session(id),
    message = session.messages[selection.index];
  if (session.options.archived) throw new Error("请先恢复归档存档");
  if (editRevision(store, id) !== selection.revision)
    throw new Error("正文或状态已变化，请重新选择文本；没有覆盖存档。");
  if (
    !message ||
    message.role !== "assistant" ||
    selection.end <= selection.start ||
    selection.end > message.content.length ||
    message.content.slice(selection.start, selection.end) !== selection.original
  )
    throw new Error("选区与存档原文不一致，请重新选择。");
  return { session, message };
}
export function rewriteRequest(
  store: Store,
  id: string,
  selection: TextSelection,
  instruction: string,
  config: Config,
  budget?: number,
  reserve?: number,
) {
  const { session, message } = selectedText(store, id, selection);
  const card = store.cards().find((c) => c.id === session.cardId)?.card;
  const world = store
    .worlds()
    .find((w) => w.id === session.options.worldId)?.world;
  const preset = store
    .assets("presets")
    .find((p) => p.id === session.options.presetId)?.original;
  const book = store
    .assets("worldbooks")
    .find((p) => p.id === session.options.worldbookId)?.original;
  const limits = resolveBudget(
    budget,
    reserve,
    preset ? presetSchema.parse(preset) : undefined,
  );
  const parameters = parametersSchema.parse({
    ...(preset ? importPreset(preset).parameters : {}),
    ...session.options.parameters,
    ...config.parameters,
  });
  if (parameters.seed === -1) delete parameters.seed;
  const source = sourceContext(
    store,
    session.options.storySource,
    selection.original + instruction,
    4000,
  );
  const task = {
    instruction,
    selected: selection.original,
    before: message.content.slice(
      Math.max(0, selection.start - 2000),
      selection.start,
    ),
    after: message.content.slice(selection.end, selection.end + 2000),
  };
  const prompt = buildContext(
    combinedCard(card, world, session.options.storySource),
    [],
    "",
    limits.budget,
    limits.reserve,
    {
      ...session.options,
      player: session.options.player,
      worldDescription: [source.text, world?.data.description]
        .filter(Boolean)
        .join("\n\n"),
      worldbook: book,
      cardWorldbook: world?.data.worldbook,
      preset,
      automaticBudget: limits.automaticBudget,
      extraInstruction:
        "EVERSE_LOCAL_REWRITE\n这是局部编辑任务，不是继续故事。只输出替换选区的正文，不复述前后文，不输出说明、选项或状态标签。遵守明确修改要求，尽量保留未涉及的事实和作者风格。前后文只用于衔接。\n" +
        directorInstruction(session.options.director) +
        "\n" +
        settingContext(session.messages, selection.original).text +
        "\n编辑数据：\n" +
        JSON.stringify(task),
    },
  );
  return {
    prompt: {
      ...prompt,
      scope: "仅所选文本、前后各最多2000字符与相关设定；未发送完整历史",
    },
    maxTokens: limits.maxTokens,
    config: { ...config, parameters },
  };
}
