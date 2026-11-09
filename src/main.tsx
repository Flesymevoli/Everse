import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Card } from "../server/cards";
import { greetings } from "../shared/character-text";
import type { Message } from "../server/context";
import "./style.css";
import { ModelPicker } from "./ModelPicker";
import { ReadingView } from "./ReadingView";
import { StoryPanel } from "./StoryPanel";
import { Management } from "./Management";
type Work = { id: string; card: Card; warnings: string[] };
type Save = {
  id: string;
  cardId: string;
  options?: { name?: string; archived?: boolean };
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
  const [storyPanel, setStoryPanel] = useState(
    () => window.matchMedia("(min-width: 1120px)").matches,
  );
  const [sidebar, setSidebar] = useState(false),
    [settings, setSettings] = useState(false),
    [suggestions, setSuggestions] = useState(false),
    [generating, setGenerating] = useState(false);
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
  const [config, setConfig] = useState({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "your-model-id",
    mock: true,
  });
  const [budget, setBudget] = useState(8192),
    [reserve, setReserve] = useState(1024);
  const work = works.find((w) => w.id === selected);
  async function refresh() {
    const [w, s] = await Promise.all([
      api<Work[]>("cards"),
      api<Save[]>("sessions"),
    ]);
    setWorks(w);
    setSaves(s);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, []);
  async function load(id: string) {
    const s = await api<Save & { messages: Message[]; suggestions: boolean }>(
      "sessions/" + id,
    );
    setSession(id);
    setSuggestions(s.suggestions);
    setSidebar(false);
    setSelected(s.cardId);
    setMessages(s.messages);
    setPrompt(null);
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
      setDraft("");
      setGenerating(true);
      const r = await fetch("/api/sessions/" + session + "/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, config, budget, reserve, mode }),
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
      const updated = await api<{ messages: Message[] }>("sessions/" + session);
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
          Narrative <em>Slice</em>
        </span>
        <span className="mode">{config.mock ? "模拟模式" : "自有 API"}</span>
        <button
          aria-expanded={storyPanel}
          aria-controls="story-panel"
          onClick={() => setStoryPanel(!storyPanel)}
        >
          角色
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
        <h2>作品</h2>
        <label className="import">
          ＋ 导入作品
          <input
            disabled={busy}
            type="file"
            accept=".json,.png,application/json,image/png"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void action(async () => {
                  if (file.size > 2000000) throw new Error("文件上限 2 MB");
                  let result: Work;
                  if (file.name.toLowerCase().endsWith(".png")) {
                    const response = await fetch("/api/cards", {
                      method: "POST",
                      headers: { "Content-Type": "image/png" },
                      body: file,
                    });
                    const data = await response.json();
                    if (!response.ok)
                      throw new Error(data.error ?? "PNG 导入失败");
                    result = data as Work;
                  } else
                    result = await api<Work>(
                      "cards",
                      JSON.parse(await file.text()),
                    );
                  await refresh();
                  setSelected(result.id);
                  setSession("");
                  setMessages([]);
                  setDraft("");
                  setSidebar(false);
                });
              e.target.value = "";
            }}
          />
        </label>
        {works.map((w) => (
          <details className="work-group" key={w.id}>
            <summary>
              {w.card.data.name}
              <span className="save-count">
                {saves.filter((save) => save.cardId === w.id).length}
              </span>
            </summary>
            <div className="work-saves">
              {saves.map(
                (save, i) =>
                  save.cardId === w.id && (
                    <button
                      className="shelf-item"
                      key={save.id}
                      disabled={busy}
                      aria-pressed={session === save.id}
                      onClick={() => void action(() => load(save.id))}
                    >
                      {save.options?.name ??
                        "存档 " + String(i + 1).padStart(2, "0")}
                      {save.options?.archived ? " · 已归档" : ""}
                    </button>
                  ),
              )}
              {!saves.some((save) => save.cardId === w.id) && (
                <p className="muted">还没有存档，开始第一段故事吧。</p>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const save = await api<{ id: string }>("sessions", {
                      cardId: w.id,
                    });
                    await refresh();
                    await load(save.id);
                  })
                }
              >
                ＋ 新建存档
              </button>
            </div>
          </details>
        ))}
        {!works.length && (
          <p className="muted">导入一张 JSON 角色卡，让故事从这里开始。</p>
        )}
        <div className="sidebar-footer">
          <button onClick={() => setSettings(true)}>偏好与模型设置</button>
          <p>Spend tokens on storytelling.</p>
        </div>
      </aside>
      <main className="reader">
        <div className="book-heading">
          <p className="eyebrow">一部由你参与的小说</p>
          <h1>{work?.card.data.name ?? "故事，等你翻开。"}</h1>
          <p className="subtitle">
            {session ? "慢慢读，随心继续。" : "选择作品，或导入你喜欢的角色。"}
          </p>
          {work && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const save = await api<{ id: string }>("sessions", {
                    cardId: selected,
                  });
                  await refresh();
                  await load(save.id);
                })
              }
            >
              另起一段故事 ↗
            </button>
          )}
          {work &&
            session &&
            !busy &&
            messages.length <= 1 &&
            !messages.some((message) => message.role !== "assistant") &&
            greetings(work.card).length > 1 && (
              <label className="greeting-choice">
                开场白
                <select
                  aria-label="选择开场白"
                  value={Math.max(
                    0,
                    greetings(work.card).indexOf(messages[0]?.content ?? ""),
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
                  {greetings(work.card).map((text, index) => (
                    <option key={index} value={index}>
                      {index === 0 ? "默认开场" : `备选 ${index}`} ·{" "}
                      {text.slice(0, 45) || "空开场"}
                    </option>
                  ))}
                </select>
              </label>
            )}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <ReadingView
          busy={busy}
          onRegenerate={() => void send("regenerate")}
          onSwipe={(messageIndex, index) =>
            void action(async () => {
              const updated = await api<{ messages: Message[] }>(
                "sessions/" + session + "/swipe",
                { messageIndex, index },
              );
              setMessages(updated.messages);
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
                  model={config.model}
                  mock={config.mock}
                  disabled={busy}
                  onSelect={(mock) => setConfig({ ...config, mock })}
                  onSettings={() => setSettings(true)}
                />
                {generating ? (
                  <button
                    type="button"
                    onClick={() =>
                      void api("sessions/" + session + "/stop", {}).catch(() =>
                        setError("停止请求失败，请稍后重试"),
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
      </main>
      {storyPanel && (
        <>
          <button
            className="story-panel-scrim"
            aria-label="关闭角色信息"
            onClick={() => setStoryPanel(false)}
          />
          <StoryPanel card={work?.card} onClose={() => setStoryPanel(false)} />
        </>
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
            <fieldset disabled={busy}>
              <h3>API 与模型</h3>
              <label className="toggle-row">
                使用免费模拟回复
                <input
                  type="checkbox"
                  checked={config.mock}
                  onChange={(e) =>
                    setConfig({ ...config, mock: e.target.checked })
                  }
                />
              </label>
              {(["baseUrl", "model", "apiKey"] as const).map((key) => (
                <label key={key}>
                  {
                    {
                      baseUrl: "Base URL（包含 /v1）",
                      model: "模型 ID",
                      apiKey: "API Key · 仅本页内存",
                    }[key]
                  }
                  <input
                    type={key === "apiKey" ? "password" : "text"}
                    autoComplete="off"
                    value={config[key]}
                    onChange={(e) =>
                      setConfig({ ...config, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <div className="budget-fields">
                <label>
                  上下文预算
                  <input
                    type="number"
                    min="2048"
                    max="128000"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                  />
                </label>
                <label>
                  回复上限
                  <input
                    type="number"
                    min="64"
                    max="8192"
                    value={reserve}
                    onChange={(e) => setReserve(Number(e.target.value))}
                  />
                </label>
              </div>
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
                  角色卡和世界书编辑器尚待实现，可修改原 JSON 后导入为新作品。
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
