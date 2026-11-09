import { createPortal } from "react-dom";
import { useState } from "react";
import type { Card } from "../server/cards";
import type { World } from "../server/worlds";
export type WorldItem = { id: string; world: World; warnings: string[] };
type Character = { id: string; card: Card; warnings: string[] };
type Save = {
  id: string;
  cardId: string;
  options?: { name?: string; archived?: boolean; worldId?: string | null };
};
export function Library({
  characters,
  worlds,
  saves,
  session,
  busy,
  onRefresh,
  onLoad,
  onStart,
}: {
  characters: Character[];
  worlds: WorldItem[];
  saves: Save[];
  session: string;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onLoad: (id: string) => void;
  onStart: (cardId: string, worldId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"characters" | "worlds">("characters");
  const [dialog, setDialog] = useState<"create" | "edit" | "start" | null>(
    null,
  );
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [opening, setOpening] = useState("");
  const [editingId, setEditingId] = useState(""),
    [personality, setPersonality] = useState(""),
    [scenario, setScenario] = useState("");
  const [cardId, setCardId] = useState(""),
    [worldId, setWorldId] = useState("");
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  async function post(path: string, body: unknown) {
    const r = await fetch("/api/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "操作失败");
    return data;
  }
  async function run(fn: () => Promise<void>) {
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setWorking(false);
    }
  }
  const locked = busy || working;
  function start(character = "", world = "") {
    setCardId(character);
    setWorldId(world);
    setError("");
    setDialog("start");
  }
  function saveButtons(items: Save[]) {
    return items.map((s, i) => (
      <button
        key={s.id}
        className="shelf-item"
        disabled={locked}
        aria-pressed={session === s.id}
        onClick={() => onLoad(s.id)}
      >
        {s.options?.name ?? `存档 ${saves.indexOf(s) + 1}`}
        {s.options?.archived ? " · 已归档" : ""}
      </button>
    ));
  }
  return (
    <>
      <div className="library-tabs" aria-label="作品分类">
        <button
          disabled={locked}
          aria-pressed={tab === "worlds"}
          onClick={() => setTab("worlds")}
        >
          世界卡
        </button>
        <button
          disabled={locked}
          aria-pressed={tab === "characters"}
          onClick={() => setTab("characters")}
        >
          角色卡
        </button>
      </div>
      <div className="library-tools">
        <button
          disabled={locked}
          onClick={() => {
            setName("");
            setDescription("");
            setOpening("");
            setPersonality("");
            setScenario("");
            setError("");
            setDialog("create");
          }}
        >
          ＋ 新建{tab === "worlds" ? "世界卡" : "角色卡"}
        </button>
        <label className="import">
          导入{tab === "worlds" ? "世界卡" : "角色卡"}
          <input
            type="file"
            disabled={locked}
            accept={tab === "worlds" ? ".json" : ".json,.png"}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void run(async () => {
                if (file.size > 2000000) throw new Error("文件上限 2 MB");
                if (tab === "worlds")
                  await post("worlds", {
                    name: file.name.replace(/\.json$/i, ""),
                    original: JSON.parse(await file.text()),
                  });
                else if (file.name.toLowerCase().endsWith(".png")) {
                  const r = await fetch("/api/cards", {
                    method: "POST",
                    headers: { "Content-Type": "image/png" },
                    body: file,
                  });
                  if (!r.ok)
                    throw new Error((await r.json()).error ?? "导入失败");
                } else await post("cards", JSON.parse(await file.text()));
                await onRefresh();
              });
            }}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="muted">
        {tab === "worlds"
          ? "世界设定与开场。支持 Yuno 世界卡 JSON、独立酒馆世界书 JSON。"
          : "人物设定与开场。支持酒馆 V2/V3 JSON、PNG。"}
      </p>
      {tab === "characters"
        ? characters.map((c) => (
            <details className="work-group" key={c.id}>
              <summary>{c.card.data.name}</summary>
              <div className="work-saves">
                {saveButtons(saves.filter((s) => s.cardId === c.id))}
                <button disabled={locked} onClick={() => start(c.id)}>
                  用此角色新建存档
                </button>
                <button
                  disabled={locked}
                  onClick={() => {
                    setEditingId(c.id);
                    setName(c.card.data.name);
                    setDescription(c.card.data.description);
                    setOpening(c.card.data.first_mes);
                    setPersonality(c.card.data.personality);
                    setScenario(c.card.data.scenario);
                    setError("");
                    setDialog("edit");
                  }}
                >
                  编辑角色卡
                </button>
                {c.warnings.length > 0 && (
                  <details>
                    <summary>兼容提示</summary>
                    <ul>
                      {c.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </details>
          ))
        : worlds.map((w) => (
            <details className="work-group" key={w.id}>
              <summary>{w.world.data.name}</summary>
              <div className="work-saves">
                <p>{w.world.data.description || "未填写世界设定"}</p>
                {saveButtons(saves.filter((s) => s.options?.worldId === w.id))}
                <button disabled={locked} onClick={() => start("", w.id)}>
                  在此世界新建存档
                </button>
                <a href={"/api/worlds/" + w.id + "/export"}>导出原始 JSON</a>
                {w.warnings.length > 0 && (
                  <details>
                    <summary>兼容提示</summary>
                    <ul>
                      {w.warnings.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </details>
          ))}
      {(tab === "worlds" ? worlds : characters).length === 0 && (
        <p className="muted">还没有卡片，写几个字也可以开始。</p>
      )}
      <button disabled={locked} onClick={() => start()}>
        ＋ 新建存档
      </button>
      {dialog &&
        createPortal(
          <div className="settings-backdrop">
            <form
              className="settings"
              role="dialog"
              aria-modal="true"
              aria-label={dialog === "start" ? "新建存档" : "新建卡片"}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !locked) setDialog(null);
                if (e.key === "Tab") {
                  const items = Array.from(
                    e.currentTarget.querySelectorAll<HTMLElement>(
                      "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
                    ),
                  );
                  const first = items[0],
                    last = items.at(-1);
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                  }
                  if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                  }
                }
              }}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (dialog === "start") {
                    await onStart(cardId, worldId);
                  } else {
                    const data = {
                      name,
                      description,
                      first_mes: opening,
                      ...(tab === "characters"
                        ? { personality, scenario }
                        : {}),
                    };
                    if (dialog === "edit")
                      await post("cards/" + editingId + "/edit", data);
                    else if (tab === "worlds")
                      await post("worlds", {
                        original: { spec: "yuno_world_v1", data },
                      });
                    else
                      await post("cards", {
                        spec: "chara_card_v2",
                        spec_version: "2.0",
                        data,
                      });
                    await onRefresh();
                  }
                  setDialog(null);
                });
              }}
            >
              <h2>
                {dialog === "start"
                  ? "选择故事的世界与角色"
                  : dialog === "edit"
                    ? "编辑角色卡"
                    : tab === "worlds"
                      ? "新建世界卡"
                      : "新建角色卡"}
              </h2>
              <fieldset disabled={locked}>
                {dialog === "start" ? (
                  <>
                    <label>
                      世界卡
                      <select
                        autoFocus
                        value={worldId}
                        onChange={(e) => setWorldId(e.target.value)}
                      >
                        <option value="">不选择世界卡</option>
                        {worlds.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.world.data.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      角色卡
                      <select
                        value={cardId}
                        onChange={(e) => setCardId(e.target.value)}
                      >
                        <option value="">不选择角色卡</option>
                        {characters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.card.data.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="muted">
                      至少选择一张卡。世界卡的开场优先，未填写时使用角色开场；不会自动扩写设定。
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      名称
                      <input
                        autoFocus
                        required
                        maxLength={100}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <label>
                      {tab === "worlds" ? "世界设定" : "人物设定"}
                      <textarea
                        maxLength={100000}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="可以只有一句话，也可以留空"
                      />
                    </label>
                    {tab === "characters" && (
                      <>
                        <label>
                          性格（可选）
                          <textarea
                            maxLength={100000}
                            value={personality}
                            onChange={(e) => setPersonality(e.target.value)}
                          />
                        </label>
                        <label>
                          场景（可选）
                          <textarea
                            maxLength={100000}
                            value={scenario}
                            onChange={(e) => setScenario(e.target.value)}
                          />
                        </label>
                      </>
                    )}
                    {dialog === "edit" && (
                      <p className="muted">
                        其他导入字段原样保留。已有聊天和开场不会改写；设定从下一轮生效，新开场用于新存档。
                      </p>
                    )}
                    <label>
                      开场白（可选）
                      <textarea
                        maxLength={100000}
                        value={opening}
                        onChange={(e) => setOpening(e.target.value)}
                      />
                    </label>
                  </>
                )}
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  className="primary"
                  disabled={
                    dialog === "start" ? !cardId && !worldId : !name.trim()
                  }
                >
                  {dialog === "start" ? "开始故事" : "保存卡片"}
                </button>
                <button type="button" onClick={() => setDialog(null)}>
                  取消
                </button>
              </fieldset>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
