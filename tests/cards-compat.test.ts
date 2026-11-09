import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { importCard } from "../server/cards.js";

test("原始 V2/V3 JSON 深层扩展无损往返，备选开场保存并禁止覆盖剧情", async () => {
  for (const spec of ["chara_card_v2", "chara_card_v3"]) {
    const store = new Store(":memory:");
    try {
      const app = createApp(store);
      const post = (path: string, body: unknown) =>
        app.request(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const raw = {
        spec,
        spec_version: spec.endsWith("v2") ? "2.0" : "3.0",
        extra_top: { unknown: [1, null, false] },
        data: {
          name: "灯",
          first_mes: "默认",
          alternate_greetings: ["{{char}}向{{user}}招手", ""],
          extensions: {
            third_party: { nested: ["不执行", { enabled: false }] },
          },
          character_book: {
            future: true,
            entries: [
              {
                keys: ["塔"],
                content: "灯塔",
                extensions: { probability: 50 },
              },
            ],
          },
        },
      };
      const imported = (await (await post("/api/cards", raw)).json()) as {
        id: string;
        warnings: string[];
      };
      assert.ok(
        imported.warnings.some((warning) => warning.includes("extensions")),
      );
      const exported = await app.request(
        "/api/cards/" + imported.id + "/export",
      );
      assert.equal(exported.headers.get("X-Card-Export"), "original");
      assert.deepEqual(await exported.json(), raw);
      const { id } = (await (
        await post("/api/sessions", { cardId: imported.id })
      ).json()) as { id: string };
      assert.equal(
        (await post("/api/sessions/" + id + "/greeting", { index: 1 })).status,
        200,
      );
      assert.equal(store.session(id).messages[0].content, "灯向玩家招手");
      assert.equal(
        (await post("/api/sessions/" + id + "/greeting", { index: 9 })).status,
        400,
      );
      assert.equal(
        (await post("/api/sessions/" + id + "/greeting", { index: 1.5 }))
          .status,
        400,
      );
      assert.equal(
        (await post("/api/sessions/" + id + "/greeting", { index: 2 })).status,
        200,
      );
      assert.deepEqual(store.session(id).messages, []);
      await post("/api/sessions/" + id + "/greeting", { index: 1 });
      const response = await post("/api/sessions/" + id + "/turn", {
        input: "你好",
        config: {
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "",
          model: "mock",
          mock: true,
        },
      });
      assert.match(await response.text(), /"type":"done"/);
      const saved = store.session(id).messages;
      assert.equal(
        (await post("/api/sessions/" + id + "/greeting", { index: 0 })).status,
        409,
      );
      assert.deepEqual(store.session(id).messages, saved);
    } finally {
      store.close();
    }
  }
});

test("旧卡导出回退保持存储内容，错误备选开场类型拒绝导入", async () => {
  const store = new Store(":memory:");
  try {
    const { card, warnings } = importCard({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: "旧卡" },
    });
    const id = store.addCard({ card, warnings });
    const response = await createApp(store).request(
      "/api/cards/" + id + "/export",
    );
    assert.equal(response.headers.get("X-Card-Export"), "stored-fallback");
    assert.deepEqual(await response.json(), card);
    assert.throws(() =>
      importCard({
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: { name: "错误", alternate_greetings: [5] },
      }),
    );
  } finally {
    store.close();
  }
});
