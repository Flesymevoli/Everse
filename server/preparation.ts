import { preparationSchema, type Preparation } from "../shared/preparation.js";
import { importCard, expand } from "./cards.js";
import { importWorld, combinedCard } from "./worlds.js";
import type { Store } from "./store.js";
import { buildContext } from "./context.js";
import { presetSchema, importPreset, parametersSchema } from "./preset.js";
import type { Config } from "./provider.js";
import { resolveBudget } from "./budget.js";
import { sourceContext } from "./document-context.js";
import { parseStory, storyInstruction } from "./story.js";
export function ensurePreparation(store: Store, id: string) {
  const s = store.session(id);
  if (s.options.archived) throw new Error("请先恢复归档存档");
  if (
    s.options.openingState === "started" ||
    s.messages.some((m) => m.role !== "assistant") ||
    s.messages.length > 1 ||
    (s.options.openingState !== "preparing" && s.messages.length > 0)
  )
    throw new Error("已有剧情不能重新开局，请新建存档");
  return s;
}
export function preparationResources(store: Store, d: Preparation) {
  const selectedCard =
    d.characterMode === "existing"
      ? store.cards().find((v) => v.id === d.cardId)
      : undefined;
  const selectedWorld =
    d.worldMode === "existing"
      ? store.worlds().find((v) => v.id === d.worldId)
      : undefined;
  if (d.characterMode === "existing" && !selectedCard)
    throw new Error("请选择有效的角色卡");
  if (d.worldMode === "existing" && !selectedWorld)
    throw new Error("请选择有效的世界书");
  const newCard =
    d.characterMode === "simple"
      ? importCard({
          spec: "chara_card_v2",
          spec_version: "2.0",
          data: {
            name: d.character.name || "故事角色",
            description: d.character.description,
          },
        })
      : undefined;
  const newWorld =
    d.worldMode === "simple"
      ? importWorld({
          spec: "yuno_world_v1",
          data: {
            name: d.world.name || "未命名世界",
            description: d.world.description,
          },
        })
      : undefined;
  const card = combinedCard(
    newCard?.card ?? selectedCard?.card,
    newWorld?.world ?? selectedWorld?.world,
    d.source,
  );
  const world = newWorld?.world ?? selectedWorld?.world;
  const preset = store.assets("presets").find((v) => v.id === d.presetId),
    book = store.assets("worldbooks").find((v) => v.id === d.worldbookId);
  if (d.presetId && !preset) throw new Error("预设不存在");
  if (d.worldbookId && !book) throw new Error("独立世界书不存在");
  return { card, world, newCard, newWorld, preset, book };
}
export function savePreparation(store: Store, id: string, raw: unknown) {
  const s = ensurePreparation(store, id),
    d = preparationSchema.parse(raw);
  store.setOptions(id, {
    ...s.options,
    openingState: "preparing",
    openingDraft: d,
  });
  return d;
}
export function confirmPreparation(store: Store, id: string, raw: unknown) {
  const s = ensurePreparation(store, id),
    d = preparationSchema.parse(raw);
  if (!d.opening.trim())
    throw new Error("请先选择、编写或生成开场剧情，再确认开始");
  const r = preparationResources(store, d);
  sourceContext(store, d.source, d.opening); // Reject missing references before committing a new game.
  const generated = store.draft(id);
  let openingStory;
  if (generated?.raw) {
    try {
      const parsed = parseStory(generated.raw, []);
      if (
        parsed.text === d.opening &&
        expand(d.opening, r.card.data.name, d.player.name) === d.opening
      )
        openingStory = parsed.story;
    } catch {
      /* Manual opening is valid without generated state. */
    }
  }
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const cardId = r.newCard
      ? store.addCard(r.newCard)
      : d.characterMode === "existing"
        ? d.cardId
        : "";
    const worldId = r.newWorld
      ? store.addWorld(r.newWorld)
      : d.worldMode === "existing"
        ? d.worldId
        : null;
    store.db.prepare("UPDATE sessions SET cardId=?,messages=? WHERE id=?").run(
      cardId,
      JSON.stringify([
        {
          role: "assistant",
          content: expand(d.opening, r.card.data.name, d.player.name),
          raw: d.opening,
          story: openingStory,
        },
      ]),
      id,
    );
    store.setOptions(id, {
      ...s.options,
      worldId,
      player: d.player,
      openingState: "started",
      openingDraft: undefined,
      presetId: d.presetId,
      worldbookId: d.worldbookId,
      storySource: d.source,
      storyTracking: true,
      name: s.options.name ?? d.source?.name,
    });
    store.db.prepare("DELETE FROM turn_drafts WHERE sessionId=?").run(id);
    store.db.exec("COMMIT");
    return store.session(id);
  } catch (e) {
    store.db.exec("ROLLBACK");
    throw e;
  }
}
export function openingRequest(
  store: Store,
  id: string,
  d: Preparation,
  config: Config,
  budget: number | undefined,
  reserve: number | undefined,
) {
  const s = ensurePreparation(store, id),
    r = preparationResources(store, d),
    preset = r.preset ? presetSchema.parse(r.preset.original) : undefined;
  const parameters = parametersSchema.parse({
    ...(r.preset ? importPreset(r.preset.original).parameters : {}),
    ...s.options.parameters,
    ...config.parameters,
  });
  if (parameters.seed === -1) delete parameters.seed;
  const limits = resolveBudget(budget, reserve, preset);
  const source = sourceContext(
    store,
    d.source,
    `${d.player.description}\n${d.opening}`,
    Math.min(6000, Math.max(1600, Math.floor(limits.budget / 2))),
  );
  const prompt = buildContext(
    r.card,
    [],
    "请根据已提供的背景与人物设定写出故事开场。",
    limits.budget,
    limits.reserve,
    {
      ...s.options,
      automaticBudget: limits.automaticBudget,
      player: d.player,
      worldDescription: [source.text, r.world?.data.description]
        .filter(Boolean)
        .join("\n\n"),
      cardWorldbook: r.world?.data.worldbook,
      worldbook: r.book?.original,
      preset: r.preset?.original,
      extraInstruction:
        "本次生成可供玩家预览的开场，尊重作者设定；未指定玩家身份时留出自由参与空间，不替玩家决定后续行动。已有草稿仅作参考：\n" +
        d.opening +
        "\n" +
        storyInstruction,
    },
  );
  return {
    prompt: {
      ...prompt,
      document: source.document,
      budgetSource: limits.budgetSource,
      outputSource: limits.outputSource,
      maxTokens: limits.maxTokens ?? null,
    },
    maxTokens: limits.maxTokens,
    config: { ...config, parameters },
  };
}
