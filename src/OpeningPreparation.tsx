import { useEffect, useState, type ReactNode } from "react";
import type { Card } from "../server/cards";
import type { WorldItem } from "./Library";
import type { Message } from "../server/context";
import type { SessionOptions } from "../server/settings";
import { preparationSchema, type Preparation } from "../shared/preparation";
import { readPlayer } from "../shared/player";
import { expand } from "../shared/character-text";
import { DocumentPlanEditor } from "./DocumentPlanEditor";
import type { OpeningGuide } from "../shared/opening-guide";
export type PreparingSession = {
  story?: import("../shared/story").StoryView;
  draft?: { raw: string; input: string; error: string } | null;
  id: string;
  cardId: string;
  options: SessionOptions;
  messages: Message[];
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    "/api/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "操作失败");
  return data;
}
export function OpeningPreparation({
  session,
  characters,
  worlds,
  modelControl,
  mock,
  onGenerate,
  onStarted,
  onBusy,
  onClassify,
  onGuide,
}: {
  session: PreparingSession;
  characters: { id: string; card: Card }[];
  worlds: WorldItem[];
  modelControl: ReactNode;
  mock: boolean;
  onGenerate: (draft: Preparation) => Promise<{ opening: string }>;
  onStarted: () => Promise<void>;
  onBusy: (value: boolean) => void;
  onClassify: (documentId: string, revision: number) => Promise<unknown>;
  onGuide: (draft: Preparation) => Promise<{ guide: OpeningGuide }>;
}) {
  const [draft, setDraft] = useState<Preparation>(() => {
    if (session.options.openingDraft) return session.options.openingDraft;
    const card = characters.find((c) => c.id === session.cardId)?.card,
      world = worlds.find((w) => w.id === session.options.worldId)?.world;
    return {
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
    [generating, setGenerating] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
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
      setGenerating(false);
      onBusy(false);
    }
  }
  function generateOpening() {
    void run(async () => {
      setGenerating(true);
      const result = await onGenerate(draft);
      setDraft({ ...draft, opening: result.opening });
      setNotice("开场已生成，请预览或编辑后确认开始。");
    });
  }
  return (
    <section className="settings opening-preparation" aria-label="开局准备">
      <h2>开局准备</h2>
      <p>
        从一个念头开始，几个字也可以。有作者开场时可直接预览；没有时再生成。身份和详细设定都可跳过。
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
                    const response = await fetch(
                      "/api/documents/word?name=" +
                        encodeURIComponent(file.name),
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/octet-stream" },
                        body: file,
                      },
                    );
                    const result = await response.json();
                    if (!response.ok)
                      throw new Error(result.error ?? "Word 导入失败");
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
              有作者创建流程时，可以读取设定中的问题与选项；不必填写统一角色表。
            </p>
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  const result = await onGuide({ ...draft, guide: undefined });
                  setDraft({ ...draft, guide: result.guide });
                  setNotice(
                    result.guide.questions.length
                      ? "请按设定选择或自由回答；答案会随准备保存，参与开场和后续剧情。"
                      : "资料没有明确的角色创建要求，可跳过身份直接开局。",
                  );
                })
              }
            >
              按作品设定生成角色引导
            </button>
            <small>
              {mock ? "使用模拟模型" : "调用当前 API 一次，可能产生费用"}
              ；不自动重试，不替你决定身份。
            </small>
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
          <h3>3 · 选择或写下开场剧情</h3>
          {choices.length > 0 ? (
            <label>
              角色卡与世界书自带开场
              <select
                value={choices.findIndex((c) => c.text === draft.opening)}
                onChange={(e) => {
                  const choice = choices[Number(e.target.value)];
                  if (choice) setDraft({ ...draft, opening: choice.text });
                }}
              >
                <option value={-1}>自定义开场（选择条目将替换编辑区）</option>
                {choices.map((c, i) => (
                  <option key={i} value={i}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted">
              没有现成开场，可以手写几句话，或主动让所选模型生成。
            </p>
          )}
          <label>
            开场正文
            <textarea
              aria-label="开场正文"
              maxLength={100000}
              value={draft.opening}
              onChange={(e) => setDraft({ ...draft, opening: e.target.value })}
              placeholder="例如：你推开书店的门，柜台上的信封写着你的名字。"
            />
          </label>
          <div className="opening-model">
            {modelControl}
            <button type="button" onClick={generateOpening}>
              {mock ? "用模拟模型生成开场" : "用所选 API 生成开场"}
            </button>
          </div>
          <p className="muted">
            {mock
              ? "当前使用免费模拟模型。"
              : "点击生成将调用你选择的 API，可能产生费用。"}
            不会自动重试，原草稿在失败时保留。
          </p>
          <section className="opening-preview" aria-label="开场预览">
            <h3>开场预览</h3>
            {preview.trim() ? (
              preview.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)
            ) : (
              <p>选择、编写或生成开场后，这里会显示第一幕。</p>
            )}
          </section>
          {!draft.opening.trim() && (
            <p id="opening-next-step">
              还缺少开场剧情。可以在上方手写，或点击下方按钮生成并预览。
              {mock
                ? "当前为免费模拟模型。"
                : "生成将调用当前选择的 API，可能产生费用。"}
            </p>
          )}
          <div className="form-actions">
            {draft.opening.trim() ? (
              <button type="submit" className="primary">
                确认开始故事
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                aria-describedby="opening-next-step"
                onClick={generateOpening}
              >
                生成开场并预览
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await api("sessions/" + session.id + "/preparation", draft);
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
      {generating && (
        <div role="status">
          正在生成开场…{" "}
          <button
            type="button"
            onClick={() =>
              void api("sessions/" + session.id + "/stop", {}).catch(() =>
                setError("停止失败，请稍后重试"),
              )
            }
          >
            停止生成
          </button>
        </div>
      )}
    </section>
  );
}
