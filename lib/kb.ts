/**
 * KB loader.
 *
 * The KB is a build-time artifact: 5 past MECO proposals are pre-parsed +
 * distilled into voice doc, per-PDF abstracts, entity tables, and
 * representative snippets. Total budget ~15–30K tokens (raw inlined parses
 * would bust Sonnet's 200K context window).
 *
 * At runtime, `loadKb(excludeHash)` returns a KB context object with the
 * active doc's hash filtered out — so the user is never fed their own
 * proposal back as past-work context.
 *
 * If the KB hasn't been built (first-time clone, `pnpm build:kb` not run),
 * we return an empty KB and the chips degrade gracefully — Match Voice
 * becomes generic "professional engineering proposal voice" and Reference
 * Past Work no-ops.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KB_DIR = join(process.cwd(), "kb");

export interface KbProposalAbstract {
  hash: string;
  title: string;
  client: string;
  projectType: string;
  scope: string;
  outcomes: string;
}

export interface KbProposalEntities {
  hash: string;
  firmNames: string[];
  projectNames: string[];
  clientNames: string[];
  dates: string[];
  locations: string[];
  dollarFigures: string[];
}

export interface KbProposalSnippet {
  hash: string;
  sectionType:
    | "transmittal"
    | "approach"
    | "team"
    | "experience"
    | "qualifications"
    | "other";
  text: string;
}

export interface KbContext {
  voice: string | null;
  abstracts: KbProposalAbstract[];
  entities: KbProposalEntities[];
  snippets: KbProposalSnippet[];
  /** True if the KB build has run and we have non-empty content. */
  loaded: boolean;
}

let kbCache: KbContext | null = null;

/**
 * Load the KB from disk (cached after first read). Filters out any KB
 * proposal whose hash matches `excludeHash` — we never feed the active doc
 * to itself as past-work context.
 */
export function loadKb(excludeHash?: string): KbContext {
  if (!kbCache) {
    kbCache = readKbFromDisk();
  }
  if (!excludeHash) return kbCache;
  return {
    ...kbCache,
    abstracts: kbCache.abstracts.filter((a) => a.hash !== excludeHash),
    entities: kbCache.entities.filter((e) => e.hash !== excludeHash),
    snippets: kbCache.snippets.filter((s) => s.hash !== excludeHash),
  };
}

function readKbFromDisk(): KbContext {
  const voice = tryRead(join(KB_DIR, "voice.synthesized.md"));
  const abstractsDir = join(KB_DIR, "abstracts");
  const entitiesDir = join(KB_DIR, "entities");
  const snippetsDir = join(KB_DIR, "snippets");

  const abstracts: KbProposalAbstract[] = listJsonish(abstractsDir, ".md")
    .map((file) => {
      const hash = file.replace(/\.md$/, "");
      const text = readFileSync(join(abstractsDir, file), "utf8");
      return parseAbstract(hash, text);
    })
    .filter((a): a is KbProposalAbstract => a !== null);

  const entities: KbProposalEntities[] = listJsonish(entitiesDir, ".json").map(
    (file) => {
      const hash = file.replace(/\.json$/, "");
      const text = readFileSync(join(entitiesDir, file), "utf8");
      const parsed = JSON.parse(text) as Omit<KbProposalEntities, "hash">;
      return { hash, ...parsed };
    },
  );

  const snippets: KbProposalSnippet[] = listJsonish(snippetsDir, ".json")
    .flatMap((file) => {
      const hash = file.replace(/\.json$/, "");
      const text = readFileSync(join(snippetsDir, file), "utf8");
      const parsed = JSON.parse(text) as Omit<KbProposalSnippet, "hash">[];
      return parsed.map((s) => ({ ...s, hash }));
    });

  return {
    voice,
    abstracts,
    entities,
    snippets,
    loaded:
      Boolean(voice) ||
      abstracts.length > 0 ||
      entities.length > 0 ||
      snippets.length > 0,
  };
}

function tryRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function listJsonish(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext));
}

/**
 * Very simple frontmatter-ish parser for abstract files. Format:
 *
 *   ---
 *   client: City of Hunnewell
 *   projectType: Wastewater Treatment Improvements
 *   ---
 *   <free-form abstract paragraph>
 */
function parseAbstract(hash: string, text: string): KbProposalAbstract | null {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const [, frontmatter, body] = match;
  const fields: Record<string, string> = {};
  for (const line of frontmatter!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      fields[key] = value;
    }
  }
  return {
    hash,
    title: fields.title ?? "Untitled",
    client: fields.client ?? "Unknown client",
    projectType: fields.projectType ?? "Unknown",
    scope: body!.trim(),
    outcomes: fields.outcomes ?? "",
  };
}
