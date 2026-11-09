import { characterGroups } from "../shared/character-panel";
import type { Card } from "../server/cards";
import { useState } from "react";
import type { StoryView, SourcedFact } from "../shared/story";
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
  const [worldNote, setWorldNote] = useState("");
  const [guide, setGuide] = useState<Director | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const fields = [
    ["characters", "人物设定"],
    ["playerState", "人物状态与背包"],
    ["world", "世界观修订"],
    ["direction", "剧情走向"],
  ] as const;
  const groups = characterGroups(story?.facts ?? []);
  const renderFact = (fact: SourcedFact) => (
    <section className="character-section" key={fact.key}>
      <h3>
        {fact.panel?.label ??
          (fact.key.startsWith("edit:") ? "正文修订" : fact.key)}
      </h3>
      <p>{fact.value}</p>
      <details className="fact-actions">
        <summary>依据与修正</summary>
        <small>
          {fact.corrected
            ? "玩家修正 · 优先保留"
            : `来源：第 ${fact.source + 1} 条剧情 · ${kindNames[fact.kind]}`}
        </small>
        <p>{fact.evidence}</p>
        {editing === fact.key ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              setError("");
              void onCorrect(fact.key, value)
                .then(() => setEditing(null))
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "保存失败"),
                )
                .finally(() => setSaving(false));
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
            <button disabled={busy || saving || !value.trim()}>保存修正</button>
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
            onClick={() =>
              void onCorrect(fact.key, null).catch((e) =>
                setError(e instanceof Error ? e.message : "撤销失败"),
              )
            }
          >
            撤销修正
          </button>
        )}
      </details>
    </section>
  );
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
        <span className="eyebrow">角色与状态</span>
        <button onClick={onClose} aria-label="收起角色信息">
          ×
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {card ? (
        <>
          <section className="story-overview">
            <span className="story-monogram" aria-hidden="true">
              {Array.from(card.data.name)[0]}
            </span>
            <h2>{card.data.name}</h2>
          </section>
          <details>
            <summary>人物简介</summary>
            <p>{card.data.description || "未填写人物描述。"}</p>
            {card.data.personality && <p>{card.data.personality}</p>}
          </details>
        </>
      ) : !groups.characters.length ? (
        <div className="panel-empty">
          <h2>{player?.name || "角色信息"}</h2>
          {!groups.characters.length && (
            <p>人物与物品将在剧情中逐步出现；不预设固定游戏属性。</p>
          )}
        </div>
      ) : null}
      {player && (player.name || player.description) && (
        <section>
          <h3>{player.name || "玩家身份"}</h3>
          <p>{player.description}</p>
        </section>
      )}
      {groups.characters.map((group) => (
        <section
          className="dynamic-character"
          key={group.name}
          aria-label={group.name + "角色档案"}
        >
          <h2>{group.name}</h2>
          <div className="character-attributes">
            {group.attributes.map(renderFact)}
          </div>
          {group.inventory.length > 0 && (
            <section aria-label={group.name + "背包"}>
              <h3 className="inventory-heading">
                <img src="/figma/inventory.svg" alt="" />
                随身物品<span>{group.inventory.length} 项</span>
              </h3>
              {group.inventory.map(renderFact)}
            </section>
          )}
        </section>
      ))}
      <details className="world-guide-details">
        <summary>设定与剧情引导</summary>
        {onDirector && (
          <form
            className="world-note"
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              setError("");
              void onDirector({
                ...directorSchema.parse(director ?? {}),
                world: [director?.world, worldNote.trim()]
                  .filter(Boolean)
                  .join("\n\n"),
              })
                .then(() => setWorldNote(""))
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "保存失败"),
                )
                .finally(() => setSaving(false));
            }}
          >
            <label>
              补充世界设定
              <textarea
                value={worldNote}
                maxLength={10000}
                placeholder="写下希望持续保留的设定…"
                onChange={(e) => setWorldNote(e.target.value)}
              />
            </label>
            <button
              disabled={
                busy ||
                saving ||
                !worldNote.trim() ||
                (director?.world.length ?? 0) + worldNote.trim().length + 2 >
                  10000
              }
            >
              记为世界设定
            </button>
            <small>保存到当前存档，下一轮生效；不调用模型。</small>
          </form>
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
      </details>
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
          <details className="history-facts">
            <summary>世界背景与历史记录（{groups.other.length}）</summary>
            {groups.other.map(renderFact)}
          </details>
        </>
      )}
    </aside>
  );
}
