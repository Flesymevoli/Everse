import { requestJson as api, readJson, fetchLocal } from "./response";

import { textDiff } from "./text-editing";
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
import "./figma-layout.css";
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
import { TextEditor } from "./TextEditor";
import type { TextSelection } from "../shared/text-edit";
import { visibleStory } from "../shared/story";
type Work = { id: string; card: Card; warnings: string[] };
type Save = {
  id: string;
  cardId: string;
  options?: { name?: string; archived?: boolean; worldId?: string | null };
};

function App() {
  const [textEdit, setTextEdit] = useState<{
    selection: TextSelection;
    message: string;
    restore?: boolean;
    replacement?: string;
  } | null>(null);
  const [editExpanded, setEditExpanded] = useState(false);
  const [editPreview, setEditPreview] = useState<string | null>(null);
  const [editedMark, setEditedMark] = useState<{
    session: string;
    index: number;
    start: number;
    end: number;
    content: string;
  } | null>(null);
  const [saveSettings, setSaveSettings] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
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
      (loadedSession.options.openingState !== "started" &&
        loadedSession.messages.length === 0));
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
  const storyTitle =
    loadedSession?.options.storySource?.name ||
    activeWorld?.world.data.name ||
    work?.card.data.name ||
    "我的故事";
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
  const loadVersion = useRef(0);
  async function load(id: string) {
    const version = ++loadVersion.current;
    let s: PreparingSession & { suggestions: boolean };
    try {
      s = await api<PreparingSession & { suggestions: boolean }>(
        "sessions/" + id,
      );
    } catch (error) {
      if (version !== loadVersion.current) return;
      throw error;
    }
    if (version !== loadVersion.current) return;
    setLoadedSession(s);
    setTextEdit(null);
    setEditPreview(null);
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
  async function send(
    mode: "send" | "regenerate" = "send",
    initialInput?: string,
  ) {
    await action(async () => {
      const config = resolveConnection(connections);
      setDraft("");
      setGenerating(true);
      const r = await fetchLocal("/api/sessions/" + session + "/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          input: initialInput ?? input,
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
      if (!r.ok) await readJson(r);
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
        <span className="reader-breadcrumb">
          <img src="/figma/breadcrumb.svg" alt="" />
          故事 / {session ? storyTitle : "书架"}
        </span>
        <span
          className={
            "mode" + (session && !busy && !error ? " saved-status" : "")
          }
          role="status"
        >
          {busy
            ? "正在处理…"
            : error
              ? "需要处理"
              : session
                ? "存档已载入"
                : "本地优先"}
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
        <div className="library-brand">
          <span className="brand">
            Ever<em>se</em>
          </span>
          <button
            aria-label="收起作品侧栏"
            onClick={() => setSidebar(!sidebar)}
          >
            <img src="/figma/collapse.svg" alt="" />
          </button>
        </div>
        <p className="eyebrow">YOUR LIBRARY</p>
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
          <img className="figma-icon" src="/figma/plus.svg" alt="" /> 新建故事 /
          导入设定
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
          onDelete={async (id) => {
            setBusy(true);
            try {
              await api("sessions/" + id + "/delete", { confirm: true });
              if (session === id) {
                ++loadVersion.current;
                setSession("");
                setLoadedSession(null);
                setSelected("");
                setActiveWorldId(null);
                setMessages([]);
                setInput("");
                setDraft("");
                setPrompt(null);
                setUsage(null);
                setTextEdit(null);
                setEditPreview(null);
                setSaveSettings(null);
              }
              setSaves((current) => current.filter((s) => s.id !== id));
              setNotice("存档已删除，其他存档和作品设定不受影响。");
            } finally {
              setBusy(false);
            }
          }}
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
          <button onClick={() => setSettings(true)}>
            <img src="/figma/settings.svg" alt="" />
            预设与模型设置
          </button>
          <div className="local-profile">
            <span aria-hidden="true">我</span>
            <p>
              本地玩家<small>仅保存在此设备</small>
            </p>
          </div>
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
          {notice && (
            <p role="status" className="muted">
              {notice}
              <button aria-label="关闭提示" onClick={() => setNotice("")}>
                ×
              </button>
            </p>
          )}
          <div
            className={
              "book-heading" + (session ? " active-story-heading" : "")
            }
          >
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
              mock={false}
              onBusy={setBusy}
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
            />
          ) : (
            <>
              <ReadingView
                editSelection={textEdit?.selection}
                editPreview={editPreview}
                highlight={editedMark?.session === session ? editedMark : null}
                onEdit={(selection) => {
                  setEditExpanded(false);
                  setEditPreview(null);
                  if (loadedSession?.editRevision)
                    setTextEdit({
                      selection: {
                        ...selection,
                        revision: loadedSession.editRevision,
                      },
                      message: messages[selection.index].content,
                    });
                }}
                onUndo={() =>
                  void action(async () => {
                    const preview = await api<{
                      index: number;
                      before: string;
                      after: string;
                      revision: string;
                    }>(`sessions/${session}/edit-undo-preview`);
                    setEditExpanded(true);
                    setTextEdit({
                      selection: {
                        index: preview.index,
                        start: 0,
                        end: preview.before.length,
                        original: preview.before,
                        revision: preview.revision,
                      },
                      message: preview.before,
                      restore: true,
                      replacement: preview.after,
                    });
                  })
                }
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
                    {session
                      ? "设定已就绪。按作品要求开始，或在下方直接介绍你的身份。"
                      : work
                        ? "一段设定，一句开场。\n故事的方向，由你决定。"
                        : "你不必预先知道结局。\n从一个角色、一个念头开始。"}
                  </p>
                  {session && (
                    <>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void send(
                            "send",
                            "请按照作品设定开始；若设定包含角色创建或初始化流程，请先引导我，我会直接用文字回复。",
                          )
                        }
                      >
                        按设定开始
                      </button>
                      <small className="muted">
                        使用下方选中的模型生成，可能产生费用。
                      </small>
                    </>
                  )}
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
              setBusy(true);
              try {
                await api("sessions/" + session + "/story/correct", {
                  key,
                  value,
                  revision: loadedSession?.story?.revision,
                });
                await load(session);
              } finally {
                setBusy(false);
              }
            }}
            onClose={() => setStoryPanel(false)}
          />
        </>
      )}
      {textEdit && (
        <TextEditor
          key={`${session}:${textEdit.selection.index}:${textEdit.selection.start}:${textEdit.restore}`}
          expanded={editExpanded}
          onExpand={() => setEditExpanded(true)}
          onPreview={setEditPreview}
          selection={textEdit.selection}
          message={textEdit.message}
          restore={textEdit.restore}
          initialReplacement={textEdit.replacement}
          mock={false}
          onClose={() => {
            setTextEdit(null);
            setEditPreview(null);
          }}
          onStop={() => api(`sessions/${session}/stop`, {})}
          onGenerate={async (instruction) => {
            setBusy(true);
            try {
              return await api(`sessions/${session}/rewrite-preview`, {
                selection: textEdit.selection,
                instruction,
                config: resolveConnection(connections),
                ...(!automaticBudget ? { budget, reserve } : {}),
                connectionId: connections.profiles.find(
                  (p) => p.id === connections.selectedId,
                )?.saved
                  ? connections.selectedId
                  : undefined,
              });
            } finally {
              setBusy(false);
            }
          }}
          onSave={async (replacement, syncSettings) => {
            await api(
              `sessions/${session}/${textEdit.restore ? "undo" : "edit-selection"}`,
              textEdit.restore
                ? { revision: textEdit.selection.revision }
                : { selection: textEdit.selection, replacement, syncSettings },
            );
            const diff = textDiff(textEdit.selection.original, replacement);
            setEditedMark(
              textEdit.restore
                ? null
                : {
                    session,
                    index: textEdit.selection.index,
                    start: textEdit.selection.start + diff.prefix.length,
                    end:
                      textEdit.selection.start +
                      diff.prefix.length +
                      diff.added.length,
                    content:
                      textEdit.message.slice(0, textEdit.selection.start) +
                      replacement +
                      textEdit.message.slice(textEdit.selection.end),
                  },
            );
            await load(session);
            setTextEdit(null);
            setEditPreview(null);
            setNotice(
              textEdit.restore
                ? "已恢复编辑前版本，相应状态按来源恢复。"
                : "已替换选区，原版本已备份；可预览并恢复最近编辑。请核对涉及的后续剧情与世界引导。",
            );
          }}
        />
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
                包含失败调用；null 表示供应商未报告，不能当作零费用。
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
