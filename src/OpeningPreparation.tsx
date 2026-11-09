import { useEffect, useState, type ReactNode } from "react";
import type { Card } from "../server/cards";
import type { WorldItem } from "./Library";
import type { Message } from "../server/context";
import type { SessionOptions } from "../server/settings";
import { type Preparation } from "../shared/preparation";
import { readPlayer } from "../shared/player";
import { expand } from "../shared/character-text";
export type PreparingSession = {
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
}: {
  session: PreparingSession;
  characters: { id: string; card: Card }[];
  worlds: WorldItem[];
  modelControl: ReactNode;
  mock: boolean;
  onGenerate: (draft: Preparation) => Promise<{ opening: string }>;
  onStarted: () => Promise<void>;
  onBusy: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState<Preparation>(() => {
    if (session.options.openingDraft) return session.options.openingDraft;
    const card = characters.find((c) => c.id === session.cardId)?.card,
      world = worlds.find((w) => w.id === session.options.worldId)?.world;
    return {
      characterMode: card ? "existing" : "none",
      worldMode: world ? "existing" : card ? "none" : "simple",
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
  return (
    <section className="settings opening-preparation" aria-label="开局准备">
      <h2>开局准备</h2>
      <p>
        先确定角色、玩家身份和第一幕。确认开始后才进入自由互动，不会自动调用
        AI。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
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
                draft.worldMode === "existing" ? draft.worldId : draft.worldMode
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
          <h3>2 · 我在故事中是谁？</h3>
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
              maxLength={100000}
              value={draft.opening}
              onChange={(e) => setDraft({ ...draft, opening: e.target.value })}
              placeholder="例如：你推开书店的门，柜台上的信封写着你的名字。"
            />
          </label>
          <div className="opening-model">
            {modelControl}
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  setGenerating(true);
                  const result = await onGenerate(draft);
                  setDraft({ ...draft, opening: result.opening });
                  setNotice("开场已生成，请预览或编辑后确认开始。");
                })
              }
            >
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
          <div className="form-actions">
            <button
              type="submit"
              className="primary"
              disabled={!draft.opening.trim()}
            >
              确认开始故事
            </button>
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
