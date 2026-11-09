import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { extractWord, documentLimit } from "../server/documents.js";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import {
  documentPassages,
  selectDocument,
} from "../server/document-context.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Preparation } from "../shared/preparation.js";

// Minimal genuine OOXML ZIP, independent of the production parser.
export function wordFixture(body: string, extra: [string, string][] = []) {
  const entries: [string, string][] = [
    [
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        body +
        "</w:body></w:document>",
    ],
    ...extra,
  ];
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name),
      data = Buffer.from(content),
      packed = deflateRawSync(data),
      checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(packed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    locals.push(local, filename, packed);
    central.push(record, filename);
    offset += local.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const text =
  "<w:p><w:r><w:t>雨城侦探</w:t></w:r></w:p><w:p><w:r><w:t>第一段 &amp; 第二段</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>林的目标：寻找旧友</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";

test("DOCX 提取中文段落、转义字符和表格文字，明确提示格式局限", async () => {
  const result = await extractWord(wordFixture(text), "故事.DOCX");
  assert.match(result.text, /雨城侦探\n\n第一段 & 第二段/);
  assert.match(result.text, /林的目标：寻找旧友/);
  assert.ok(result.warnings.some((w) => w.includes("图片")));
});
test("接受超过10万字符；仍拒绝旧DOC、损坏、空白、体积超限、解压膨胀、实体和宏", async () => {
  await assert.rejects(extractWord(wordFixture(text), "故事.doc"), /另存为/);
  await assert.rejects(extractWord(Buffer.from("not zip"), "x.docx"), /有效/);
  await assert.rejects(extractWord(wordFixture(""), "x.docx"), /没有可提取/);
  assert.ok(
    (
      await extractWord(
        wordFixture(
          "<w:p><w:r><w:t>" + "x".repeat(100001) + "</w:t></w:r></w:p>",
        ),
        "long.docx",
      )
    ).text.length > 100000,
  );
  await assert.rejects(
    extractWord(Buffer.alloc(documentLimit + 1), "x.docx"),
    /2 MB/,
  );
  await assert.rejects(
    extractWord(
      wordFixture(text, [["huge.bin", "x".repeat(13 * 1024 * 1024)]]),
      "x.docx",
    ),
    /解压内容过大/,
  );
  await assert.rejects(
    extractWord(
      wordFixture(text, [
        ["custom.xml", '<!DOCTYPE x [<!ENTITY x "boom">]><x/>'],
      ]),
      "x.docx",
    ),
    /XML 实体/,
  );
  await assert.rejects(
    extractWord(
      wordFixture(text, [["word/vbaProject.bin", "macro"]]),
      "x.docx",
    ),
    /带宏/,
  );
});
test("Word API → 准备存档 → 确认开局，保留原始文件及编辑后的设定，不需要角色卡", async () => {
  const store = new Store(":memory:");
  const app = createApp(store);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const original = wordFixture(text);
    const imported = await app.request(
      "/api/documents/word?name=" + encodeURIComponent("雨城.docx"),
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(original),
      },
    );
    assert.equal(imported.status, 200);
    const source = (await imported.json()) as {
      name: string;
      format: "docx";
      text: string;
      documentId: string;
      warnings: string[];
    };
    const draft = {
      source: { ...source, text: source.text + "\n玩家补充：小镇在海边。" },
      characterMode: "none",
      worldMode: "none",
      character: { name: "", description: "" },
      world: { name: "", description: "" },
      player: { name: "", description: "" },
      opening: "雨落在小镇的书店门前。",
    };
    const id = store.create("", []);
    store.setOptions(id, { openingState: "preparing" });
    assert.equal(
      (await post(`/api/sessions/${id}/preparation`, draft)).status,
      200,
    );
    assert.equal(
      store.options(id).openingDraft?.source?.documentId,
      source.documentId,
    );
    assert.equal((await post(`/api/sessions/${id}/start`, draft)).status, 200);
    assert.match(store.options(id).storySource!.text, /玩家补充/);
    assert.equal(store.options(id).storySource?.format, "docx");
    const download = await app.request(
      `/api/documents/${source.documentId}/original`,
    );
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), original);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM model_usage").get()!.n,
      0,
    );
    const invalid = await app.request("/api/documents/word?name=x.docx", {
      method: "POST",
      body: "bad",
    });
    assert.equal(invalid.status, 400);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM source_documents").get()!.n,
      1,
    );
  } finally {
    store.close();
  }
});

