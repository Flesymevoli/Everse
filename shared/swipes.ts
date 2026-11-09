import type { Message } from "../server/context.js";
export function variantsOf(message: Message): NonNullable<Message["variants"]> {
  if (message.variants?.length) return message.variants;
  const swipes = message.st?.swipes;
  if (
    Array.isArray(swipes) &&
    swipes.length &&
    swipes.every((value) => typeof value === "string")
  )
    return swipes.map((content) => ({ content }));
  return [
    {
      content: message.content,
      warning: message.warning,
      story: message.story,
      raw: message.raw,
      suggestions: message.suggestions,
    },
  ];
}
export function activeVariant(message: Message): number {
  const index = message.selectedVariant ?? message.st?.swipe_id;
  return typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < variantsOf(message).length
    ? index
    : 0;
}
export function selectVariant(message: Message, index: number): Message {
  const variants = variantsOf(message);
  if (!Number.isInteger(index) || !variants[index])
    throw new Error("候选回复不存在");
  const choice = variants[index];
  return {
    ...message,
    content: choice.content,
    warning: choice.warning,
    story: choice.story,
    raw: choice.raw,
    suggestions: choice.suggestions ?? [],
    variants,
    selectedVariant: index,
    st: {
      ...message.st,
      mes: choice.content,
      swipes: variants.map((variant) => variant.content),
      swipe_id: index,
    },
  };
}
export function appendVariant(message: Message, choice: Message): Message {
  const variants = [
    ...variantsOf(message),
    {
      content: choice.content,
      warning: choice.warning,
      story: choice.story,
      raw: choice.raw,
      suggestions: choice.suggestions,
    },
  ];
  return selectVariant({ ...message, variants }, variants.length - 1);
}
