import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => {
  const files = new Map<string, string>();
  return {
    existsSync: (p: string) => files.has(p) || p.endsWith("/abstracts") || p.endsWith("/entities") || p.endsWith("/snippets"),
    readdirSync: (p: string) => {
      if (p.endsWith("/abstracts")) return ["a1.md", "a2.md", "a3.md"];
      if (p.endsWith("/entities")) return ["a1.json", "a2.json", "a3.json"];
      if (p.endsWith("/snippets")) return ["a1.json", "a2.json", "a3.json"];
      return [];
    },
    readFileSync: (p: string) => {
      const f = p.split("/").pop()!;
      if (f.endsWith(".md")) {
        return `---
title: "${f}"
client: "Test City"
projectType: "Wastewater"
outcomes: "delivered"
---
Sample scope text.
`;
      }
      if (f.endsWith(".json") && p.includes("/entities/")) {
        return JSON.stringify({
          firmNames: ["Acme"],
          projectNames: ["P"],
          clientNames: ["C"],
          dates: [],
          locations: [],
          dollarFigures: [],
        });
      }
      if (f.endsWith(".json") && p.includes("/snippets/")) {
        return JSON.stringify([
          { sectionType: "approach", text: "snippet text" },
        ]);
      }
      return "";
    },
  };
});

describe("loadKb hash exclusion", () => {
  it("excludes the active doc's hash from abstracts/entities/snippets", async () => {
    const { loadKb } = await import("@/lib/kb");
    // mocked listing returns hashes a1, a2, a3
    const all = loadKb();
    expect(all.abstracts.length).toBe(3);
    expect(all.entities.length).toBe(3);

    const filtered = loadKb("a2");
    expect(filtered.abstracts.length).toBe(2);
    expect(filtered.abstracts.map((a) => a.hash)).not.toContain("a2");
    expect(filtered.entities.map((e) => e.hash)).not.toContain("a2");
    expect(filtered.snippets.every((s) => s.hash !== "a2")).toBe(true);
  });

  it("returns the full KB when excludeHash doesn't match any KB doc", async () => {
    const { loadKb } = await import("@/lib/kb");
    const filtered = loadKb("nonexistent");
    expect(filtered.abstracts.length).toBe(3);
  });
});
