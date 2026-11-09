import type { SourcedFact } from "./story.js";

// No fixed game attributes: labels and entities come from the work's evidence.
export function characterGroups(facts: SourcedFact[]) {
  const groups = new Map<
    string,
    { name: string; attributes: SourcedFact[]; inventory: SourcedFact[] }
  >();
  const other: SourcedFact[] = [];
  for (const fact of facts) {
    if (!fact.panel && fact.kind !== "person") {
      other.push(fact);
      continue;
    }
    const name = fact.panel?.entity ?? "人物";
    const group = groups.get(name) ?? { name, attributes: [], inventory: [] };
    (fact.panel?.group === "inventory"
      ? group.inventory
      : group.attributes
    ).push(fact);
    groups.set(name, group);
  }
  return { characters: [...groups.values()], other };
}