test("长文分段完整可重组，定位末尾线索且选取量受限", () => {
  const full =
    "作者世界背景\n" +
    "普通街巷和居民的生活。\n".repeat(11000) +
    "翡翠密钥藏在北港钟楼。";
  const passages = documentPassages(full);
  assert.equal(passages.map((p) => p.text).join(""), full);
  for (const p of passages) assert.equal(full.slice(p.start, p.end), p.text);
  const result = selectDocument(full, "寻找翡翠密钥", 4000);
  assert.ok(result.selected.some((p) => p.text.includes("翡翠密钥")));
  assert.equal(result.selected[0].index, 0);
  assert.ok(result.bytes <= 4000);
  assert.ok(result.omitted > 100);
});

test("超10万字Word完整保存、重开、开局与续写检索；无全篇模型输入或额外调用", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yuno-longdoc-")),
    path = join(dir, "game.sqlite");
  let store = new Store(path),
    app = createApp(store);
  const post = (url: string, body: unknown) =>
    app.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const full =
      "雨城世界设定。\n" +
      "居民生活在古老街巷里。\n".repeat(11000) +
      "翡翠密钥藏在北港钟楼。";
    const original = wordFixture(
      "<w:p><w:r><w:t>" + full + "</w:t></w:r></w:p>",
    );
    const upload = await app.request("/api/documents/word?name=long.docx", {
      method: "POST",
      body: new Uint8Array(original),
    });
    assert.equal(upload.status, 200);
    const source = (await upload.json()) as NonNullable<Preparation["source"]>;
    assert.equal(source.reference, true);
    assert.equal(source.text, "");
    assert.equal(source.characters, full.length);
    assert.equal(
      await (
        await app.request(`/api/documents/${source.documentId}/text`)
      ).text(),
      full,
    );
    const id = store.create("", []);
    store.setOptions(id, { openingState: "preparing" });
    const draft: Preparation = {
      source,
      characterMode: "none",
      worldMode: "none",
      cardId: "",
      worldId: "",
      character: { name: "", description: "" },
      world: { name: "", description: "" },
      player: { name: "", description: "" },
      opening: "",
      presetId: null,
      worldbookId: null,
    };
    assert.equal(
      (await post(`/api/sessions/${id}/preparation`, draft)).status,
      200,
    );
    store.close();
    store = new Store(path);
    app = createApp(store);
    assert.equal(store.options(id).openingDraft?.source?.reference, true);
    const config = {
      mock: true,
      model: "mock",
      baseUrl: "http://localhost",
      apiKey: "",
    };
    const opening = await post(`/api/sessions/${id}/opening`, {
      draft,
      config,
    });
    assert.equal(opening.status, 200);
    const generated = (await opening.json()) as {
      opening: string;
      prompt: {
        document: { omitted: number };
        messages: { content: string }[];
      };
    };
    assert.ok(generated.prompt.document.omitted > 100);
    assert.ok(JSON.stringify(generated.prompt.messages).length < 10000);
    assert.equal(
      (
        await post(`/api/sessions/${id}/start`, {
          ...draft,
          opening: generated.opening,
        })
      ).status,
      200,
    );
    const response = await post(`/api/sessions/${id}/turn`, {
      input: "寻找翡翠密钥",
      config,
    });
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(events.some((e) => e.type === "done"));
    const prompt = events.find((e) => e.type === "prompt").prompt;
    assert.ok(
      prompt.messages.some((m: { content: string }) =>
        m.content.includes("翡翠密钥藏在北港钟楼"),
      ),
    );
    assert.ok(prompt.document.bytes <= 4096);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM model_usage").get()!.n,
      2,
    );
    assert.deepEqual(
      Buffer.from(
        await (
          await app.request(`/api/documents/${source.documentId}/original`)
        ).arrayBuffer(),
      ),
      original,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
