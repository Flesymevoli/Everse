import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Card } from "../server/cards";
import type { Message } from "../server/context";
import "./style.css";
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
    const s = await api<Save & { messages: Message[] }>("sessions/" + id);
    setSession(id);
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
    }
  }
  async function send() {
    await action(async () => {
      setDraft("");
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
    <>
      <header>
        <h1>Narrative Slice</h1>
        <p>把 Token 花在故事上。</p>
      </header>
      <div className="layout">
        <aside>
          <h2>作品库</h2>
          <label className="import">
            导入 V2 / V3 JSON
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
                  });
                e.target.value = "";
              }}
            />
          </label>
          {works.length === 0 && (
            <p>先导入一张角色卡开始。可用 examples 下的示例。</p>
          )}
          {works.map((w) => (
            <button
              disabled={busy}
              aria-pressed={selected === w.id}
              key={w.id}
              onClick={() => {
                setSelected(w.id);
                setSession("");
                setMessages([]);
                setPrompt(null);
              }}
            >
              {w.card.data.name}
            </button>
          ))}
          <h2>本地存档</h2>
          {saves.length === 0 && <p>创建游戏后自动保存。</p>}
          {saves.map((s, i) => (
            <button
              disabled={busy}
              aria-pressed={session === s.id}
              key={s.id}
              onClick={() => void action(() => load(s.id))}
            >
              {works.find((w) => w.id === s.cardId)?.card.data.name ?? "作品"} ·{" "}
              {i + 1}
            </button>
          ))}
        </aside>
        <main>
          <details>
            <summary>
              API 设置 · {config.mock ? "模拟模式" : "自有 API"}
            </summary>
            <fieldset disabled={busy}>
              <label>
                <input
                  type="checkbox"
                  checked={config.mock}
                  onChange={(e) =>
                    setConfig({ ...config, mock: e.target.checked })
                  }
                />
                使用免费模拟回复
              </label>
              {(["baseUrl", "model", "apiKey"] as const).map((key) => (
                <label key={key}>
                  {
                    {
                      baseUrl: "Base URL（包含 /v1）",
                      model: "模型 ID",
                      apiKey: "API Key（仅本页内存）",
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
                回复 Token 上限
                <input
                  type="number"
                  min="64"
                  max="8192"
                  value={reserve}
                  onChange={(e) => setReserve(Number(e.target.value))}
                />
              </label>
            </fieldset>
          </details>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {work ? (
            <>
              <h2>{work.card.data.name}</h2>
              <details>
                <summary>作品信息与兼容提示</summary>
                <p>{work.card.data.description}</p>
                <ul>
                  {work.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const s = await api<{ id: string }>("sessions", {
                      cardId: selected,
                    });
                    await refresh();
                    await load(s.id);
                  })
                }
              >
                创建新游戏
              </button>
            </>
          ) : (
            <h2>选择一个作品</h2>
          )}
          <section aria-label="聊天记录">
            {messages.map((m, i) => (
              <article key={i}>
                <strong>
                  {m.role === "user" ? "玩家" : work?.card.data.name}
                </strong>
                <p>{m.content}</p>
              </article>
            ))}
            {draft && (
              <article className="draft">
                <strong>生成中 · 尚未保存</strong>
                <p>{draft}</p>
              </article>
            )}
          </section>
          <p role="status">
            {busy
              ? "正在处理…"
              : session
                ? "完整回合自动保存在本机"
                : "选择作品并创建游戏，或继续已有存档"}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label>
              你的行动
              <textarea
                disabled={busy || !session}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="接下来，你想做什么？"
              />
            </label>
            <button disabled={busy || !session || !input.trim()}>发送</button>
          </form>
          <details>
            <summary>Prompt Inspector</summary>
            <p>
              最近一次实际请求的上下文。预算为保守估算；裁剪不会删除存档原文。
            </p>
            <pre>
              {prompt
                ? JSON.stringify(prompt, null, 2)
                : "发送一条消息后显示。"}
            </pre>
          </details>
        </main>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
