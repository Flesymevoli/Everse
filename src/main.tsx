import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Card } from "../server/cards";
import type { Message } from "../server/context";
import "./style.css";
import { ReadingView } from "./ReadingView";
type Work = { id: string; card: Card; warnings: string[] };
type Save = { id: string; cardId: string };
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
  async function send() {
    await action(async () => {
      setDraft("");
      setGenerating(true);
      const r = await fetch("/api/sessions/" + session + "/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, config, budget, reserve }),
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
      setInput("");
    });
  }
  return (
    <div className={sidebar ? "app sidebar-open" : "app"}>
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
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void action(async () => {
                  if (file.size > 2000000) throw new Error("文件上限 2 MB");
                  const result = await api<Work>(
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
          <button
            key={w.id}
            className="shelf-item"
            disabled={busy}
            aria-pressed={selected === w.id}
            onClick={() => {
              setSelected(w.id);
              setSession("");
              setMessages([]);
              setDraft("");
              setPrompt(null);
              setSidebar(false);
            }}
          >
            {w.card.data.name}
          </button>
        ))}
        {!works.length && (
          <p className="muted">导入一张 JSON 角色卡，让故事从这里开始。</p>
        )}
        <h2 className="saves-title">继续阅读</h2>
        {saves.map((save, i) => (
          <button
            className="shelf-item"
            key={save.id}
            disabled={busy}
            aria-pressed={session === save.id}
            onClick={() => void action(() => load(save.id))}
          >
            {works.find((w) => w.id === save.cardId)?.card.data.name ?? "作品"}
            <small>存档 {String(i + 1).padStart(2, "0")}</small>
          </button>
        ))}
        {!saves.length && <p className="muted">每一段故事，都会留在本机。</p>}
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
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <ReadingView
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
                  className="primary"
                  disabled={busy || !session || !input.trim()}
                >
                  继续故事 ↑
                </button>
              )}
            </div>
          </form>
          <p className="composer-hint">
            一个动作、一句对白，或任何你想尝试的方向。
          </p>
        </div>
      </main>
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
                    "button:not(:disabled), input:not(:disabled), summary, textarea:not(:disabled)",
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
              <h3>游戏偏好</h3>
              <label className="toggle-row">
                <span>
                  生成行动建议
                  <small>提供灵感，始终允许自由输入。按当前存档保存。</small>
                </span>
                <input
                  disabled={!session}
                  type="checkbox"
                  checked={suggestions && !!session}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    void action(async () => {
                      await api("sessions/" + session + "/preferences", {
                        suggestions: enabled,
                      });
                      setSuggestions(enabled);
                    });
                  }}
                />
              </label>
              {!session && (
                <p className="muted">进入一个存档后可设置行动建议。</p>
              )}
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
            {work && (
              <details>
                <summary>作品设定与兼容性</summary>
                <p>{work.card.data.description || "极简设定"}</p>
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
