import { preparationSchema, type Preparation } from "../shared/preparation.js";
import { importCard, expand } from "./cards.js";
import { importWorld, combinedCard } from "./worlds.js";
import type { Store } from "./store.js";
import { buildContext } from "./context.js";
import { presetSchema, importPreset, parametersSchema } from "./preset.js";
import type { Config } from "./provider.js";
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
    store.db
      .prepare("UPDATE sessions SET cardId=?,messages=? WHERE id=?")
      .run(
        cardId,
        JSON.stringify([
          {
            role: "assistant",
            content: expand(d.opening, r.card.data.name, d.player.name),
            raw: d.opening,
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
    });
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
  budget: number,
  reserve: number,
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
  const prompt = buildContext(
    r.card,
    [],
    "请根据已提供的背景与人物设定写出故事开场。",
    preset?.openai_max_context ?? budget,
    preset?.openai_max_tokens ?? reserve,
    {
      ...s.options,
      player: d.player,
      worldDescription: r.world?.data.description,
      cardWorldbook: r.world?.data.worldbook,
      worldbook: r.book?.original,
      preset: r.preset?.original,
      extraInstruction:
        "本次仅生成可供玩家预览的开场正文，不输出说明、选项或玩家后续行动。已有草稿仅作参考：\n" +
        d.opening,
    },
  );
  return { prompt, config: { ...config, parameters } };
}
