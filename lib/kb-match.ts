/**
 * V1.7.2: proactive KB ↔ block matcher.
 *
 * Today the KB is reactive: it only fires when the user clicks the
 * "Reference past work" chip. This module turns it ambient — for each block,
 * we silently check the KB and (when there's a genuinely relevant past
 * project) return a hint the UI can surface as a 📎 chip.
 *
 * Algorithm: token-overlap scoring against per-proposal "topic bags."
 * No embeddings, no LLM call — at 5 KB items it would be noise. The
 * deterministic / cheap matcher fits the cost-conscious architecture and
 * runs in ~10 ms over a 100-block doc.
 *
 * Tuning: false positives are worse than misses (hint clutter erodes trust
 * exactly the way V1.5's wrong-location overlays did). The thresholds below
 * favor precision: a block has to share at least 2 *salient* tokens with a
 * proposal's topic bag, and the topic bag itself filters proposal-boilerplate
 * terms ("project", "engineering", "services") so they don't carry signal.
 */

import type { KbContext, KbProposalAbstract, KbProposalEntities } from "./kb";

export interface KbMatch {
  /** Hash of the matched past proposal. */
  proposalHash: string;
  /** Display string, e.g. "City of Kirksville — Water Treatment Plant". */
  projectLabel: string;
  /** One-line rationale for the hint, e.g. "this paragraph mentions wastewater treatment". */
  preview: string;
  /** 0-1 score, for prioritizing across multiple potential matches. */
  score: number;
}

interface BlockInput {
  id: string;
  text: string;
  kind: string;
}

/** Word-character pattern; we tokenize, lowercase, drop short + stopwords. */
const TOKEN_RE = /[a-z][a-z0-9-]+/g;

/**
 * Words that show up in nearly every proposal. Including them in the topic
 * bag would make every block match every past proposal.
 */
const STOPWORDS = new Set([
  // English filler
  "the", "and", "for", "are", "with", "from", "this", "that", "have", "has",
  "will", "our", "your", "their", "they", "them", "any", "all", "some",
  "more", "most", "less", "many", "other", "such", "than", "then", "also",
  "into", "onto", "over", "under", "above", "below", "about", "after",
  "before", "between", "through", "during", "while", "where", "when",
  "what", "which", "who", "whom", "whose", "how",
  // Boilerplate proposal vocabulary — these are everywhere
  "project", "projects", "engineering", "services", "service", "company",
  "firm", "professional", "qualifications", "team", "staff", "experience",
  "experienced", "client", "clients", "proposal", "proposals", "submittal",
  "office", "offices", "approach", "scope", "design", "construction",
  "review", "support", "management", "department", "city", "state",
  "missouri", "mo", "illinois", "il",
]);

const MIN_BLOCK_CHARS = 60;
const MIN_TOKEN_LEN = 4;
const MIN_OVERLAP = 2;
const SCORE_THRESHOLD = 0.18;

const EDITABLE_KINDS = new Set(["paragraph", "list_item"]);

interface TopicBag {
  proposal: KbProposalAbstract;
  /** Salient tokens drawn from projectType + scope + projectNames. */
  tokens: Set<string>;
  /** Topic descriptor for the preview line, e.g. "wastewater treatment". */
  topic: string;
}

/**
 * Build per-proposal topic bags. Excludes the active doc's own hash so the
 * user is never matched against their own proposal.
 */
export function buildTopicBags(
  kb: KbContext,
  excludeHash?: string,
): TopicBag[] {
  const bags: TopicBag[] = [];
  for (const abstract of kb.abstracts) {
    if (abstract.hash === excludeHash) continue;
    const entities = kb.entities.find((e) => e.hash === abstract.hash);
    const bag = buildBag(abstract, entities);
    if (bag.tokens.size >= 3) bags.push(bag);
  }
  return bags;
}

function buildBag(
  abstract: KbProposalAbstract,
  entities: KbProposalEntities | undefined,
): TopicBag {
  const tokens = new Set<string>();
  // Project type carries the most signal — weight it by adding twice via
  // bigrams, but for set-based matching we just include the single tokens.
  pushTokens(abstract.projectType, tokens);
  pushTokens(abstract.scope, tokens);
  if (entities) {
    for (const name of entities.projectNames) pushTokens(name, tokens);
  }
  return {
    proposal: abstract,
    tokens,
    topic: shortTopic(abstract.projectType),
  };
}

function pushTokens(text: string, set: Set<string>): void {
  const lower = text.toLowerCase();
  const matches = lower.match(TOKEN_RE);
  if (!matches) return;
  for (const tok of matches) {
    if (tok.length < MIN_TOKEN_LEN) continue;
    if (STOPWORDS.has(tok)) continue;
    set.add(tok);
  }
}

/** Trim a project-type string to a 2–4-word topic phrase for the preview. */
function shortTopic(projectType: string): string {
  const cleaned = projectType.replace(/[–—\-(),]/g, " ");
  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .filter((w) => !STOPWORDS.has(w.toLowerCase()))
    .slice(0, 4);
  return words.join(" ").trim() || projectType;
}

/**
 * For each block, return the strongest (above-threshold) KB match, or
 * nothing. Map keys are block IDs.
 */
export function matchBlocksToKb(
  blocks: BlockInput[],
  kb: KbContext,
  excludeHash?: string,
): Map<string, KbMatch> {
  const out = new Map<string, KbMatch>();
  if (!kb.loaded) return out;

  const bags = buildTopicBags(kb, excludeHash);
  if (bags.length === 0) return out;

  for (const block of blocks) {
    if (!EDITABLE_KINDS.has(block.kind)) continue;
    if (block.text.length < MIN_BLOCK_CHARS) continue;

    const blockTokens = new Set<string>();
    pushTokens(block.text, blockTokens);
    if (blockTokens.size === 0) continue;

    let best: { bag: TopicBag; overlap: string[]; score: number } | null = null;
    for (const bag of bags) {
      const overlap: string[] = [];
      for (const t of blockTokens) {
        if (bag.tokens.has(t)) overlap.push(t);
      }
      if (overlap.length < MIN_OVERLAP) continue;
      // Score: overlap count normalized by the smaller of the two sets, so
      // a heavy block doesn't disadvantage a tight project topic bag.
      const denom = Math.min(blockTokens.size, bag.tokens.size);
      const score = overlap.length / denom;
      if (score < SCORE_THRESHOLD) continue;
      if (!best || score > best.score) {
        best = { bag, overlap, score };
      }
    }

    if (!best) continue;
    out.set(block.id, {
      proposalHash: best.bag.proposal.hash,
      projectLabel: `${best.bag.proposal.client} — ${best.bag.proposal.projectType}`,
      preview: previewLine(best.overlap, best.bag),
      score: best.score,
    });
  }

  return out;
}

function previewLine(overlap: string[], bag: TopicBag): string {
  // Pick the 2 most distinctive overlap terms (rarest in the bag) for the hint.
  const sorted = overlap.slice().sort((a, b) => a.length - b.length).reverse();
  const topical = sorted.slice(0, 2).join(" / ");
  return topical
    ? `Mentions ${topical} — past project: ${bag.proposal.client}.`
    : `Possibly relevant past project: ${bag.proposal.client}.`;
}
