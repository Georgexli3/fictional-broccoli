import { describe, expect, it } from "vitest";

import type { KbContext } from "@/lib/kb";
import { matchBlocksToKb } from "@/lib/kb-match";

const baseKb: KbContext = {
  loaded: true,
  voice: null,
  abstracts: [
    {
      hash: "kirksville",
      title: "Water Treatment Plant SOQ",
      client: "City of Kirksville",
      projectType: "Water Treatment Plant Improvements",
      scope:
        "Design, construction administration, regulatory compliance for potable water treatment, distribution, pumping, and capital planning.",
      outcomes: "",
    },
    {
      hash: "boonville",
      title: "Stormwater Master Plan",
      client: "City of Boonville",
      projectType: "Stormwater Master Plan and Drainage Study",
      scope:
        "Hydraulics modeling for stormwater conveyance, creek bank stabilization, drainage improvements, and watershed analysis.",
      outcomes: "",
    },
  ],
  entities: [
    {
      hash: "kirksville",
      firmNames: [],
      projectNames: ["Kirksville Water Treatment Plant", "Pittsfield Treatment Plant"],
      clientNames: [],
      dates: [],
      locations: [],
      dollarFigures: [],
    },
    {
      hash: "boonville",
      firmNames: [],
      projectNames: [
        "Boonville Stormwater Master Plan",
        "Hannibal Drainage Study",
      ],
      clientNames: [],
      dates: [],
      locations: [],
      dollarFigures: [],
    },
  ],
  snippets: [],
};

describe("matchBlocksToKb", () => {
  it("matches a block on its dominant topic to the right past proposal", () => {
    const blocks = [
      {
        id: "b1",
        kind: "paragraph",
        text: "We propose comprehensive water treatment plant improvements including chemical feed evaluation, pump rebuild, and distribution upgrades for the City of Macon.",
      },
    ];
    const result = matchBlocksToKb(blocks, baseKb);
    const match = result.get("b1");
    expect(match?.proposalHash).toBe("kirksville");
  });

  it("matches a stormwater block to the stormwater proposal, not the water treatment one", () => {
    const blocks = [
      {
        id: "b2",
        kind: "paragraph",
        text: "MECO will deliver a stormwater drainage hydraulics study and creek bank stabilization recommendations for the watershed.",
      },
    ];
    const result = matchBlocksToKb(blocks, baseKb);
    expect(result.get("b2")?.proposalHash).toBe("boonville");
  });

  it("skips short blocks (below MIN_BLOCK_CHARS)", () => {
    const blocks = [{ id: "b3", kind: "paragraph", text: "Water treatment." }];
    const result = matchBlocksToKb(blocks, baseKb);
    expect(result.has("b3")).toBe(false);
  });

  it("skips locked block kinds", () => {
    const blocks = [
      {
        id: "b4",
        kind: "header_footer",
        text: "MECO Engineering Company water treatment specialists with extensive experience.",
      },
    ];
    const result = matchBlocksToKb(blocks, baseKb);
    expect(result.has("b4")).toBe(false);
  });

  it("returns empty when KB is not loaded", () => {
    const blocks = [
      {
        id: "b5",
        kind: "paragraph",
        text: "Water treatment plant improvements for distribution upgrades and pumping station overhaul.",
      },
    ];
    const result = matchBlocksToKb(blocks, { ...baseKb, loaded: false });
    expect(result.size).toBe(0);
  });

  it("excludes the active doc's hash so a doc never matches itself", () => {
    const blocks = [
      {
        id: "b6",
        kind: "paragraph",
        text: "Water treatment plant improvements for distribution upgrades and pumping station overhaul.",
      },
    ];
    const result = matchBlocksToKb(blocks, baseKb, "kirksville");
    // Only Boonville (stormwater) remains as a candidate; the block is about
    // water treatment so it shouldn't strongly match.
    const match = result.get("b6");
    if (match) expect(match.proposalHash).not.toBe("kirksville");
  });

  it("does not match generic boilerplate that has no topic overlap", () => {
    const blocks = [
      {
        id: "b7",
        kind: "paragraph",
        text: "We thank you for the opportunity to submit this proposal and look forward to working together with your team on this exciting engagement.",
      },
    ];
    const result = matchBlocksToKb(blocks, baseKb);
    expect(result.has("b7")).toBe(false);
  });
});
