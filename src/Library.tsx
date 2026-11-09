import { libraryGroups, type LibrarySave } from "./library-groups";
import { readJson, fetchLocal } from "./response";

import { CreationGuide, PlayerFields } from "./CreationGuide";
import { readPlayer } from "../shared/player";
import { BookEntryFields, type BookDraft } from "./BookEntryFields";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { Card } from "../server/cards";
import type { World } from "../server/worlds";
export type WorldItem = {
  id: string;
  world: World;
  original?: unknown;
  warnings: string[];
};
type Character = { id: string; card: Card; warnings: string[] };
type Save = LibrarySave;
export function Library({
  characters,
  worlds,
  saves,
  session,
  busy,
  onRefresh,
  onLoad,
  onStart,
  onCreated,
  onConfigure,
}: {
  characters: Character[];
  worlds: WorldItem[];
  saves: Save[];
  session: string;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onLoad: (id: string) => void;
  onCreated: (id: string) => Promise<void>;
  onConfigure: (id: string) => void;
  onStart: (cardId: string, worldId: string) => Promise<void>;
}) {
  const [playerName, setPlayerName] = useState(""),
    [playerDescription, setPlayerDescription] = useState("");
  const [book, setBook] = useState<BookDraft>({ entries: {} });
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
    const r = await fetchLocal("/api/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await readJson(r);
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
  const [renaming, setRenaming] = useState<string | null>(null),
    [saveName, setSaveName] = useState("");
  function start(character = "", world = "") {
    setCardId(character);
    setWorldId(world);
    setError("");
    void run(() => onStart(character, world));
  }
  function saveButtons(items: Save[], scope = "manage") {
    return items.map((s, i) => (
      <div key={s.id} className="save-row">
        {renaming === s.id ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await post(`sessions/${s.id}/options`, {
                  name: saveName.trim(),
                });
                await onRefresh();
                setRenaming(null);
              });
            }}
          >
            <label>
              存档名称
              <input
                aria-label="存档新名称"
                maxLength={100}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                autoFocus
              />
            </label>
            <button disabled={locked || !saveName.trim()}>保存名称</button>
            <button
              type="button"
              disabled={locked}
              onClick={() => setRenaming(null)}
            >
              取消
            </button>
          </form>
        ) : (
          <>
            <button
              className="shelf-item"
              disabled={locked}
              aria-pressed={session === s.id}
              onClick={() => onLoad(s.id)}
            >
              {s.options?.name ?? `存档 ${saves.indexOf(s) + 1}`}
              {s.options?.archived ? " · 已归档" : ""}
            </button>
            <button
              className="save-more"
              disabled={locked}
              aria-label={`存档菜单：${s.options?.name ?? `存档 ${saves.indexOf(s) + 1}`}`}
              popoverTarget={`save-menu-${scope}-${s.id}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect(),
                  menu = document.getElementById(`save-menu-${scope}-${s.id}`);
                if (menu) {
                  menu.style.left = `${Math.max(8, Math.min(r.right - 196, window.innerWidth - 204))}px`;
                  menu.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 160))}px`;
                }
              }}
            >
              <span aria-hidden="true">⋯</span>
            </button>
            <div
              id={`save-menu-${scope}-${s.id}`}
              popover="auto"
              className="save-menu"
              aria-label="存档操作"
            >
              <p>{s.options?.name ?? `存档 ${saves.indexOf(s) + 1}`}</p>
              <button
                disabled={locked}
                onClick={() => {
                  document
                    .getElementById(`save-menu-${scope}-${s.id}`)
                    ?.hidePopover();
                  setRenaming(s.id);
                  setSaveName(
                    s.options?.name ?? `存档 ${saves.indexOf(s) + 1}`,
                  );
                }}
              >
                重命名
              </button>
              <button
                disabled={locked}
                onClick={() => {
                  document
                    .getElementById(`save-menu-${scope}-${s.id}`)
                    ?.hidePopover();
                  onConfigure(s.id);
                }}
              >
                存档设置
              </button>
            </div>
          </>
        )}
      </div>
    ));
  }
  const groups = libraryGroups(
    saves,
    characters.map((c) => ({ id: c.id, name: c.card.data.name })),
    worlds.map((w) => ({ id: w.id, name: w.world.data.name })),
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("everse.recentSaves") ?? "[]")
        .filter((x: unknown) => typeof x === "string")
        .slice(0, 3);
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (!session) return;
    setRecentIds((previous) => {
      const next = [session, ...previous.filter((id) => id !== session)].slice(
        0,
        3,
      );
      try {
        localStorage.setItem("everse.recentSaves", JSON.stringify(next));
      } catch {
        /* Reading remains available when browser storage is full. */
      }
      return next;
    });
  }, [session]);
  const recent = recentIds
    .map((id) => saves.find((s) => s.id === id))
    .filter((s): s is Save => !!s && !s.options?.archived);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="recent-stories" aria-label="最近继续">
        <h2>最近继续</h2>
        {recent.length ? (
          recent.map((s) => {
            const group = groups.find((g) =>
              g.saves.some((v) => v.id === s.id),
            );
            return (
              <button
                key={s.id}
                className="recent-story"
                disabled={locked}
                onClick={() => onLoad(s.id)}
              >
                <span className="story-cover">
                  {Array.from(group?.name || "故")[0]}
                </span>
                <span>
                  <strong>{s.options?.name || "未命名存档"}</strong>
                  <small>{group?.name}</small>
                </span>
              </button>
            );
          })
        ) : (
          <p className="shelf-empty">打开一个存档，随时继续阅读。</p>
        )}
      </section>
      <section className="story-tree" aria-label="我的世界">
        <h2>我的世界</h2>
        {groups.map((g, i) => (
          <details
            className="story-tree-group"
            key={g.key}
            open={openGroups[g.key] ?? g.saves.some((s) => s.id === session)}
            onToggle={(e) => {
              const open = e.currentTarget.open;
              setOpenGroups((previous) =>
                previous[g.key] === open
                  ? previous
                  : { ...previous, [g.key]: open },
              );
            }}
          >
            <summary>
              <img
                className="figma-icon tree-chevron"
                src="/figma/collapsed.svg"
                alt=""
              />
              <span className="story-cover small">{Array.from(g.name)[0]}</span>
              <span>{g.name}</span>
            </summary>
            <div className="tree-saves">
              {saveButtons(g.saves, "tree" + i)}
              {!g.saves.length && (
                <small className="shelf-empty">尚无存档</small>
              )}
              <button
                disabled={locked}
                className="tree-action"
                onClick={() => {
                  if (g.source)
                    void run(async () => {
                      const created = await post("sessions", { prepare: true });
                      await post("sessions/" + created.id + "/preparation", {
                        source: g.source,
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
                      });
                      await onRefresh();
                      await onCreated(created.id);
                    });
                  else start(g.cardId, g.worldId);
                }}
              >
                <img className="figma-icon" src="/figma/plus.svg" alt="" />
                新建存档
              </button>
              {g.saves.length > 0 && (
                <button
                  className="tree-action"
                  disabled={locked}
                  onClick={() =>
                    onConfigure(
                      g.saves.find((s) => s.id === session)?.id ??
                        g.saves[0].id,
                    )
                  }
                >
                  <img
                    className="figma-icon"
                    src="/figma/world-settings.svg"
                    alt=""
                  />
                  设定与角色
                </button>
              )}
            </div>
          </details>
        ))}
      </section>
      <details className="library-manager">
        <summary>管理角色卡与世界书</summary>
        <div className="library-tabs" aria-label="作品分类">
          <button
            disabled={locked}
            aria-pressed={tab === "worlds"}
            onClick={() => setTab("worlds")}
          >
            世界书
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
              setPlayerName("");
              setPlayerDescription("");
              setBook({ entries: {} });
              setName("");
              setDescription("");
              setOpening("");
              setPersonality("");
              setScenario("");
              setError("");
              setDialog("create");
            }}
          >
            ＋ 新建{tab === "worlds" ? "世界书" : "角色卡"}
          </button>
          <label className="import">
            导入{tab === "worlds" ? "世界书" : "角色卡"}
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
                    const r = await fetchLocal("/api/cards", {
                      method: "POST",
                      headers: { "Content-Type": "image/png" },
                      body: file,
                    });
                    if (!r.ok) await readJson(r);
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
            ? "世界设定与开场。支持 Yuno 世界书 JSON、独立酒馆世界书 JSON。"
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
                      const player = readPlayer(c.card.data);
                      setPlayerName(player?.name ?? "");
                      setPlayerDescription(player?.description ?? "");
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
                  {saveButtons(
                    saves.filter((s) => s.options?.worldId === w.id),
                  )}
                  <button disabled={locked} onClick={() => start("", w.id)}>
                    在此世界新建存档
                  </button>
                  <button
                    disabled={locked}
                    onClick={() => {
                      const player = readPlayer(w.world.data);
                      setPlayerName(player?.name ?? "");
                      setPlayerDescription(player?.description ?? "");
                      setEditingId(w.id);
                      setName(w.world.data.name);
                      setDescription(w.world.data.description);
                      setOpening(w.world.data.first_mes);
                      const raw = w.original as
                        Record<string, unknown> | undefined;
                      const originalBook =
                        raw && "entries" in raw
                          ? raw
                          : (raw?.data as Record<string, unknown> | undefined)
                              ?.worldbook;
                      setBook(
                        structuredClone(
                          (originalBook ??
                            w.world.data.worldbook ?? {
                              entries: {},
                            }) as BookDraft,
                        ),
                      );
                      setError("");
                      setDialog("edit");
                    }}
                  >
                    编辑世界书
                  </button>
                  <a href={"/api/worlds/" + w.id + "/export"}>导出 JSON</a>
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
          <p className="muted">还没有作品，写几个字也可以开始。</p>
        )}
        <button disabled={locked} onClick={() => start()}>
          ＋ 新建存档
        </button>
        {saves.some((s) => !s.cardId && !s.options?.worldId) && (
          <section aria-label="独立故事存档">
            <h3>我的故事</h3>
            {saveButtons(saves.filter((s) => !s.cardId && !s.options?.worldId))}
          </section>
        )}
      </details>
      {dialog &&
        createPortal(
          <div className="settings-backdrop">
            <form
              className="settings"
              role="dialog"
              aria-modal="true"
              aria-label={
                dialog === "start"
                  ? "新建存档"
                  : tab === "worlds"
                    ? "编辑世界书"
                    : "编辑角色卡"
              }
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
                const startNow =
                  (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                    "value",
                  ) !== "save";
                void run(async () => {
                  if (dialog === "start") {
                    await onStart(cardId, worldId);
                  } else if (dialog === "create") {
                    const created = await post("creations", {
                      kind: tab,
                      name,
                      description,
                      opening,
                      personality,
                      scenario,
                      player: {
                        name: playerName,
                        description: playerDescription,
                      },
                      ...(tab === "worlds" ? { worldbook: book } : {}),
                      start: startNow,
                      prepare: true,
                    });
                    await onRefresh();
                    if (created.sessionId) await onCreated(created.sessionId);
                  } else {
                    const data = {
                      name,
                      description,
                      first_mes: opening,
                      player: {
                        name: playerName,
                        description: playerDescription,
                      },
                      ...(tab === "characters"
                        ? { personality, scenario }
                        : { worldbook: book }),
                    };
                    await post(
                      (tab === "worlds" ? "worlds/" : "cards/") +
                        editingId +
                        "/edit",
                      data,
                    );
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
                    ? tab === "worlds"
                      ? "编辑世界书"
                      : "编辑角色卡"
                    : tab === "worlds"
                      ? "新建世界书"
                      : "新建角色卡"}
              </h2>
              <fieldset disabled={locked}>
                {dialog === "start" ? (
                  <>
                    <label>
                      世界书
                      <select
                        autoFocus
                        value={worldId}
                        onChange={(e) => setWorldId(e.target.value)}
                      >
                        <option value="">不选择世界书</option>
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
                      至少选择一本世界书或一张角色卡。世界书的开场优先，未填写时使用角色开场；不会自动扩写设定。
                    </p>
                  </>
                ) : dialog === "create" ? (
                  <CreationGuide
                    kind={tab}
                    name={name}
                    description={description}
                    opening={opening}
                    playerName={playerName}
                    playerDescription={playerDescription}
                    onName={setName}
                    onDescription={setDescription}
                    onOpening={setOpening}
                    onPlayerName={setPlayerName}
                    onPlayerDescription={setPlayerDescription}
                  >
                    {tab === "worlds" ? (
                      <BookEntryFields book={book} onChange={setBook} />
                    ) : (
                      <>
                        <label>
                          性格（可选）
                          <textarea
                            value={personality}
                            maxLength={100000}
                            onChange={(e) => setPersonality(e.target.value)}
                          />
                        </label>
                        <label>
                          长期场景设定（可选）
                          <textarea
                            value={scenario}
                            maxLength={100000}
                            onChange={(e) => setScenario(e.target.value)}
                          />
                        </label>
                      </>
                    )}
                  </CreationGuide>
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
                    {tab === "worlds" && (
                      <BookEntryFields book={book} onChange={setBook} />
                    )}
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
                    <PlayerFields
                      name={playerName}
                      description={playerDescription}
                      onName={setPlayerName}
                      onDescription={setPlayerDescription}
                    />
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
                <div className="form-actions">
                  <button
                    type="submit"
                    value="start"
                    className="primary"
                    disabled={
                      dialog === "start"
                        ? !cardId && !worldId
                        : dialog === "edit" && !name.trim()
                    }
                  >
                    {dialog === "create"
                      ? "创建并准备开局"
                      : dialog === "start"
                        ? "开始故事"
                        : tab === "worlds"
                          ? "保存世界书"
                          : "保存角色卡"}
                  </button>
                  {dialog === "create" && (
                    <button type="submit" value="save">
                      仅保存作品
                    </button>
                  )}
                  <button type="button" onClick={() => setDialog(null)}>
                    取消
                  </button>
                </div>
              </fieldset>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
