import {
  OpeningPreparation,
  type PreparingSession,
} from "./OpeningPreparation";
import { readPlayer } from "../shared/player";
import { Library, type WorldItem } from "./Library";
import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Card } from "../server/cards";
import { greetings } from "../shared/character-text";
import type { Message } from "../server/context";
import "./style.css";
import { ModelPicker } from "./ModelPicker";
import { ReadingView } from "./ReadingView";
import { StoryPanel } from "./StoryPanel";
import { ConnectionSettings } from "./ConnectionSettings";
import {
  connectionStorageKey,
  restoreConnections,
  serializeConnections,
  resolveConnection,
  removeConnection,
  type Connection,
} from "./connections";
import { Management } from "./Management";
import { SaveSettings } from "./SaveSettings";
import { visibleStory } from "../shared/story";
type Work = { id: string; card: Card; warnings: string[] };
type Save = {
  id: string;
  cardId: string;
  options?: { name?: string; archived?: boolean; worldId?: string | null };
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
  if (!r.ok) throw new Error(data.error ?? "请求失败");
  return data as T;
}
function App() {
  const [saveSettings, setSaveSettings] = useState<string | null>(null);
  const [storyPanel, setStoryPanel] = useState(
    () => window.matchMedia("(min-width: 1120px)").matches,
  );
  const [sidebar, setSidebar] = useState(false),
    [settings, setSettings] = useState(false),
    [suggestions, setSuggestions] = useState(false),
    [generating, setGenerating] = useState(false);
  const [loadedSession, setLoadedSession] = useState<PreparingSession | null>(
    null,
  );
  const preparing =
    !!loadedSession &&
    (loadedSession.options.openingState === "preparing" ||
      loadedSession.messages.length === 0);
  const [worlds, setWorlds] = useState<WorldItem[]>([]);
  const [activeWorldId, setActiveWorldId] = useState<string | null>(null);
  const [works, setWorks] = useState<Work[]>([]),
    [saves, setSaves] = useState<Save[]>([]),
    [selected, setSelected] = useState(""),
    [session, setSession] = useState(""),
    [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(""),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [prompt, setPrompt] = useState<unknown>(null);
  const [usage, setUsage] = useState<unknown>(null);
  const readingScroll = useRef<HTMLDivElement>(null),
    followStory = useRef(true);
  useLayoutEffect(() => {
    if (!preparing && followStory.current && readingScroll.current)
      readingScroll.current.scrollTop = readingScroll.current.scrollHeight;
  }, [draft, messages, preparing]);
  useEffect(() => {
    followStory.current = true;
  }, [session]);
  const [connections, setConnections] = useState(() => {
    try {
      return restoreConnections(localStorage.getItem(connectionStorageKey));
    } catch {
      return restoreConnections(null);
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        connectionStorageKey,
        serializeConnections(connections),
      );
    } catch {
      setError("浏览器无法保存连接信息；本页仍可使用，刷新后可能丢失设置。");
    }
  }, [connections]);
  const [budget, setBudget] = useState(8192),
    [reserve, setReserve] = useState(1024);
  const [automaticBudget, setAutomaticBudget] = useState(true);
  const work = works.find((w) => w.id === selected);
  const activeWorld = worlds.find((w) => w.id === activeWorldId);
  const activePlayer =
    loadedSession?.options.player ??
    readPlayer(activeWorld?.world.data) ??
    readPlayer(work?.card.data);
  async function refresh() {
    const [w, s, worlds] = await Promise.all([
      api<Work[]>("cards"),
      api<Save[]>("sessions"),
      api<WorldItem[]>("worlds"),
    ]);
    setWorlds(worlds);
    setWorks(w);
    setSaves(s);
  }
  useEffect(() => {
    void api<(Connection & { hasKey: boolean })[]>("connections")
      .then((profiles) =>
        setConnections((current) => ({
          ...current,
          profiles: [
            ...profiles.map((p) => ({ ...p, apiKey: "" })),
            ...current.profiles.filter(
              (p) => !p.saved && !profiles.some((saved) => saved.id === p.id),
            ),
          ],
        })),
      )
      .catch((e) => setError(String(e)));
    void refresh().catch((e) => setError(String(e)));
  }, []);
  async function load(id: string) {
    const s = await api<PreparingSession & { suggestions: boolean }>(
      "sessions/" + id,
    );
    setLoadedSession(s);
    setActiveWorldId(s.options?.worldId ?? null);
    setSession(id);
    setSuggestions(s.suggestions);
    setSidebar(false);
    setSelected(s.cardId);
    setMessages(s.messages);
    setPrompt(null);
    setUsage(null);
    setDraft("");
  }
  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
      setGenerating(false);
    }
  }
  async function send(mode: "send" | "regenerate" = "send") {
    await action(async () => {
      const config = resolveConnection(connections);
      setDraft("");
      setGenerating(true);
      const r = await fetch("/api/sessions/" + session + "/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          input,
          config,
          ...(!automaticBudget ? { budget, reserve } : {}),
          mode,
          connectionId: connections.profiles.find(
            (p) => p.id === connections.selectedId,
          )?.saved
            ? connections.selectedId
            : undefined,
        }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error);
      }
      if (!r.body) throw new Error("浏览器未提供响应流");
      let buffer = "",
        completed = false;
      for await (const chunk of r.body.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const event = JSON.parse(buffer.slice(0, end)) as {
            type: string;
            text?: string;
            prompt?: unknown;
            error?: string;
          };
          buffer = buffer.slice(end + 1);
          if (event.type === "prompt") setPrompt(event.prompt);
          if (event.type === "delta") setDraft((d) => d + (event.text ?? ""));
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "done") completed = true;
        }
      }
      if (!completed) throw new Error("连接中断，请重新打开存档确认结果");
      const updated = await api<PreparingSession>("sessions/" + session);
      setLoadedSession(updated);
      setMessages(updated.messages);
      setDraft("");
      if (mode === "send") setInput("");
    });
  }
  return (
    <div
      className={`app${sidebar ? " sidebar-open" : ""}${storyPanel ? " story-panel-open" : ""}`}
    >
      <header className="topbar">
        <button
          aria-label="切换作品侧栏"
          aria-expanded={sidebar}
          onClick={() => setSidebar(!sidebar)}
        >
          ☰
        </button>
        <span className="brand">
          Yuno<em>Tavern</em>
        </span>
        <span className="mode">
          {connections.selectedId === null ? "模拟模式" : "自有 API"}
        </span>
        <button
          aria-expanded={storyPanel}
          aria-controls="story-panel"
          onClick={() => setStoryPanel(!storyPanel)}
        >
          状态
        </button>
        <button onClick={() => setSettings(true)}>设置</button>
      </header>
      {sidebar && (
        <button
          className="scrim"
          aria-label="关闭侧栏"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar">
        <p className="eyebrow">你的故事书架</p>
        <button
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const created = await api<{ id: string }>("sessions", {
                prepare: true,
              });
              await refresh();
              await load(created.id);
            })
          }
        >
          ＋ 创建故事 / 导入设定
        </button>
        <Library
          characters={works}
          worlds={worlds}
          saves={saves}
          session={session}
          busy={busy}
          onRefresh={refresh}
          onLoad={(id) => void action(() => load(id))}
          onCreated={load}
          onConfigure={setSaveSettings}
          onStart={async (cardId, worldId) => {
            setBusy(true);
            try {
              const save = await api<{ id: string }>("sessions", {
                cardId,
                prepare: true,
                ...(worldId ? { worldId } : {}),
              });
              await refresh();
              await load(save.id);
            } finally {
              setBusy(false);
            }
          }}
        />
        <div className="sidebar-footer">
          <button onClick={() => setSettings(true)}>偏好与模型设置</button>
          <p>Spend tokens on storytelling.</p>
        </div>
      </aside>
      <main className={"reader" + (preparing ? "" : " reading-layout")}>
        <div
          className="reading-scroll"
          ref={readingScroll}
          onScroll={(e) => {
            const node = e.currentTarget;
            followStory.current =
              node.scrollHeight - node.clientHeight - node.scrollTop < 80;
          }}
        >
          <div className="book-heading">
            <p className="eyebrow">一部由你参与的小说</p>
            <h1>
              {[
                loadedSession?.options.storySource?.name,
                activeWorld?.world.data.name,
                work?.card.data.name,
              ]
                .filter(Boolean)
                .join(" · ") || "故事，等你翻开。"}
            </h1>
            <p className="subtitle">
              {session
                ? "慢慢读，随心继续。"
                : "选择作品，或导入你喜欢的角色。"}
            </p>
            {work &&
              !preparing &&
              !loadedSession?.options.openingState &&
              !activeWorldId &&
              session &&
              !busy &&
              messages.length <= 1 &&
              !messages.some((message) => message.role !== "assistant") &&
              greetings(work.card, activePlayer?.name).length > 1 && (
                <label className="greeting-choice">
                  开场白
                  <select
                    aria-label="选择开场白"
                    value={Math.max(
                      0,
                      greetings(work.card, activePlayer?.name).indexOf(
                        messages[0]?.content ?? "",
                      ),
                    )}
                    onChange={(event) => {
                      const index = Number(event.target.value);
                      void action(async () => {
                        const updated = await api<{ messages: Message[] }>(
                          "sessions/" + session + "/greeting",
                          { index },
                        );
                        setMessages(updated.messages);
                        setPrompt(null);
                      });
                    }}
                  >
                    {greetings(work.card, activePlayer?.name).map(
                      (text, index) => (
                        <option key={index} value={index}>
                          {index === 0 ? "默认开场" : `备选 ${index}`} ·{" "}
                          {text.slice(0, 45) || "空开场"}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {loadedSession?.draft?.raw && !busy && (
            <details className="recovered-draft">
              <summary>上次生成的未提交草稿</summary>
              <p>{loadedSession.draft.error || "开场预览草稿"}</p>
              <p className="muted">
                这段文字尚未成为剧情，不影响已有存档。可复制留存，再重试原行动。
              </p>
              <pre>{visibleStory(loadedSession.draft.raw)}</pre>
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(visibleStory(loadedSession.draft!.raw))
                    .catch(() => setError("复制失败"))
                }
              >
                复制草稿
              </button>
              {!preparing && (
                <button onClick={() => setInput(loadedSession.draft!.input)}>
                  恢复原行动到输入框
                </button>
              )}
            </details>
          )}
          {preparing && loadedSession ? (
            <OpeningPreparation
              key={session}
              session={loadedSession}
              characters={works}
              worlds={worlds}
              mock={connections.selectedId === null}
              onBusy={setBusy}
              onGuide={(draft) =>
                api("sessions/" + session + "/guide", {
                  draft,
                  config: resolveConnection(connections),
                  connectionId: connections.profiles.find(
                    (p) => p.id === connections.selectedId,
                  )?.saved
                    ? connections.selectedId
                    : undefined,
                })
              }
              onClassify={(documentId, revision) =>
                api(`documents/${documentId}/classify`, {
                  revision,
                  config: resolveConnection(connections),
                  connectionId: connections.profiles.find(
                    (p) => p.id === connections.selectedId,
                  )?.saved
                    ? connections.selectedId
                    : undefined,
                })
              }
              onStarted={async () => {
                await refresh();
                await load(session);
              }}
              modelControl={
                <ModelPicker
                  profiles={connections.profiles}
                  selectedId={connections.selectedId}
                  disabled={busy}
                  onSelect={(selectedId) =>
                    setConnections({ ...connections, selectedId })
                  }
                  onSettings={() => setSettings(true)}
                />
              }
              onGenerate={async (draft) => {
                const config = resolveConnection(connections);
                const result = await api<{ opening: string; prompt: unknown }>(
                  "sessions/" + session + "/opening",
                  {
                    draft,
                    config,
                    ...(!automaticBudget ? { budget, reserve } : {}),
                    connectionId: connections.profiles.find(
                      (p) => p.id === connections.selectedId,
                    )?.saved
                      ? connections.selectedId
                      : undefined,
                  },
                ).catch(async (error) => {
                  const latest = await api<PreparingSession>(
                    "sessions/" + session,
                  ).catch(() => null);
                  if (latest) setLoadedSession(latest);
                  throw error;
                });
                setPrompt(result.prompt);
                return result;
              }}
            />
          ) : (
            <>
              <ReadingView
                busy={busy}
                onRegenerate={() => void send("regenerate")}
                onSwipe={(messageIndex, index) =>
                  void action(async () => {
                    await api<{ messages: Message[] }>(
                      "sessions/" + session + "/swipe",
                      { messageIndex, index },
                    );
                    await load(session);
                  })
                }
                messages={messages}
                draft={draft}
                generating={generating}
                suggestionsEnabled={suggestions && !!session}
                onChoose={(text) => {
                  setInput(text);
                  document.getElementById("action-input")?.focus();
                }}
                onCopy={(text) =>
                  void navigator.clipboard
                    .writeText(text)
                    .catch(() => setError("复制失败，请选择正文手动复制"))
                }
              />
              {!messages.length && !draft && (
                <div className="empty-reading">
                  <span>一</span>
                  <p>
                    {work
                      ? "一段设定，一句开场。\n故事的方向，由你决定。"
                      : "你不必预先知道结局。\n从一个角色、一个念头开始。"}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        {!preparing && (
          <div className="composer-wrap">
            <div className="composer-preferences">
              <button
                type="button"
                className="suggestion-toggle"
                role="switch"
                aria-checked={suggestions && !!session}
                aria-label="生成行动建议"
                disabled={busy || !session}
                title={
                  session
                    ? "按当前存档保存；建议只提供灵感，可自由输入"
                    : "进入存档后可开启"
                }
                onClick={() =>
                  void action(async () => {
                    const enabled = !suggestions;
                    await api("sessions/" + session + "/preferences", {
                      suggestions: enabled,
                    });
                    setSuggestions(enabled);
                  })
                }
              >
                <span className="toggle-dot" aria-hidden="true" />
                行动建议 <span>{suggestions && session ? "开" : "关"}</span>
              </button>
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="action-input">
                你的行动
              </label>
              <textarea
                id="action-input"
                disabled={busy || !session}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  session
                    ? "你想做什么，或让故事如何继续…"
                    : "先选择作品并开始故事…"
                }
              />
              <div className="composer-footer">
                <span role="status">
                  {generating
                    ? "故事正在续写…"
                    : session
                      ? "自动保存 · 自由输入"
                      : "本地优先 · 由你掌握"}
                </span>
                <div className="composer-actions">
                  <ModelPicker
                    profiles={connections.profiles}
                    selectedId={connections.selectedId}
                    disabled={busy}
                    onSelect={(selectedId) =>
                      setConnections({ ...connections, selectedId })
                    }
                    onSettings={() => setSettings(true)}
                  />
                  {generating ? (
                    <button
                      type="button"
                      onClick={() =>
                        void api("sessions/" + session + "/stop", {}).catch(
                          () => setError("停止请求失败，请稍后重试"),
                        )
                      }
                    >
                      停止生成
                    </button>
                  ) : (
                    <button
                      className="primary send-button"
                      aria-label="继续故事"
                      title="继续故事"
                      disabled={busy || !session || !input.trim()}
                    >
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 19V5m-6 6 6-6 6 6" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </form>
            <p className="composer-hint">
              一个动作、一句对白，或任何你想尝试的方向。
            </p>
          </div>
        )}
      </main>
      {storyPanel && (
        <>
          <button
            className="story-panel-scrim"
            aria-label="关闭角色信息"
            onClick={() => setStoryPanel(false)}
          />
          <StoryPanel
            key={session}
            card={work?.card}
            story={loadedSession?.story}
            enabled={loadedSession?.options.storyTracking === true}
            busy={busy}
            director={loadedSession?.options.director}
            player={activePlayer}
            onDirector={
              session
                ? async (director) => {
                    await api("sessions/" + session + "/director", {
                      director,
                      revision: loadedSession?.options.directorRevision ?? 0,
                    });
                    await load(session);
                  }
                : undefined
            }
            onToggle={() =>
              void action(async () => {
                await api("sessions/" + session + "/options", {
                  storyTracking: !loadedSession?.options.storyTracking,
                });
                await load(session);
              })
            }
            onCorrect={async (key, value) => {
              await action(async () => {
                await api("sessions/" + session + "/story/correct", {
                  key,
                  value,
                  revision: loadedSession?.story?.revision,
                });
                await load(session);
              });
            }}
            onClose={() => setStoryPanel(false)}
          />
        </>
      )}
      {saveSettings && (
        <SaveSettings
          id={saveSettings}
          disabled={busy}
          onClose={() => setSaveSettings(null)}
          onUpdate={async (id) => {
            await refresh();
            if (id === session) await load(id);
            setSaveSettings(id);
          }}
        />
      )}
      {settings && (
        <div className="settings-backdrop" onClick={() => setSettings(false)}>
          <section
            className="settings"
            role="dialog"
            aria-modal="true"
            aria-label="阅读与模型设置"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSettings(false);
              if (e.key === "Tab") {
                const controls = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled), input:not(:disabled), summary, textarea:not(:disabled), select:not(:disabled), a[href]",
                  ),
                );
                const first = controls[0],
                  last = controls.at(-1);
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
          >
            <div className="settings-heading">
              <h2>阅读与模型</h2>
              <button
                autoFocus
                onClick={() => setSettings(false)}
                aria-label="关闭设置"
              >
                关闭
              </button>
            </div>
            <ConnectionSettings
              onSave={(p) =>
                void action(async () => {
                  const saved = await api<Connection>("connections", {
                    id: p.id,
                    name: p.name,
                    baseUrl: p.baseUrl.trim(),
                    model: p.model,
                    ...(p.apiKey ? { apiKey: p.apiKey } : {}),
                  });
                  setConnections((current) => ({
                    ...current,
                    profiles: current.profiles.map((item) =>
                      item.id === p.id
                        ? { ...saved, apiKey: "", dirty: false }
                        : item,
                    ),
                  }));
                })
              }
              onDelete={(p) =>
                void action(async () => {
                  if (p.saved) await api("connections/" + p.id + "/delete", {});
                  setConnections((current) => removeConnection(current, p.id));
                })
              }
              onClearKey={(p) =>
                void action(async () => {
                  await api("connections/" + p.id + "/clear-key", {});
                  setConnections((current) => ({
                    ...current,
                    profiles: current.profiles.map((item) =>
                      item.id === p.id
                        ? { ...item, apiKey: "", hasKey: false }
                        : item,
                    ),
                  }));
                })
              }
              value={connections}
              onChange={setConnections}
              disabled={busy}
            />
            <fieldset disabled={busy}>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={automaticBudget}
                  onChange={(e) => setAutomaticBudget(e.target.checked)}
                />
                自动管理上下文与回复预算
              </label>
              <p className="muted">
                默认按需裁剪较早聊天，存档原文不变；不额外生成记忆摘要。模型容量未知时不以估算阻止开局。回复使用
                API
                默认长度，可能影响费用；绑定预设的明确预算仍优先生效。取消勾选可手动限制。
              </p>
              {!automaticBudget && (
                <div className="budget-fields">
                  <label>
                    上下文预算
                    <input
                      type="number"
                      min="1"
                      value={budget}
                      onChange={(e) => setBudget(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    回复上限
                    <input
                      type="number"
                      min="1"
                      value={reserve}
                      onChange={(e) => setReserve(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}
            </fieldset>
            <details>
              <summary>管理世界书、预设与聊天</summary>
              <Management
                key={session}
                session={session}
                cardId={selected}
                messages={messages}
                disabled={busy}
                onUpdate={async (id) => {
                  await refresh();
                  await load(id);
                }}
              />
            </details>
            {work && (
              <details>
                <summary>作品设定与兼容性</summary>
                <a href={`/api/cards/${work.id}/export`}>导出角色卡 JSON</a>
                <p className="muted">
                  新导入作品导出原始 JSON
                  对象；旧作品导出已有存储字段，无法恢复导入时未保存的原文件格式。
                </p>
                <p>{work.card.data.description || "极简设定"}</p>
                {work.card.data.scenario && (
                  <p>初始场景：{work.card.data.scenario}</p>
                )}
                <details>
                  <summary>
                    世界书（{work.card.data.character_book?.entries.length ?? 0}
                    ）
                  </summary>
                  {work.card.data.character_book?.entries.map((entry, i) => (
                    <div className="world-entry" key={i}>
                      <h3>{entry.keys.join(" · ") || `条目 ${i + 1}`}</h3>
                      <small>
                        {!entry.enabled
                          ? "已停用"
                          : entry.constant
                            ? "常驻上下文"
                            : "关键词触发"}
                      </small>
                      <p>{entry.content}</p>
                    </div>
                  ))}
                </details>
                <p>
                  角色卡可在左侧角色卡列表中展开后编辑；世界书可在左侧世界书列表或独立世界书管理入口编辑。
                </p>
                <ul>
                  {work.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
            <details>
              <summary>开发调试 · Prompt Inspector</summary>
              <p>实际请求上下文与估算预算。</p>
              <button
                disabled={!session || busy}
                onClick={() =>
                  void action(async () =>
                    setUsage(await api("sessions/" + session + "/usage")),
                  )
                }
              >
                读取本存档调用用量
              </button>
              <p className="muted">
                包含失败调用；null
                表示供应商未报告，不能当作零费用。模拟用量为零。
              </p>
              {usage !== null && <pre>{JSON.stringify(usage, null, 2)}</pre>}
              <pre>
                {prompt ? JSON.stringify(prompt, null, 2) : "发送一轮后显示。"}
              </pre>
            </details>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
