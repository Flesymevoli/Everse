import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryGroups } from "../src/library-groups.js";
import { resolveConnection } from "../src/connections.js";
import { optionsSchema } from "../server/settings.js";
test("没有连接时要求配置，不返回模拟回复", () => {
  assert.throws(
    () => resolveConnection({ profiles: [], selectedId: null }),
    /添加并选择 API/,
  );
});
test("书架归组保持每个存档一次且相同来源合并", () => {
  const options = optionsSchema.parse({
    storySource: { name: "雨城", text: "雨城背景", format: "text" },
  });
  const saves = [
    { id: "a", cardId: "", options },
    { id: "b", cardId: "", options },
    { id: "c", cardId: "missing" },
  ];
  const groups = libraryGroups(saves, [], []);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups[0].saves.map((s) => s.id),
    ["a", "b"],
  );
  assert.equal(groups[1].saves[0].id, "c");
});

test("世界与角色同时绑定时不重复存档，同名不同来源不误合并", () => {
  const options = optionsSchema.parse({ worldId: "world" });
  const groups = libraryGroups(
    [
      { id: "bound", cardId: "card", options },
      {
        id: "one",
        cardId: "",
        options: optionsSchema.parse({
          storySource: { name: "同名", text: "甲", format: "text" },
        }),
      },
      {
        id: "two",
        cardId: "",
        options: optionsSchema.parse({
          storySource: { name: "同名", text: "乙", format: "text" },
        }),
      },
    ],
    [{ id: "card", name: "人物" }],
    [{ id: "world", name: "世界" }],
  );
  assert.deepEqual(
    groups.flatMap((g) => g.saves.map((s) => s.id)),
    ["bound", "one", "two"],
  );
  assert.equal(groups.find((g) => g.key === "card:card")?.saves.length, 0);
});
