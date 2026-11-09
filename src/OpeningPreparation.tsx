import { requestJson as api, readJson, fetchLocal } from "./response";
import { useEffect, useState } from "react";
import type { Card } from "../server/cards";
import type { WorldItem } from "./Library";
import type { Message } from "../server/context";
import type { SessionOptions } from "../server/settings";
import { preparationSchema, type Preparation } from "../shared/preparation";
import { readPlayer } from "../shared/player";
import { expand } from "../shared/character-text";
import { DocumentPlanEditor } from "./DocumentPlanEditor";
export type PreparingSession = {
  editRevision?: string;
  story?: import("../shared/story").StoryView;
  draft?: { raw: string; input: string; error: string } | null;
  id: string;
  cardId: string;
  options: SessionOptions;
  messages: Message[];
};

export function OpeningPreparation({
  session,
  characters,
  worlds,
  mock,
  onStarted,
  onBusy,
  onClassify,
}: {
  session: PreparingSession;
  characters: { id: string; card: Card }[];
  worlds: WorldItem[];
  mock: boolean;
  onStarted: () => Promise<void>;
  onBusy: (value: boolean) => void;
  onClassify: (documentId: string, revision: number) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Preparation>(() => {
    if (session.options.openingDraft) return session.options.openingDraft;
    const card = characters.find((c) => c.id === session.cardId)?.card,
      world = worlds.find((w) => w.id === session.options.worldId)?.world;
    return {
      name: session.options.name ?? "",
      characterMode: card ? "existing" : "none",
      worldMode: world ? "existing" : "none",
      cardId: session.cardId,
      worldId: session.options.worldId ?? "",
      character: { name: "", description: "" },
      world: { name: "", description: "" },
      player: session.options.player ??
        readPlayer(world?.data) ??
        readPlayer(card?.data) ?? { name: "", description: "" },
      opening:
        world?.data.first_mes ||
        card?.data.first_mes ||
        session.messages[0]?.content ||
        "",
      presetId: session.options.presetId ?? null,
      worldbookId: session.options.worldbookId ?? null,
      source: session.options.storySource,
    };
  });
  const [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (session.options.name !== undefined)
      setDraft((current) => ({ ...current, name: session.options.name }));
  }, [session.options.name]);
  useEffect(() => {
    if (session.options.presetId !== undefined)
      setDraft((current) => ({
        ...current,
        presetId: session.options.presetId!,
      }));
  }, [session.options.presetId]);
  useEffect(() => {
    if (session.options.worldbookId !== undefined)
      setDraft((current) => ({
        ...current,
        worldbookId: session.options.worldbookId!,
      }));
  }, [session.options.worldbookId]);
  const [presets, setPresets] = useState<{ id: string; name: string }[]>([]),
    [books, setBooks] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    Promise.all([
      api<{ id: string; name: string }[]>("presets"),
      api<{ id: string; name: string }[]>("worldbooks"),
    ])
      .then(([p, b]) => {
        setPresets(p);
        setBooks(b);
      })
      .catch((e) => setError(String(e)));
  }, []);
  const card =
    draft.characterMode === "existing"
      ? characters.find((c) => c.id === draft.cardId)?.card
      : undefined;
  const world =
    draft.worldMode === "existing"
      ? worlds.find((w) => w.id === draft.worldId)?.world
      : undefined;
  const actorName =
    card?.data.name ||
    (draft.characterMode === "simple"
      ? draft.character.name || "故事角色"
      : world?.data.name || draft.world.name || "未命名世界");
  const choices = [
    ...(world?.data.first_mes
      ? [{ label: "世界书开场", text: world.data.first_mes }]
      : []),
    ...(card
      ? [
          { label: "角色卡默认开场", text: card.data.first_mes },
          ...(card.data.alternate_greetings ?? []).map((text, i) => ({
            label: `角色卡备选开场 ${i + 1}`,
            text,
          })),
        ]
      : []),
  ].filter((c) => c.text.trim());
  const preview = expand(draft.opening, actorName, draft.player.name);
  async function run(fn: () => Promise<void>) {
    setError("");
    setNotice("");
    setWorking(true);
    onBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setWorking(false);
      onBusy(false);
    }
  }
  return (
    <section className="settings opening-preparation" aria-label="开局准备">
      <h2>开局准备</h2>
      <p>
        填写或导入故事设定后即可进入。角色初始化按作品要求在正文中进行，直接用文字回复，不必先填角色表或生成开场预览。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {session.draft?.raw && session.draft.error && (
        <div className="opening-preview">
          <p>上次生成的开场还在本机，可以先恢复检查，不必重新付费生成。</p>
          <button
            disabled={working}
            type="button"
            onClick={() =>
              void run(async () => {
                const result = await api<{ opening: string; warning: string }>(
                  `sessions/${session.id}/recover-opening`,
                  {},
                );
                setDraft((current) => ({
                  ...current,
                  opening: result.opening,
                }));
                setNotice(result.warning);
              })
            }
          >
            恢复上次开场（不调用 AI）
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api("sessions/" + session.id + "/start", draft);
            await onStarted();
          });
        }}
      >
        <fieldset disabled={working}>
          <label>
            存档名称（可选）
            <input
              aria-label="存档名称（可选）"
              maxLength={100}
              placeholder="给这段故事起个名字"
              value={draft.name ?? ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <h3>1 · 故事与人物</h3>
          <label>
            {draft.source?.reference
              ? "开局方向或补充要求（可选，不会修改长文原件）"
              : "你想进入怎样的故事？（已有作品可留空）"}
            <textarea
              aria-label="故事设定"
              maxLength={100000}
              placeholder="例如：雨城侦探"
              value={draft.source?.text ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  source: {
                    ...draft.source,
                    name: draft.source?.name ?? "我的故事",
                    format: draft.source?.format ?? "text",
                    text: e.target.value,
                  },
                })
              }
            />
          </label>
          <label className="import">
            导入设定（Word / TXT / Markdown）
            <input
              type="file"
              accept=".docx,.txt,.md"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (/\.doc$/i.test(file.name))
                    throw new Error(
                      "旧版 .doc 请在 Word 或 WPS 中另存为 .docx 后导入",
                    );
                  if (/\.docx$/i.test(file.name)) {
                    if (file.size > 2 * 1024 * 1024)
                      throw new Error("Word 文件上限 2 MB，请拆分或移除大图片");
                    const response = await fetchLocal(
                      "/api/documents/word?name=" +
                        encodeURIComponent(file.name),
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/octet-stream" },
                        body: file,
                      },
                    );
                    const result = await readJson(response);
                    const source = preparationSchema.shape.source.parse(result);
                    setDraft({ ...draft, source });
                    setNotice(
                      source?.reference
                        ? "长文已完整保存为故事资料。可补充想从哪位人物或哪个场景开始，再生成开场；不必拆分文档。"
                        : "Word 文字已提取到设定框。请检查内容，保存准备后可继续；导入不会调用 AI。",
                    );
                    return;
                  }
                  if (!/\.(txt|md)$/i.test(file.name))
                    throw new Error("请选择 DOCX、TXT 或 Markdown 文件");
                  if (file.size > 400000)
                    throw new Error("文本文件请限制在 400 KB 内");
                  const text = await file.text();
                  if (text.length > 100000 || text.includes("\uFFFD"))
                    throw new Error(
                      "请使用不超过10万字的 UTF-8 文本；当前文件过长或编码无法识别",
                    );
                  setDraft({
                    ...draft,
                    source: {
                      name: file.name.slice(0, 100),
                      format: file.name.toLowerCase().endsWith(".md")
                        ? "md"
                        : "txt",
                      text,
                    },
                  });
                });
              }}
            />
          </label>
          {draft.source?.warnings?.map((warning, i) => (
            <p className="muted" key={i}>
              {warning}
            </p>
          ))}
          {draft.source?.documentId && (
            <div>
              {draft.source.reference && (
                <p role="status">
                  长文资料：{draft.source.characters?.toLocaleString()}{" "}
                  字符已保留。每轮只引用部分相关片段；实际片段可在 Prompt
                  Inspector 查看。系统不保证找到所有相关设定。
                </p>
              )}
              <a href={`/api/documents/${draft.source.documentId}/original`}>
                下载原始 Word 文档
              </a>
              {draft.source.reference && (
                <>
                  {" "}
                  ·{" "}
                  <a href={`/api/documents/${draft.source.documentId}/text`}>
                    下载完整提取文本
                  </a>
                </>
              )}
            </div>
          )}
          {draft.source?.reference && draft.source.documentId && (
            <DocumentPlanEditor
              key={draft.source.documentId}
              documentId={draft.source.documentId}
              disabled={working}
              mock={mock}
              onBusy={(value) => {
                setWorking(value);
                onBusy(value);
              }}
              onClassify={(revision) =>
                onClassify(draft.source!.documentId!, revision)
              }
            />
          )}
          <details
            open={
              draft.characterMode === "existing" ||
              draft.worldMode === "existing" ||
              undefined
            }
          >
            <summary>已有角色卡、世界书与详细设定（可选）</summary>
            <label>
              故事中的角色
              <select
                value={
                  draft.characterMode === "existing"
                    ? draft.cardId
                    : draft.characterMode
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft({
                    ...draft,
                    characterMode:
                      v === "simple" || v === "none" ? v : "existing",
                    cardId: v === "simple" || v === "none" ? "" : v,
                  });
                }}
              >
                <option value="none">暂不指定角色</option>
                <option value="simple">自行创建简单角色</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.card.data.name}
                  </option>
                ))}
              </select>
            </label>
            {draft.characterMode === "simple" && (
              <>
                <label>
                  角色名字（可选）
                  <input
                    maxLength={100}
                    value={draft.character.name}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        character: { ...draft.character, name: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  角色设定
                  <textarea
                    maxLength={100000}
                    value={draft.character.description}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        character: {
                          ...draft.character,
                          description: e.target.value,
                        },
                      })
                    }
                    placeholder="例如：住在海边的守灯人，记得每一艘返航的船。"
                  />
                </label>
              </>
            )}
            <label>
              世界设定
              <select
                value={
                  draft.worldMode === "existing"
                    ? draft.worldId
                    : draft.worldMode
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft({
                    ...draft,
                    worldMode: v === "simple" || v === "none" ? v : "existing",
                    worldId: v === "simple" || v === "none" ? "" : v,
                  });
                }}
              >
                <option value="none">使用角色卡背景</option>
                <option value="simple">自行创建简单世界</option>
                {worlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.world.data.name}
                  </option>
                ))}
              </select>
            </label>
            {draft.worldMode === "simple" && (
              <>
                <label>
                  世界名称（可选）
                  <input
                    maxLength={100}
                    value={draft.world.name}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        world: { ...draft.world, name: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  背景设定
                  <textarea
                    maxLength={100000}
                    value={draft.world.description}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        world: { ...draft.world, description: e.target.value },
                      })
                    }
                    placeholder="例如：雨城的书店只在深夜开门。"
                  />
                </label>
              </>
            )}
          </details>
          <details>
            <summary>我在故事中是谁？（可选）</summary>
            <p>
              也可以留空，进入故事后按作品要求直接回复。已有旧版问答仍会保留。
            </p>
            {draft.guide?.questions.map((question, index) => (
              <div className="opening-question" key={index}>
                <label>
                  {index + 1}. {question.question}
                  <textarea
                    aria-label={question.question}
                    maxLength={2000}
                    value={draft.guide?.answers[index] ?? ""}
                    onChange={(e) => {
                      const guide = draft.guide!;
                      const answers = [...guide.answers];
                      answers[index] = e.target.value;
                      setDraft({ ...draft, guide: { ...guide, answers } });
                    }}
                  />
                </label>
                {question.choices.map((choice, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => {
                      const guide = draft.guide!;
                      const answers = [...guide.answers];
                      answers[index] = choice;
                      setDraft({ ...draft, guide: { ...guide, answers } });
                    }}
                  >
                    {i + 1}. {choice}
                  </button>
                ))}
                <details>
                  <summary>作者依据</summary>
                  <p>{question.evidence}</p>
                </details>
              </div>
            ))}
            {draft.guide && (
              <button
                type="button"
                onClick={() => setDraft({ ...draft, guide: undefined })}
              >
                移除引导（保留其他设定）
              </button>
            )}
            <label>
              玩家称呼（可选）
              <input
                maxLength={100}
                value={draft.player.name}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    player: { ...draft.player, name: e.target.value },
                  })
                }
              />
            </label>
            <label>
              玩家人设（可选）
              <textarea
                maxLength={10000}
                value={draft.player.description}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    player: { ...draft.player, description: e.target.value },
                  })
                }
                placeholder="留空也可以。这些信息仅用于当前存档，不会修改原角色卡。"
              />
            </label>
          </details>
          <details>
            <summary>预设与独立世界书（可选）</summary>
            <label>
              预设
              <select
                value={draft.presetId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, presetId: e.target.value || null })
                }
              >
                <option value="">基础编排</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              独立世界书
              <select
                value={draft.worldbookId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, worldbookId: e.target.value || null })
                }
              >
                <option value="">不额外绑定</option>
                {books.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </details>
          {(choices.length > 0 || draft.opening.trim()) && (
            <details>
              <summary>已有开场（可选）</summary>
              {choices.length > 0 && (
                <label>
                  作品自带开场
                  <select
                    value={choices.findIndex((c) => c.text === draft.opening)}
                    onChange={(e) => {
                      const choice = choices[Number(e.target.value)];
                      if (choice) setDraft({ ...draft, opening: choice.text });
                    }}
                  >
                    <option value={-1}>沿用已有草稿或作品默认开场</option>
                    {choices.map((c, i) => (
                      <option key={i} value={i}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="existing-opening">{preview || choices[0]?.text}</p>
            </details>
          )}
          <p className="muted">
            进入后可让 AI
            按设定开始，也可以直接输入你的身份或行动。只有发送给模型时才会调用
            API。
          </p>
          <div className="form-actions">
            <button type="submit" className="primary">
              进入故事
            </button>
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await api("sessions/" + session.id + "/preparation", draft);
                  await onStarted();
                  setNotice("准备内容已保存，下次打开存档可继续。");
                })
              }
            >
              保存准备，稍后开始
            </button>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </fieldset>
      </form>
    </section>
  );
}
