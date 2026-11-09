import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, readPngCard } from "../server/png-card.js";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";

function chunk(type: string, data: Buffer) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(type, 4);
  data.copy(result, 8);
  result.writeUInt32BE(
    crc32(result.subarray(4, result.length - 4)),
    result.length - 4,
  );
  return result;
}
const card = {
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: { name: "PNG 守灯人", extensions: { retained: true } },
};
function png() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const text = (key: string, value: unknown) =>
    chunk(
      "tEXt",
      Buffer.from(
        key + "\0" + Buffer.from(JSON.stringify(value)).toString("base64"),
      ),
    );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    text("chara", {
      ...card,
      spec: "chara_card_v2",
      data: { name: "低优先级" },
    }),
    text("ccv3", card),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
test("PNG 优先读取 ccv3，拒绝截断和 CRC 损坏", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.deepEqual(readPngCard(png()), card);
  assert.throws(() => readPngCard(png().subarray(0, 30)));
  const corrupt = png();
  corrupt[20] ^= 1;
  assert.throws(() => readPngCard(corrupt), /校验/);
});
test("PNG HTTP 导入可导出原始 JSON，不改旧存档", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const response = await app.request("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(png()),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      id: string;
      warnings: string[];
    };
    assert.ok(result.warnings.some((warning) => warning.includes("头像")));
    assert.deepEqual(
      await (await app.request("/api/cards/" + result.id + "/export")).json(),
      card,
    );
  } finally {
    store.close();
  }
});
