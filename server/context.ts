import { expand as expandText, type Card } from "./cards.js";
import { evaluateBook } from "./worldbook.js";
import { presetSchema } from "./preset.js";
export interface Message {
  story?: import("../shared/story.js").StoryPatch;
  variants?: {
    story?: import("../shared/story.js").StoryPatch;
    content: string;
    raw?: string;
    suggestions?: string[];
    st?: Record<string, unknown>;
  }[];
  selectedVariant?: number;
  st?: Record<string, unknown>;
  role: "system" | "user" | "assistant";
  content: string;
  suggestions?: string[];
  raw?: string;
}
export function buildContext(
  card: Card,
  history: Message[],
  input: string,
  budget = 8192,
  reserve = 1024,
  options: {
    player?: import("../shared/player.js").Player;
    worldDescription?: string;
    cardWorldbook?: unknown;
    worldbook?: unknown;
    preset?: unknown;
    scanDepth?: number;
    recursive?: boolean;
    maxRecursionSteps?: number;
    preferCharacterPrompt?: boolean;
    preferCharacterInstructions?: boolean;
    extraInstruction?: string;
    automaticBudget?: boolean;
  } = {},
) {
  const expand = (text: string, name: string) =>
    expandText(text, name, options.player?.name);
  const data = card.data;
  const world = options.worldbook
    ? evaluateBook(options.worldbook, history, input, options.scanDepth, {
        ...options,
        expand: (text) => expand(text, data.name),
      })
    : {
        before: [],
        after: [],
        matched: [],
        injections: [],
        failedProbability: [],
      };
  if (options.cardWorldbook) {
    const additional = evaluateBook(
      options.cardWorldbook,
      history,
      input,
      options.scanDepth,
      { ...options, expand: (text) => expand(text, data.name) },
    );
    world.before.push(...additional.before);
    world.after.push(...additional.after);
    world.injections.push(...additional.injections);
    world.matched.push(...additional.matched.map((id) => "world:" + id));
    world.failedProbability.push(
      ...additional.failedProbability.map((id) => "world:" + id),
    );
  }
  const scan = [...history.slice(-6).map((m) => m.content), input].join("\n");
  const entries = (data.character_book?.entries ?? []).filter(
    (e) =>
      e.enabled &&
      (e.constant ||
        e.keys.some(
          (k) =>
            k.length > 0 &&
            (e.case_sensitive
              ? scan.includes(k)
              : scan.toLowerCase().includes(k.toLowerCase())),
        )),
  );
  const text = [
    data.system_prompt,
    ...world.before,
    data.description,
    data.personality,
    data.scenario,
    ...entries.map((e) => e.content),
    ...world.after,
  ]
    .filter(Boolean)
    .join("\n\n");
  const system: Message = { role: "system", content: expand(text, data.name) };
  const tail: Message[] = [{ role: "user", content: input }];
  if (data.post_history_instructions)
    tail.push({
      role: "system",
      content: expand(data.post_history_instructions, data.name),
    });
  const recent = history.map((m) => ({
    role: m.role,
    content: expand(m.content, data.name),
  }));
  const preset = options.preset
    ? presetSchema.parse(options.preset)
    : undefined;
  const assemble = (recent: Message[]): Message[] => {
    const chat: Message[] = [...recent, { role: "user", content: input }];
    const injected: Message[] = [];
    for (let boundary = 0; boundary <= chat.length; boundary++) {
      // Depth is measured against chat messages, never against other injected entries.
      for (const entry of world.injections.filter(
        (entry) => Math.max(0, chat.length - entry.depth) === boundary,
      ))
        injected.push({
          role: entry.role,
          content: expand(entry.content, data.name),
        });
      if (boundary < chat.length) injected.push(chat[boundary]);
    }
    const identity: Message[] =
      options.player && (options.player.name || options.player.description)
        ? [
            {
              role: "system",
              content: `玩家身份（用户扮演）：${options.player.name || "玩家"}\n${options.player.description}`,
            },
          ]
        : [];
    const worldDescription: Message[] = options.worldDescription
      ? [
          {
            role: "system",
            content: expand(options.worldDescription, data.name),
          },
        ]
      : [];
    const extra: Message[] = options.extraInstruction
      ? [{ role: "system", content: options.extraInstruction }]
      : [];
    if (!preset?.prompts)
      return [
        ...worldDescription,
        ...identity,
        system,
        ...injected,
        ...tail.slice(1),
        ...extra,
      ];
    const order =
      preset.prompt_order?.find((value) => value.character_id === 100001)
        ?.order ?? [];
    const blocks: Record<string, Message[]> = {
      charDescription: [{ role: "system", content: data.description }],
      charPersonality: [{ role: "system", content: data.personality }],
      scenario: [{ role: "system", content: data.scenario }],
      worldInfoBefore: [{ role: "system", content: world.before.join("\n\n") }],
      worldInfoAfter: [
        {
          role: "system",
          content: [
            ...entries.map((entry) => entry.content),
            ...world.after,
          ].join("\n\n"),
        },
      ],
      chatHistory: injected,
    };
    const result: Message[] = [...worldDescription, ...identity];
    for (const item of order.filter((item) => item.enabled)) {
      const prompt = preset.prompts.find(
        (prompt) => prompt.identifier === item.identifier,
      );
      if (
        prompt?.injection_position !== undefined &&
        prompt.injection_position !== 0
      )
        continue;
      if (Object.hasOwn(blocks, item.identifier))
        result.push(...blocks[item.identifier]);
      else if (prompt && !prompt.marker) {
        const override =
          item.identifier === "main" && options.preferCharacterPrompt !== false
            ? data.system_prompt
            : item.identifier === "jailbreak" &&
                options.preferCharacterInstructions !== false
              ? data.post_history_instructions
              : "";
        const content =
          override && !prompt.forbid_overrides
            ? override.replace(/{{original}}/gi, () => prompt.content)
            : prompt.content;
        result.push({ role: prompt.role, content });
      }
    }
    result.push(...extra);
    return result
      .filter((message) => message.content)
      .map((message) => ({
        ...message,
        content: expand(message.content, data.name),
      }));
  };
  const estimate = (messages: Message[]) =>
    messages.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8") + 8, 0);
  // Unknown model capacity: this is a trimming target, never a claimed API limit.
  if (options.automaticBudget)
    budget = Math.max(budget, estimate(assemble(recent.slice(-2))) + reserve);
  while (recent.length && estimate(assemble(recent)) + reserve > budget) {
    recent.shift();
    while (recent[0]?.role === "assistant") recent.shift();
  }
  const messages = assemble(recent);
  const estimatedTokens = estimate(messages);
  if (estimatedTokens + reserve > budget)
    throw new Error(
      `本地配置的上下文预算不足：必要设定与当前输入保守估算 ${estimatedTokens}，回复预留 ${reserve}，配置 ${budget}。历史已裁剪；请调整手动预算/预设或精简设定。这不是 API 返回的模型限制。`,
    );
  return {
    messages,
    estimatedTokens,
    budget,
    reserve,
    omitted: history.length - recent.length,
    warnings: [
      ...(options.automaticBudget
        ? ["模型真实容量未知；上下文目标按必要设定自动扩展，不保证供应商接受。"]
        : []),
      ...(history.length > recent.length
        ? [
            `本次请求省略 ${history.length - recent.length} 条较早消息；存档原文保留，未生成摘要。`,
          ]
        : []),
    ],
    matchedEntries: entries.length,
    matchedWorldEntries: world.matched,
    worldDepthInjections: world.injections,
    failedWorldProbability: world.failedProbability,
    estimation: "UTF-8 字节数加消息开销的保守估算",
  };
}
