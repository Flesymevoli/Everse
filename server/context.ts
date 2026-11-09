import { expand, type Card } from "./cards.js";
import { evaluateBook } from "./worldbook.js";
import { presetSchema } from "./preset.js";
export interface Message {
  variants?: {
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
    worldbook?: unknown;
    preset?: unknown;
    scanDepth?: number;
    recursive?: boolean;
    maxRecursionSteps?: number;
    preferCharacterPrompt?: boolean;
    preferCharacterInstructions?: boolean;
    extraInstruction?: string;
  } = {},
) {
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
    const extra: Message[] = options.extraInstruction
      ? [{ role: "system", content: options.extraInstruction }]
      : [];
    if (!preset?.prompts)
      return [system, ...injected, ...tail.slice(1), ...extra];
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
    const result: Message[] = [];
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
  while (recent.length && estimate(assemble(recent)) + reserve > budget) {
    recent.shift();
    while (recent[0]?.role === "assistant") recent.shift();
  }
  const messages = assemble(recent);
  const estimatedTokens = estimate(messages);
  if (estimatedTokens + reserve > budget)
    throw new Error("角色与输入超出预算，请缩短输入或提高上下文预算");
  return {
    messages,
    estimatedTokens,
    budget,
    reserve,
    omitted: history.length - recent.length,
    matchedEntries: entries.length,
    matchedWorldEntries: world.matched,
    worldDepthInjections: world.injections,
    failedWorldProbability: world.failedProbability,
    estimation: "UTF-8 字节数加消息开销的保守估算",
  };
}
