/**
 * Prompt-cache builders.
 *
 * Anthropic's prompt caching marks specific blocks in the system prompt as
 * `cache_control: { type: 'ephemeral' }`. After the first call, those blocks
 * are read from cache at ~10% input price.
 *
 * Strategy: cache the stable parts (KB voice + abstracts + entities + base
 * style rules + intent-specific instructions). Don't cache the per-call
 * parts (the block-being-edited, surrounding context, user prompt).
 *
 * Why per-intent instead of one giant block: the intent-specific rules
 * change per chip, and we'd rather invalidate that small section than the
 * whole KB if we tweak a chip's behavior.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { EditIntent } from "./doc-model";
import type { KbContext } from "./kb";

export interface CachedSystemBlocks {
  blocks: Anthropic.Messages.TextBlockParam[];
  /** Estimated total tokens in the cached payload (rough — char count / 4). */
  estimatedTokens: number;
}

/**
 * Build the cached system blocks for an edit call. The KB is the largest
 * stable piece; we cache it once per session. The base edit rules are also
 * cached. The intent-specific rules are NOT cached (they change per chip).
 */
export function buildEditSystemBlocks(input: {
  intent: EditIntent;
  intentInstructions: string;
  baseRules: string;
  kb: KbContext;
}): CachedSystemBlocks {
  const blocks: Anthropic.Messages.TextBlockParam[] = [];

  // 1. Base rules (cached — stable across all edits forever).
  blocks.push({
    type: "text",
    text: input.baseRules,
    cache_control: { type: "ephemeral" },
  });

  // 2. KB context (cached — stable per-session, since active hash exclusion
  //    is determined per request and could vary; we still cache because the
  //    KB content itself rarely changes).
  if (input.kb.loaded) {
    blocks.push({
      type: "text",
      text: renderKbAsPromptText(input.kb),
      cache_control: { type: "ephemeral" },
    });
  }

  // 3. Intent-specific (NOT cached — small, varies by chip).
  blocks.push({ type: "text", text: input.intentInstructions });

  const estimatedTokens = blocks.reduce(
    (sum, b) => sum + Math.ceil(b.text.length / 4),
    0,
  );

  return { blocks, estimatedTokens };
}

/**
 * Format the KB as plain-text sections that Claude can use as grounded
 * context. We use XML-like wrappers so the model can clearly distinguish
 * between voice / abstracts / entities / snippets.
 */
function renderKbAsPromptText(kb: KbContext): string {
  const sections: string[] = [];

  if (kb.voice) {
    sections.push(
      `<firm_voice_guide>\n${kb.voice}\n</firm_voice_guide>`,
    );
  }

  if (kb.abstracts.length > 0) {
    const formatted = kb.abstracts
      .map(
        (a) => `<past_proposal hash="${a.hash}">
  Title: ${a.title}
  Client: ${a.client}
  Type: ${a.projectType}
  Scope: ${a.scope}
  Outcomes: ${a.outcomes}
</past_proposal>`,
      )
      .join("\n\n");
    sections.push(`<past_proposals>\n${formatted}\n</past_proposals>`);
  }

  if (kb.entities.length > 0) {
    const formatted = kb.entities
      .map(
        (e) => `<entities hash="${e.hash}">
  firms: ${e.firmNames.join("; ")}
  projects: ${e.projectNames.join("; ")}
  clients: ${e.clientNames.join("; ")}
  dates: ${e.dates.join("; ")}
  locations: ${e.locations.join("; ")}
  dollar_figures: ${e.dollarFigures.join("; ")}
</entities>`,
      )
      .join("\n\n");
    sections.push(`<grounded_entities>\n${formatted}\n</grounded_entities>`);
  }

  if (kb.snippets.length > 0) {
    const formatted = kb.snippets
      .map(
        (s) =>
          `<snippet hash="${s.hash}" section="${s.sectionType}">\n${s.text}\n</snippet>`,
      )
      .join("\n\n");
    sections.push(`<snippets>\n${formatted}\n</snippets>`);
  }

  return sections.join("\n\n");
}
