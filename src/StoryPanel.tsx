import type { Card } from "../server/cards";
import { useState } from "react";
import type { StoryView } from "../shared/story";
import { directorSchema, type Director } from "../shared/director";
const kindNames = {
  scene: "场景",
  person: "人物",
  goal: "目标",
  fact: "事实",
  event: "事件",
};

type Props = {
  card?: Card;
  story?: StoryView;
  enabled: boolean;
  busy: boolean;
  director?: Director;
  player?: { name: string; description: string };
  onDirector?: (value: Director) => Promise<void>;
  onToggle: () => void;
  onCorrect: (key: string, value: string | null) => Promise<void>;
  onClose: () => void;
};

export function StoryPanel({
  card,
  story,
  enabled,
  busy,
  director,
  player,
  onDirector,
  onToggle,
  onCorrect,
  onClose,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [guide, setGuide] = useState<Director | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const fields = [
    ["characters", "人物设定"],
    ["playerState", "人物状态与背包"],
    ["world", "世界观修订"],
    ["direction", "剧情走向"],
  ] as const;
  return (
    <aside
      className="story-panel"
      id="story-panel"
      aria-label="故事状态"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="panel-heading">
        <span className="eyebrow">故事状态</span>
        <button onClick={onClose} aria-label="收起角色信息">
          ×
        </button>
      </div>
      {card ? (
        <>
          <section className="story-overview">
            <span className="story-monogram" aria-hidden="true">
              {Array.from(card.data.name)[0]}
            </span>
            <h2>{card.data.name}</h2>
          </section>
          <details open>
            <summary>人物简介</summary>
            <p>{card.data.description || "未填写人物描述。"}</p>
            {card.data.personality && <p>{card.data.personality}</p>}
          </details>
        </>
      ) : (
        <div className="panel-empty">
          <h2>故事正在展开</h2>
          <p>不必创建角色卡，也可以维护故事中的人物与线索。</p>
        </div>
      )}
      {player && (player.name || player.description) && (
        <section>
          <h3>{player.name || "玩家身份"}</h3>
          <p>{player.description}</p>
        </section>
      )}
      {fields.map(
        ([key, label]) =>
          director?.[key] && (
            <section className="character-section" key={key}>
              <h3>{label}</h3>
              <p>{director[key]}</p>
              <small>当前存档的玩家引导 · 下一轮优先采用</small>
            </section>
          ),
      )}
      {onDirector && (
        <section className="director-editor">
          {!guide ? (
            <button
              disabled={busy}
              onClick={() => {
                setGuide(directorSchema.parse(director ?? {}));
                setError("");
              }}
            >
              调整人物与故事引导
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSaving(true);
                setError("");
                void onDirector(guide)
                  .then(() => setGuide(null))
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : "保存失败"),
                  )
                  .finally(() => setSaving(false));
              }}
            >
              <fieldset disabled={busy || saving}>
                <p className="muted">
                  可随时修改，留空表示不额外干预。仅影响本存档下一轮，不改写已有剧情和原作品；剧情走向不作为已发生的事实。
                </p>
                {fields.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <textarea
                      aria-label={label}
                      maxLength={10000}
                      value={guide[key]}
                      onChange={(e) =>
                        setGuide({ ...guide, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <button type="submit">保存故事引导</button>
                <button type="button" onClick={() => setGuide(null)}>
                  取消
                </button>
              </fieldset>
            </form>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </section>
      )}
      {story && (
        <>
          <button
            disabled={busy}
            role="switch"
            aria-checked={enabled}
            onClick={onToggle}
          >
            故事记忆 {enabled ? "开" : "关"}
          </button>
          <p className="muted">
            同一次生成记录有原文依据的变化，不额外调用模型。记录仍可能有误，可随时纠正。
          </p>
          {story.invalidated > 0 && (
            <p role="status">
              剧情曾被修改，{story.invalidated} 条派生记录已失效，不再用于生成。
            </p>
          )}
          {!story.facts.length && (
            <p>
              尚无状态记录。手写或旧开场不会自动付费分析；开启后从下一轮开始记录。
            </p>
          )}
          {story.facts.map((fact) => (
            <section className="character-section" key={fact.key}>
              <h3>{fact.key.startsWith("edit:")?"正文编辑 · 事实修订":fact.key}</h3>
              <p>{fact.value}</p>
              <small>
                {fact.corrected
                  ? "玩家修正 · 优先保留"
                  : `来源：第 ${fact.source + 1} 条剧情 · ${kindNames[fact.kind]}`}
              </small>
              <details>
                <summary>查看依据</summary>
                <p>{fact.evidence}</p>
              </details>
              {editing === fact.key ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onCorrect(fact.key, value).then(() =>
                      setEditing(null),
                    );
                  }}
                >
                  <label>
                    修正内容
                    <textarea
                      aria-label="修正内容"
                      maxLength={600}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </label>
                  <button disabled={busy || !value.trim()}>保存修正</button>
                  <button type="button" onClick={() => setEditing(null)}>
                    取消
                  </button>
                </form>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditing(fact.key);
                    setValue(fact.value);
                  }}
                >
                  修正
                </button>
              )}
              {fact.corrected && (
                <button
                  disabled={busy}
                  onClick={() => void onCorrect(fact.key, null)}
                >
                  撤销修正
                </button>
              )}
            </section>
          ))}
        </>
      )}
    </aside>
  );
}
