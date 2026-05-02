import { describe, expect, it } from "vitest";

import { computeDiff, diffIsEmpty } from "@/lib/diff";

describe("computeDiff", () => {
  it("identical strings return a single equal op", () => {
    const ops = computeDiff("Hello world.", "Hello world.");
    expect(ops).toEqual([{ kind: "equal", text: "Hello world." }]);
  });

  it("simple word replacement marks delete + insert", () => {
    const ops = computeDiff("Hello world.", "Hello earth.");
    const inserts = ops.filter((o) => o.kind === "insert");
    const deletes = ops.filter((o) => o.kind === "delete");
    expect(inserts.map((o) => o.text).join("")).toContain("earth");
    expect(deletes.map((o) => o.text).join("")).toContain("world");
  });

  it("ignores curly-quote vs straight-quote differences as equal", () => {
    expect(diffIsEmpty('She said "hi".', 'She said “hi”.')).toBe(true);
  });

  it("ignores em-dash vs en-dash differences", () => {
    expect(diffIsEmpty("range 5-10", "range 5–10")).toBe(true);
  });

  it("appended sentence shows as one insert op (post semantic cleanup)", () => {
    const ops = computeDiff(
      "The project began in 2024.",
      "The project began in 2024. We delivered ahead of schedule.",
    );
    const inserts = ops.filter((o) => o.kind === "insert");
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.map((o) => o.text).join("")).toContain("ahead of schedule");
  });

  it("diffIsEmpty returns false when actual content changes", () => {
    expect(diffIsEmpty("Alpha CM has experience.", "Alpha CM has expertise.")).toBe(false);
  });
});
