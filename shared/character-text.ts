import type { Card } from "../server/cards.js";
export function greetings(card: Card, playerName?: string): string[] {
  const alternatives = card.data.alternate_greetings;
  return [
    card.data.first_mes,
    ...(Array.isArray(alternatives)
      ? alternatives.filter(
          (value): value is string => typeof value === "string",
        )
      : []),
  ].map((text) => expand(text, card.data.name, playerName));
}
export function expand(text: string, name: string, playerName?: string) {
  return text
    .replace(/{{char}}/gi, name)
    .replace(/{{user}}/gi, () => playerName?.trim() || "玩家");
}
