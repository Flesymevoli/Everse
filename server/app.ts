import {
  savePreparation,
  confirmPreparation,
  openingRequest,
  ensurePreparation,
  recoverOpening,
} from "./preparation.js";
import { randomUUID } from "node:crypto";
import { generateOpeningGuide } from "./opening-guide.js";
import { guideAnswers } from "../shared/opening-guide.js";
import { directorSchema, directorInstruction } from "../shared/director.js";
import { extractWord } from "./documents.js";
import { sourceContext } from "./document-context.js";
import {
  readPlan,
  savePlan,
  classifyPlan,
  nextBatch,
} from "./document-plan.js";
import { sectionKind } from "../shared/document-plan.js";
import {
  historyKey,
  parseStory,
  parseNarrative,
  readStory,
  storyContext,
  storyInstruction,
  StoryFormatError,
} from "./story.js";
import type { Usage } from "./provider.js";
import { preparationSchema } from "../shared/preparation.js";
import { validationMessage } from "./validation.js";
import { tokenLimit, resolveBudget } from "./budget.js";
import { createWork } from "./creation.js";
import { readPlayer, withPlayer, playerSchema } from "../shared/player.js";
import { editWorld } from "./world-edit.js";
import { ConnectionVault } from "./connection-vault.js";
import { windowsProtector, type SecretProtector } from "./secrets.js";
import { importWorld, combinedCard } from "./worlds.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { stream } from "hono/streaming";
import { z } from "zod";
import { importCard, expand, greetings } from "./cards.js";
import { buildContext } from "./context.js";
import { parseSuggestions, suggestionInstruction } from "./suggestions.js";
import { generate, generationError } from "./provider.js";
import type { Store } from "./store.js";
import { readPngCard } from "./png-card.js";
import { importBook } from "./worldbook.js";
import { importPreset, presetSchema, parametersSchema } from "./preset.js";
import { optionsSchema } from "./settings.js";
import { importChat, exportChat } from "./chat-files.js";
import {
  selectVariant,
  appendVariant,
  variantsOf,
  activeVariant,
} from "../shared/swipes.js";
const turn = z.object({
  requestId: z.string().uuid().optional(),
  mode: z.enum(["send", "regenerate"]).default("send"),
  input: z.string().trim().max(20000).default(""),
  budget: tokenLimit.optional(),
  reserve: tokenLimit.optional(),
  connectionId: z.string().min(1).max(100).optional(),
  config: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().max(4096),
    model: z.string().min(1),
    mock: z.boolean(),
    parameters: parametersSchema.optional(),
  }),
});
export function createApp(
  store: Store,
  protector: SecretProtector = windowsProtector,
  webPort = 5173,
) {
  const vault = new ConnectionVault(store, protector);
  const app = new Hono();
  const busy = new Set<string>();
  const classifying = new Set<string>();
  const controllers = new Map<string, AbortController>();
  app.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  app.use("*", async (c, next) => {
    const host = (c.req.header("host") ?? new URL(c.req.url).host).split(
      ":",
    )[0];
    if (!["localhost", "127.0.0.1"].includes(host))
      return c.json({ error: "来源不允许" }, 403);
    if (
      c.req.path.startsWith("/api/connections") &&
      c.req.method === "POST" &&
      !c.req.header("content-type")?.startsWith("application/json")
    )
      return c.json({ error: "需要 JSON 请求" }, 415);
    const origin = c.req.header("origin");
    if (
      origin &&
      ![`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`].includes(
        origin,
      )
    )
      return c.json({ error: "来源不允许" }, 403);
    await next();
  });
  app.onError((e, c) =>
    c.json(
      { error: e instanceof z.ZodError ? validationMessage(e) : e.message },
      400,
    ),
  );
  app.get("/api/health", (c) =>
    c.json({ application: "Everse", status: "ok" }),
  );
  app.post("/api/documents/word", async (c) => {
    const name = z.string().min(1).max(200).parse(c.req.query("name"));
    const buffer = Buffer.from(await c.req.arrayBuffer());
    const extracted = await extractWord(buffer, name);
    const documentId = randomUUID();
    store.db
      .prepare(
        "INSERT INTO source_documents(id,name,body,extracted) VALUES (?,?,?,?)",
      )
      .run(documentId, name, buffer, extracted.text);
    const reference = extracted.text.length > 100000;
    return c.json({
      name: name.slice(0, 100),
      format: "docx",
      ...extracted,
      text: reference ? "" : extracted.text,
      reference,
      characters: extracted.text.length,
      warnings: [
        ...extracted.warnings,
        ...(reference
          ? [
              "已完整保存长文。开局及续写只发送与当前情境相关的原文片段，不会整篇发送或自动付费摘要；可在设定框补充开局地点、人物或主题以帮助检索。",
            ]
          : []),
      ],
      documentId,
    });
  });
  app.get("/api/documents/:id/plan", (c) => {
    const plan = readPlan(store, c.req.param("id"));
    return c.json({ ...plan, batchSize: nextBatch(plan).length });
  });
  app.get("/api/documents/:id/usage", (c) => {
    const id = c.req.param("id");
    readPlan(store, id);
    return c.json(
      store.db
        .prepare("SELECT body FROM model_usage WHERE sessionId=? ORDER BY id")
        .all("document:" + id)
        .map((row) => JSON.parse(String(row.body))),
    );
  });
  app.post("/api/documents/:id/plan", async (c) => {
    const id = c.req.param("id");
    const body = z
      .object({
        revision: z.number().int().nonnegative(),
        index: z.number().int().nonnegative(),
        kind: sectionKind,
      })
      .strict()
      .parse(await c.req.json());
    if (classifying.has(id))
      return c.json({ error: "文档正在分类，请稍后修改" }, 409);
    const plan = readPlan(store, id),
      section = plan.sections[body.index];
    if (!section) throw new Error("段落不存在");
    section.kind = body.kind;
    section.origin = "user";
    return c.json(savePlan(store, plan, body.revision));
  });
  app.post("/api/documents/:id/classify", async (c) => {
    const id = c.req.param("id");
    const body = turn
      .pick({ config: true, connectionId: true })
      .extend({ revision: z.number().int().nonnegative() })
      .parse(await c.req.json());
    if (body.connectionId && !body.config.mock)
      body.config = await vault.config(body.connectionId);
    if (classifying.has(id)) return c.json({ error: "文档正在分类" }, 409);
    classifying.add(id);
    try {
      return c.json(await classifyPlan(store, id, body.config, body.revision));
    } finally {
      classifying.delete(id);
    }
  });
  app.get("/api/documents/:id/original", (c) => {
    const row = store.db
      .prepare("SELECT body FROM source_documents WHERE id=?")
      .get(c.req.param("id"));
    if (!row) return c.json({ error: "原始文档不存在" }, 404);
    c.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    c.header("Content-Disposition", 'attachment; filename="original.docx"');
    return c.body(new Uint8Array(row.body as Uint8Array));
  });
  app.get("/api/documents/:id/text", (c) => {
    const row = store.db
      .prepare("SELECT extracted FROM source_documents WHERE id=?")
      .get(c.req.param("id"));
    if (!row || typeof row.extracted !== "string")
      return c.json({ error: "提取文本不存在" }, 404);
    c.header("Content-Disposition", 'attachment; filename="extracted.txt"');
    return c.text(row.extracted);
  });
  app.post("/api/sessions/:id/preparation", async (c) => {
    const body = await c.req.json(),
      id = c.req.param("id");
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    return c.json(savePreparation(store, id, body));
  });
  app.post("/api/sessions/:id/start", async (c) => {
    const body = await c.req.json(),
      id = c.req.param("id");
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    return c.json(confirmPreparation(store, id, body));
  });
  app.post("/api/sessions/:id/recover-opening", (c) => {
    const id = c.req.param("id");
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    return c.json(recoverOpening(store, id));
  });
  app.post("/api/sessions/:id/guide", async (c) => {
    const id = c.req.param("id"),
      body = turn
        .pick({ config: true, connectionId: true })
        .extend({ draft: preparationSchema })
        .parse(await c.req.json());
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    if (body.connectionId && !body.config.mock)
      body.config = await vault.config(body.connectionId);
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    const controller = new AbortController();
    busy.add(id);
    controllers.set(id, controller);
    try {
      return c.json({
        guide: await generateOpeningGuide(
          store,
          id,
          body.draft,
          body.config,
          controller.signal,
        ),
      });
    } finally {
      busy.delete(id);
      controllers.delete(id);
    }
  });
  app.post("/api/sessions/:id/director", async (c) => {
    const id = c.req.param("id"),
      body = z
        .object({
          revision: z.number().int().nonnegative(),
          director: directorSchema,
        })
        .strict()
        .parse(await c.req.json());
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    const session = store.session(id);
    if (session.options.archived) throw new Error("请先恢复归档存档");
    if ((session.options.directorRevision ?? 0) !== body.revision)
      return c.json({ error: "引导已在其他页面修改，请重新打开存档" }, 409);
    store.db.exec("BEGIN IMMEDIATE");
    try {
      store.db
        .prepare("INSERT INTO director_revisions(sessionId,body) VALUES (?,?)")
        .run(id, JSON.stringify(session.options.director ?? {}));
      store.setOptions(id, {
        ...session.options,
        director: body.director,
        directorRevision: body.revision + 1,
      });
      store.db.exec("COMMIT");
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
    return c.json({ ok: true });
  });
  app.post("/api/sessions/:id/opening", async (c) => {
    const body = turn
        .pick({ config: true, connectionId: true, budget: true, reserve: true })
        .extend({ draft: preparationSchema })
        .parse(await c.req.json()),
      id = c.req.param("id");
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    ensurePreparation(store, id);
    if (body.connectionId && !body.config.mock)
      body.config = await vault.config(body.connectionId);
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    const request = openingRequest(
      store,
      id,
      body.draft,
      body.config,
      body.budget,
      body.reserve,
    );
    savePreparation(store, id, body.draft);
    busy.add(id);
    const controller = new AbortController();
    controllers.set(id, controller);
    let opening = "";
    let usage: Usage | null = null;
    let status = "failed";
    const started = Date.now();
    try {
      for await (const part of generate(
        request.config,
        request.prompt.messages,
        request.maxTokens,
        controller.signal,
        (value) => {
          usage = value;
        },
      )) {
        opening += part;
        if (opening.length > 100000) throw new Error("开场过长");
      }
      controller.signal.throwIfAborted();
      if (!opening.trim()) throw new Error("空开场");
      const parsed = parseNarrative(opening, []);
      store.saveDraft(id, {
        raw: opening,
        input: "",
        base: historyKey([]),
        error: "",
      });
      const openingText = parseSuggestions(parsed.text).text;
      savePreparation(store, id, { ...body.draft, opening: openingText });
      status = "completed";
      return c.json({
        opening: openingText,
        prompt: request.prompt,
        warning:
          [request.prompt.guideWarning, parsed.warning]
            .filter(Boolean)
            .join("\n") || undefined,
      });
    } catch (error) {
      store.saveDraft(id, {
        raw: opening,
        input: "",
        base: historyKey([]),
        error: "开场未完成或状态校验失败",
      });
      return c.json(
        {
          error:
            error instanceof StoryFormatError
              ? error.message
              : generationError(error, controller.signal.aborted) +
                "原草稿已保留。",
        },
        400,
      );
    } finally {
      store.db
        .prepare("INSERT INTO model_usage(sessionId,body) VALUES (?,?)")
        .run(
          id,
          JSON.stringify({
            purpose: "opening",
            model: body.config.model,
            mock: body.config.mock,
            usage,
            status,
            elapsedMs: Date.now() - started,
          }),
        );
      busy.delete(id);
      controllers.delete(id);
    }
  });
  app.get("/api/connections", (c) => c.json(vault.list()));
  app.post("/api/connections", async (c) =>
    c.json(await vault.save(await c.req.json())),
  );
  app.post("/api/connections/:id/delete", (c) => {
    vault.delete(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/connections/:id/clear-key", (c) => {
    vault.clearKey(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/creations", async (c) =>
    c.json(createWork(store, await c.req.json())),
  );
  app.get("/api/worlds", (c) => c.json(store.worlds()));
  app.post("/api/worlds", async (c) => {
    const body = z
      .object({ original: z.unknown(), name: z.string().max(100).optional() })
      .parse(await c.req.json());
    const value = importWorld(body.original, body.name);
    return c.json({ id: store.addWorld(value), ...value });
  });
  app.post("/api/worlds/:id/edit", async (c) => {
    const body = await c.req.json();
    const id = c.req.param("id");
    const item = store.worlds().find((w) => w.id === id);
    if (!item) throw new Error("世界书不存在");
    if (
      store.sessions().some((s) => s.options.worldId === id && busy.has(s.id))
    )
      return c.json({ error: "相关存档正在生成，请稍后修改" }, 409);
    const updated = editWorld(item, body);
    store.updateAsset(id, "worlds", updated.world.data.name, updated);
    return c.json({ id, ...updated });
  });
  app.post("/api/worldbooks/:id/edit", async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        original: z.unknown(),
      })
      .strict()
      .parse(await c.req.json());
    const id = c.req.param("id");
    if (
      store
        .sessions()
        .some((s) => s.options.worldbookId === id && busy.has(s.id))
    )
      return c.json({ error: "相关存档正在生成，请稍后修改" }, 409);
    const updated = importBook(body.original);
    store.updateAsset(id, "worldbooks", body.name, updated);
    return c.json({ id, name: body.name, ...updated });
  });
  app.get("/api/worlds/:id/export", (c) => {
    const w = store.worlds().find((w) => w.id === c.req.param("id"));
    if (!w) return c.json({ error: "世界书不存在" }, 404);
    return c.json(w.original);
  });
  app.get("/api/cards", (c) => c.json(store.cards()));
  for (const kind of ["worldbooks", "presets"] as const) {
    app.get("/api/" + kind, (c) => c.json(store.assets(kind)));
    app.post("/api/" + kind, async (c) => {
      const body = z
        .object({
          name: z.string().trim().min(1).max(100),
          original: z.unknown(),
        })
        .parse(await c.req.json());
      const asset =
        kind === "worldbooks"
          ? importBook(body.original)
          : importPreset(body.original);
      return c.json({
        id: store.addAsset(kind, body.name, asset),
        name: body.name,
        ...asset,
      });
    });
    app.get("/api/" + kind + "/:id/export", (c) => {
      const asset = store
        .assets(kind)
        .find((asset) => asset.id === c.req.param("id"));
      if (!asset) return c.json({ error: "资源不存在" }, 404);
      c.header("Content-Disposition", 'attachment; filename="asset.json"');
      return c.json(asset.original);
    });
  }
  app.post("/api/sessions/:id/options", async (c) => {
    const id = c.req.param("id");
    const options = optionsSchema
      .omit({
        openingState: true,
        openingDraft: true,
        openingGuide: true,
        director: true,
        directorRevision: true,
      })
      .parse(await c.req.json());
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    for (const [key, kind] of [
      ["worldId", "worlds"],
      ["worldbookId", "worldbooks"],
      ["presetId", "presets"],
    ] as const) {
      if (
        options[key] &&
        !store.assets(kind).some((asset) => asset.id === options[key])
      )
        throw new Error("绑定资源不存在");
    }
    if (
      !store.session(id).cardId &&
      !store.options(id).storySource?.text &&
      !store.options(id).storySource?.reference &&
      options.worldId === null
    )
      throw new Error("纯世界存档必须保留世界书");
    const previous = store.options(id);
    store.setOptions(id, {
      ...previous,
      ...options,
      ...(previous.openingDraft
        ? {
            openingDraft: {
              ...previous.openingDraft,
              ...(options.name !== undefined ? { name: options.name } : {}),
              ...(options.presetId !== undefined
                ? { presetId: options.presetId }
                : {}),
              ...(options.worldbookId !== undefined
                ? { worldbookId: options.worldbookId }
                : {}),
            },
          }
        : {}),
    });
    return c.json(store.options(id));
  });
  app.post("/api/sessions/import", async (c) => {
    const body = z
      .object({
        cardId: z.string(),
        text: z.string(),
        name: z.string().min(1).max(100),
      })
      .parse(await c.req.json());
    if (!store.cards().some((card) => card.id === body.cardId))
      throw new Error("作品不存在");
    const chat = importChat(body.text);
    const id = store.create(body.cardId, chat.messages);
    store.setOptions(id, { name: body.name, chatHeader: chat.header });
    return c.json({ id });
  });
  app.get("/api/sessions/:id/export", (c) => {
    const session = store.session(c.req.param("id"));
    const card = store.cards().find((card) => card.id === session.cardId);
    const exportName =
      card?.card.data.name ??
      store.worlds().find((w) => w.id === session.options.worldId)?.world.data
        .name ??
      "";
    c.header("Content-Disposition", 'attachment; filename="chat.jsonl"');
    return c.text(
      exportChat(
        session.messages,
        session.options.chatHeader ?? {
          user_name: "玩家",
          character_name: exportName,
          chat_metadata: {},
        },
        exportName,
      ),
    );
  });
  app.post("/api/sessions/:id/edit", async (c) => {
    const id = c.req.param("id");
    const body = z
      .object({
        index: z.number().int().min(0),
        content: z.string().max(100000),
      })
      .parse(await c.req.json());
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    const session = store.session(id);
    if (!session.messages[body.index]) throw new Error("消息不存在");
    session.messages[body.index] = {
      ...session.messages[body.index],
      content: body.content,
      suggestions: [],
      story: undefined,
    };
    const edited = session.messages[body.index];
    if (edited.role === "assistant" && (edited.variants || edited.st?.swipes)) {
      const variants = variantsOf(edited).map((variant, i) =>
        i === activeVariant(edited)
          ? {
              ...variant,
              content: body.content,
              suggestions: [],
              story: undefined,
            }
          : variant,
      );
      session.messages[body.index] = selectVariant(
        { ...edited, variants },
        activeVariant(edited),
      );
    }
    store.edit(id, session.messages);
    return c.json(store.session(id));
  });
  app.post("/api/sessions/:id/undo", (c) => {
    const id = c.req.param("id");
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    store.undo(id);
    return c.json(store.session(id));
  });
  app.post("/api/sessions/:id/branch", async (c) => {
    const body = z
      .object({ count: z.number().int().min(0) })
      .parse(await c.req.json());
    const session = store.session(c.req.param("id"));
    if (busy.has(session.id)) return c.json({ error: "请等待生成结束" }, 409);
    if (body.count > session.messages.length)
      throw new Error("分支位置超出范围");
    const id = store.create(
      session.cardId,
      session.messages.slice(0, body.count),
    );
    store.setOptions(id, {
      ...session.options,
      name: (session.options.name ?? "存档") + " 分支",
      archived: false,
    });
    store.setSuggestions(id, session.suggestions);
    store.copyCorrections(session.id, id);
    return c.json({ id });
  });
  app.post("/api/cards", async (c) => {
    const png = c.req.header("content-type")?.split(";")[0] === "image/png";
    const result = importCard(
      png
        ? readPngCard(Buffer.from(await c.req.arrayBuffer()))
        : await c.req.json(),
    );
    if (png)
      result.warnings.push(
        "PNG 已提取角色数据；头像像素暂不保存，导出为 JSON，不是 PNG",
      );
    return c.json({ id: store.addCard(result), ...result });
  });
  app.post("/api/cards/:id/edit", async (c) => {
    const patch = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(100000).optional(),
        personality: z.string().max(100000).optional(),
        scenario: z.string().max(100000).optional(),
        first_mes: z.string().max(100000).optional(),
        player: playerSchema.optional(),
      })
      .strict()
      .parse(await c.req.json());
    const id = c.req.param("id");
    const item = store.cards().find((x) => x.id === id);
    if (!item) throw new Error("角色卡不存在");
    if (store.sessions().some((s) => s.cardId === id && busy.has(String(s.id))))
      return c.json({ error: "相关存档正在生成，请稍后修改" }, 409);
    const raw = (item.original ?? item.card) as Record<string, unknown> & {
      data: Record<string, unknown>;
    };
    const { player, ...fields } = patch;
    const updated = importCard({
      ...raw,
      data: player
        ? withPlayer({ ...raw.data, ...fields }, player)
        : { ...raw.data, ...fields },
    });
    store.updateCard(id, updated);
    return c.json({ id, ...updated });
  });
  app.get("/api/cards/:id/export", (c) => {
    const item = store.cards().find((x) => x.id === c.req.param("id"));
    if (!item) return c.json({ error: "作品不存在" }, 404);
    c.header("Content-Disposition", 'attachment; filename="character.json"');
    c.header(
      "X-Card-Export",
      item.original === undefined ? "stored-fallback" : "original",
    );
    return c.json(item.original ?? item.card);
  });
  app.get("/api/sessions", (c) => c.json(store.sessions()));
  app.post("/api/sessions", async (c) => {
    const { cardId, worldId, prepare } = z
      .object({
        cardId: z.string().default(""),
        worldId: z.string().optional(),
        prepare: z.boolean().default(false),
      })
      .parse(await c.req.json());
    const item = store.cards().find((x) => x.id === cardId);
    const world = store.worlds().find((x) => x.id === worldId);
    if (cardId && !item) throw new Error("角色卡不存在");
    if (worldId && !world) throw new Error("世界书不存在");
    if (prepare && !item && !world) {
      const id = store.create("", []);
      store.setOptions(id, { openingState: "preparing" });
      return c.json({ id });
    }
    const card = combinedCard(item?.card, world?.world);
    const opening = world?.world.data.first_mes || card.data.first_mes;
    const id = store.create(
      cardId,
      opening
        ? [
            {
              role: "assistant",
              content: expand(
                opening,
                card.data.name,
                (readPlayer(world?.world.data) ?? readPlayer(card.data))?.name,
              ),
            },
          ]
        : [],
    );
    if (worldId || prepare)
      store.setOptions(id, {
        ...(worldId ? { worldId } : {}),
        ...(prepare ? { openingState: "preparing" as const } : {}),
      });
    return c.json({ id });
  });
  app.get("/api/sessions/:id", (c) => {
    const id = c.req.param("id");
    return c.json({
      ...store.session(id),
      story: store.story(id),
      draft: store.draft(id),
    });
  });
  app.get("/api/sessions/:id/story", (c) =>
    c.json(store.story(c.req.param("id"))),
  );
  app.post("/api/sessions/:id/story/correct", async (c) => {
    const id = c.req.param("id");
    const body = z
      .object({
        revision: z.string().length(64),
        key: z.string().min(1).max(80),
        value: z.string().trim().min(1).max(600).nullable(),
      })
      .strict()
      .parse(await c.req.json());
    if (busy.has(id)) return c.json({ error: "请等待生成结束" }, 409);
    store.correct(id, body.revision, body.key, body.value);
    return c.json(store.story(id));
  });
  app.get("/api/sessions/:id/usage", (c) => {
    const id = c.req.param("id");
    store.session(id);
    return c.json(
      store.db
        .prepare("SELECT body FROM model_usage WHERE sessionId=? ORDER BY id")
        .all(id)
        .map((row) => JSON.parse(String(row.body))),
    );
  });
  app.post("/api/sessions/:id/greeting", async (c) => {
    const id = c.req.param("id");
    const { index } = z
      .object({ index: z.number().int().min(0) })
      .parse(await c.req.json());
    if (busy.has(id)) return c.json({ error: "正在生成，无法切换开场" }, 409);
    const session = store.session(id);
    if (
      session.messages.length > 1 ||
      session.messages.some((message) => message.role !== "assistant")
    )
      return c.json({ error: "已有剧情，不能再替换开场；请新建存档" }, 409);
    const item = store.cards().find((x) => x.id === session.cardId);
    if (!item) throw new Error("作品不存在");
    if (session.options.openingState === "started")
      throw new Error("开场已确认，请新建存档选择其他开场");
    const options = greetings(item.card, readPlayer(item.card.data)?.name);
    if (index >= options.length) return c.json({ error: "开场不存在" }, 400);
    store.save(
      id,
      options[index] ? [{ role: "assistant", content: options[index] }] : [],
    );
    return c.json(store.session(id));
  });
  app.post("/api/sessions/:id/preferences", async (c) => {
    const id = c.req.param("id");
    const { suggestions } = z
      .object({ suggestions: z.boolean() })
      .parse(await c.req.json());
    if (busy.has(id)) return c.json({ error: "请在生成结束后修改设置" }, 409);
    store.setSuggestions(id, suggestions);
    return c.json({ suggestions });
  });
  app.post("/api/sessions/:id/swipe", async (c) => {
    const id = c.req.param("id");
    const body = z
      .object({
        messageIndex: z.number().int().min(0),
        index: z.number().int().min(0),
      })
      .parse(await c.req.json());
    if (busy.has(id)) return c.json({ error: "生成中不能切换候选" }, 409);
    const session = store.session(id);
    const message = session.messages[body.messageIndex];
    if (!message || message.role !== "assistant")
      throw new Error("只能切换角色回复");
    session.messages[body.messageIndex] = selectVariant(message, body.index);
    store.save(id, session.messages);
    return c.json(store.session(id));
  });
  app.post("/api/sessions/:id/stop", (c) => {
    controllers.get(c.req.param("id"))?.abort();
    return c.json({ stopped: true });
  });
  app.post("/api/sessions/:id/turn", async (c) => {
    const id = c.req.param("id");
    if (busy.has(id)) return c.json({ error: "该存档正在生成" }, 409);
    const body = turn.parse(await c.req.json());
    const requestId = body.requestId ?? randomUUID();
    if (
      store.db
        .prepare(
          "SELECT 1 FROM turn_receipts WHERE sessionId=? AND requestId=?",
        )
        .get(id, requestId)
    ) {
      c.header("Content-Type", "application/x-ndjson");
      return c.body(JSON.stringify({ type: "done", replay: true }) + "\n");
    }
    if (body.connectionId && !body.config.mock)
      body.config = await vault.config(body.connectionId);
    const session = store.session(id);
    if (session.options.openingState === "preparing")
      throw new Error("请先完成开局准备并确认开始");
    const item = store.cards().find((x) => x.id === session.cardId);
    const worldCard = store
      .worlds()
      .find((w) => w.id === session.options.worldId);
    const runtimeCard = combinedCard(
      item?.card,
      worldCard?.world,
      session.options.storySource,
    );
    if (session.options.archived) throw new Error("请先恢复归档的聊天");
    const worldbook = store
      .assets("worldbooks")
      .find((asset) => asset.id === session.options.worldbookId);
    const presetAsset = store
      .assets("presets")
      .find((asset) => asset.id === session.options.presetId);
    const preset = presetAsset
      ? presetSchema.parse(presetAsset.original)
      : undefined;
    const presetParams = presetAsset
      ? importPreset(presetAsset.original).parameters
      : {};
    const parameters = parametersSchema.parse({
      ...presetParams,
      ...session.options.parameters,
      ...body.config.parameters,
    });
    if (parameters.seed === -1) delete parameters.seed;
    const limits = resolveBudget(body.budget, body.reserve, preset);
    const { budget, reserve } = limits;
    let history = session.messages;
    let input = body.input;
    if (body.mode === "regenerate") {
      if (
        history.at(-1)?.role !== "assistant" ||
        history.at(-2)?.role !== "user"
      )
        throw new Error("只能重新生成最近一次玩家行动的回复");
      input = history.at(-2)!.content;
      history = history.slice(0, -2);
    } else if (!input) throw new Error("请输入内容");
    const tracking = session.options.storyTracking === true;
    const memory = tracking
      ? storyContext(
          readStory(history, store.corrections(id)),
          input,
          history,
          Math.min(6000, Math.max(512, Math.floor(budget / 3))),
        )
      : { text: "", selected: [], omitted: 0, bytes: 0 };
    const base = historyKey(session.messages);
    const source = sourceContext(
      store,
      session.options.storySource,
      [...history.slice(-2).map((m) => m.content), input].join("\n"),
      Math.min(6000, Math.max(1600, Math.floor(budget / 2))),
    );
    const prompt = buildContext(runtimeCard, history, input, budget, reserve, {
      player:
        session.options.player ??
        readPlayer(worldCard?.world.data) ??
        readPlayer(runtimeCard.data),
      worldDescription: [
        source.text,
        worldCard?.world.data.description,
        guideAnswers(session.options.openingGuide),
      ]
        .filter(Boolean)
        .join("\n\n"),
      cardWorldbook: worldCard?.world.data.worldbook,
      worldbook: worldbook?.original,
      preset: presetAsset?.original,
      ...session.options,
      automaticBudget: limits.automaticBudget,
      scanDepth: session.options.scanDepth,
      extraInstruction: [
        session.suggestions
          ? tracking
            ? suggestionInstruction.replace("在末尾", "在故事状态标签之前")
            : suggestionInstruction
          : "",
        tracking ? memory.text + "\n" + storyInstruction : "",
        tracking && history.some((message) => message.warning)
          ? "部分历史回合的辅助状态未更新；与状态冲突时，以较新的正文和玩家明确修订为准，不凭空补全缺失记录。"
          : "",
        directorInstruction(session.options.director),
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    // Recheck after the asynchronous body read before acquiring the turn.
    if (busy.has(id)) return c.json({ error: "该存档正在生成" }, 409);
    busy.add(id);
    const controller = new AbortController();
    controllers.set(id, controller);
    c.header("Content-Type", "application/x-ndjson");
    return stream(c, async (s) => {
      s.onAbort(() => controller.abort());
      let reply = "";
      let usage: Usage | null = null;
      let status = "failed";
      const started = Date.now();
      let lastCheckpoint = 0;
      try {
        await s.write(
          JSON.stringify({
            type: "prompt",
            prompt: {
              ...prompt,
              parameters,
              budgetSource: limits.budgetSource,
              outputSource: limits.outputSource,
              maxTokens: limits.maxTokens ?? null,
              memory: tracking ? memory : null,
              document: source.document,
            },
          }) + "\n",
        );
        for await (const text of generate(
          { ...body.config, parameters },
          prompt.messages,
          limits.maxTokens,
          controller.signal,
          (value) => {
            usage = value;
          },
        )) {
          reply += text;
          if (reply.length > 100000) throw new Error("回复过长");
          if (Date.now() - lastCheckpoint >= 500) {
            store.saveDraft(id, {
              raw: reply,
              input,
              base,
              error: "生成中断时可从此草稿取回正文；尚未提交",
            });
            lastCheckpoint = Date.now();
          }
          await s.write(JSON.stringify({ type: "delta", text }) + "\n");
        }
        if (!reply.trim()) throw new Error("模型返回空回复");
        controller.signal.throwIfAborted();
        const narrative = tracking
          ? parseNarrative(reply, [
              ...history,
              { role: "user", content: input },
            ])
          : { text: reply, story: undefined, warning: undefined };
        const parsed = session.suggestions
          ? parseSuggestions(narrative.text)
          : { text: narrative.text, suggestions: [] };
        const replyMessage = {
          role: "assistant" as const,
          content: parsed.text,
          suggestions: parsed.suggestions,
          raw: reply,
          story: narrative.story,
          warning: narrative.warning,
        };
        store.commitTurn(
          id,
          base,
          body.mode === "regenerate"
            ? [
                ...session.messages.slice(0, -1),
                appendVariant(session.messages.at(-1)!, replyMessage),
              ]
            : [
                ...session.messages,
                { role: "user", content: input },
                replyMessage,
              ],
          requestId,
        );
        status = "completed";
        await s.write(JSON.stringify({ type: "done" }) + "\n");
      } catch (error) {
        if (status === "completed") return; // Transport failed after commit; never resurrect a committed draft.
        store.saveDraft(id, {
          raw: reply,
          input,
          base,
          error: "生成或状态校验未完成，原剧情保持不变",
        });
        await s.write(
          JSON.stringify({
            type: "error",
            error:
              error instanceof StoryFormatError
                ? error.message
                : generationError(error, controller.signal.aborted),
          }) + "\n",
        );
      } finally {
        store.db
          .prepare("INSERT INTO model_usage(sessionId,body) VALUES (?,?)")
          .run(
            id,
            JSON.stringify({
              purpose: body.mode,
              model: body.config.model,
              mock: body.config.mock,
              usage,
              status,
              elapsedMs: Date.now() - started,
            }),
          );
        busy.delete(id);
        controllers.delete(id);
      }
    });
  });
  return app;
}
