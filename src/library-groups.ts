import type { SessionOptions } from "../server/settings";
export type LibrarySave = {
  id: string;
  cardId: string;
  options?: SessionOptions;
};
export function libraryGroups(
  saves: LibrarySave[],
  cards: { id: string; name: string }[],
  worlds: { id: string; name: string }[],
) {
  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      cardId: string;
      worldId: string;
      saves: LibrarySave[];
      source?: SessionOptions["storySource"];
    }
  >();
  for (const world of worlds)
    groups.set("world:" + world.id, {
      key: "world:" + world.id,
      name: world.name,
      cardId: "",
      worldId: world.id,
      saves: [],
    });
  for (const card of cards)
    groups.set("card:" + card.id, {
      key: "card:" + card.id,
      name: card.name,
      cardId: card.id,
      worldId: "",
      saves: [],
    });
  for (const save of saves) {
    const source =
      save.options?.storySource ?? save.options?.openingDraft?.source;
    const key =
      save.options?.worldId && groups.has("world:" + save.options.worldId)
        ? "world:" + save.options.worldId
        : save.cardId && groups.has("card:" + save.cardId)
          ? "card:" + save.cardId
          : source
            ? "source:" +
              JSON.stringify([
                source.documentId ?? null,
                source.name,
                source.text,
              ])
            : "save:" + save.id;
    const group = groups.get(key) ?? {
      key,
      name: source?.name || save.options?.name || "待开始的故事",
      cardId: "",
      worldId: "",
      source,
      saves: [] as LibrarySave[],
    };
    group.saves.push(save);
    groups.set(key, group);
  }
  return [...groups.values()];
}
