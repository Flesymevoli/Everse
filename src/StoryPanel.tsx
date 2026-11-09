import type { Card } from "../server/cards";
import { useState } from "react";
import type { StoryView } from "../shared/story";
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
  onToggle: () => void;
  onCorrect: (key: string, value: string | null) => Promise<void>;
  onClose: () => void;
};

export function StoryPanel({
  card,
  story,
  enabled,
  busy,
  onToggle,
  onCorrect,
  onClose,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
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
              <h3>{fact.key}</h3>
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
