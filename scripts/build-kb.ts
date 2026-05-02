#!/usr/bin/env tsx
/**
 * KB build pipeline.
 *
 * Reads `ExampleProposals/MECOProposals/*.pdf` and produces:
 *   kb/parsed/<hash>.json        — full parsed doc model
 *   kb/abstracts/<hash>.md       — ~300-tok abstract with frontmatter
 *   kb/entities/<hash>.json      — entity table
 *   kb/snippets/<hash>.json      — 3–5 representative paragraphs
 *   kb/voice.synthesized.md      — distilled firm voice (one call across all 5)
 *   kb/manifest.json             — { hash → { title, sourceFile, tokens } }
 *
 * Idempotent — re-runs skip outputs that already exist. Pass `--force` to
 * regenerate everything. Pass `--only=<filename>` to limit to one PDF.
 *
 * Cost: ~$1 in Anthropic credit per full run (parse + distill + voice).
 *
 * Requires:
 *   ANTHROPIC_API_KEY set (locally — Buoyant proxy token from Eric).
 */

export {};

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";

import { sha256OfArrayBuffer } from "../lib/hash";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const SOURCE_DIR = join(root, "ExampleProposals/MECOProposals");
const KB_DIR = join(root, "kb");
const PARSED_DIR = join(KB_DIR, "parsed");
const ABSTRACTS_DIR = join(KB_DIR, "abstracts");
const ENTITIES_DIR = join(KB_DIR, "entities");
const SNIPPETS_DIR = join(KB_DIR, "snippets");
const MANIFEST_PATH = join(KB_DIR, "manifest.json");
const VOICE_PATH = join(KB_DIR, "voice.synthesized.md");

const MODEL = "claude-sonnet-4-6";

interface Args {
  force: boolean;
  only?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : undefined;
  return { force, only };
}

function ensureDirs() {
  for (const dir of [KB_DIR, PARSED_DIR, ABSTRACTS_DIR, ENTITIES_DIR, SNIPPETS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseURL =
    process.env.ANTHROPIC_BASE_URL ?? "https://hiring-proxy.trybuoyant.ai/anthropic";
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY missing. Set it in .env.local (or environment) before running build:kb.",
    );
    process.exit(1);
  }
  return new Anthropic({ apiKey, baseURL });
}

interface DistillationResult {
  abstract: {
    title: string;
    client: string;
    projectType: string;
    scope: string;
    outcomes: string;
  };
  entities: {
    firmNames: string[];
    projectNames: string[];
    clientNames: string[];
    dates: string[];
    locations: string[];
    dollarFigures: string[];
  };
  snippets: Array<{
    sectionType:
      | "transmittal"
      | "approach"
      | "team"
      | "experience"
      | "qualifications"
      | "other";
    text: string;
  }>;
}

const distillationTool = {
  name: "emit_kb_distillation",
  description:
    "Emit the distilled KB record for one past proposal: abstract, entities, and 3–5 representative snippets.",
  input_schema: {
    type: "object" as const,
    properties: {
      abstract: {
        type: "object",
        properties: {
          title: { type: "string" },
          client: { type: "string" },
          projectType: { type: "string" },
          scope: { type: "string", description: "150–250 words." },
          outcomes: { type: "string" },
        },
        required: ["title", "client", "projectType", "scope", "outcomes"],
      },
      entities: {
        type: "object",
        properties: {
          firmNames: { type: "array", items: { type: "string" } },
          projectNames: { type: "array", items: { type: "string" } },
          clientNames: { type: "array", items: { type: "string" } },
          dates: { type: "array", items: { type: "string" } },
          locations: { type: "array", items: { type: "string" } },
          dollarFigures: { type: "array", items: { type: "string" } },
        },
        required: [
          "firmNames",
          "projectNames",
          "clientNames",
          "dates",
          "locations",
          "dollarFigures",
        ],
      },
      snippets: {
        type: "array",
        description:
          "3–5 representative paragraphs from the proposal, each tagged by section type.",
        items: {
          type: "object",
          properties: {
            sectionType: {
              type: "string",
              enum: [
                "transmittal",
                "approach",
                "team",
                "experience",
                "qualifications",
                "other",
              ],
            },
            text: { type: "string" },
          },
          required: ["sectionType", "text"],
        },
        minItems: 3,
        maxItems: 5,
      },
    },
    required: ["abstract", "entities", "snippets"],
  },
};

const DISTILL_SYSTEM_PROMPT = `You are an analyst extracting structured KB content from a civil-engineering proposal. Read the attached PDF and emit:

1. An abstract — title, client, project type, 150-250 word scope summary, and outcomes/deliverables.
2. An entity table — every firm name, project name, client name, date, location, and dollar figure that appears in the proposal.
3. 3-5 representative snippets — paragraphs that exemplify the firm's voice in different sections (transmittal letter, project approach, project team, experience, qualifications). Pick paragraphs that would be useful as context for editing future proposals.

Be faithful to the original. Do not invent. Preserve original wording in snippets.`;

async function distillProposal(
  client: Anthropic,
  pdfBytes: ArrayBuffer,
): Promise<DistillationResult> {
  const base64 = Buffer.from(pdfBytes).toString("base64");
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: DISTILL_SYSTEM_PROMPT,
    tools: [distillationTool],
    tool_choice: { type: "tool", name: "emit_kb_distillation" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64,
            },
          },
          {
            type: "text",
            text: "Distill this past proposal into structured KB content.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (b) => b.type === "tool_use" && b.name === "emit_kb_distillation",
  );
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not emit emit_kb_distillation");
  }
  return toolUse.input as DistillationResult;
}

const VOICE_SYSTEM_PROMPT = `You are distilling the voice of a single engineering consulting firm into a concise style guide. Read the firm-voice exemplars and produce a 600-1200 word markdown guide.

Cover:
- Tone (formal vs. conversational, hedged vs. direct, etc.)
- Sentence rhythm (long vs. short, simple vs. complex)
- Vocabulary preferences (technical vs. accessible, specific terms favored)
- Active vs. passive voice patterns
- Pronoun usage ("we" vs. "the firm" vs. third-person)
- Use of named SMEs and concrete past projects
- Numbers, units, and figures conventions
- What this voice avoids (marketing fluff, jargon, etc.)

Output ONLY the markdown style guide, ready to inline as system context. No preamble.`;

async function synthesizeVoice(
  client: Anthropic,
  exemplars: Array<{ title: string; snippets: DistillationResult["snippets"] }>,
): Promise<string> {
  const blob = exemplars
    .map(
      (e) =>
        `## ${e.title}\n\n${e.snippets.map((s) => `[${s.sectionType}]\n${s.text}`).join("\n\n")}`,
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: VOICE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Distill the firm's voice from these exemplars:\n\n${blob}`,
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Voice synthesis returned no text");
  }
  return textBlock.text.trim();
}

interface ManifestEntry {
  hash: string;
  sourceFile: string;
  title: string;
  builtAt: number;
}

function readManifest(): Record<string, ManifestEntry> {
  if (!existsSync(MANIFEST_PATH)) return {};
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<
      string,
      ManifestEntry
    >;
  } catch {
    return {};
  }
}

function writeManifest(manifest: Record<string, ManifestEntry>) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
}

function abstractToMarkdown(
  hash: string,
  title: string,
  abstract: DistillationResult["abstract"],
): string {
  return `---
hash: ${hash}
title: "${escapeYaml(title)}"
client: "${escapeYaml(abstract.client)}"
projectType: "${escapeYaml(abstract.projectType)}"
outcomes: "${escapeYaml(abstract.outcomes)}"
---

${abstract.scope.trim()}
`;
}

function escapeYaml(s: string): string {
  return s.replace(/"/g, '\\"');
}

async function main() {
  const args = parseArgs();
  ensureDirs();

  if (!existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const pdfFiles = readdirSync(SOURCE_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .filter((f) => !args.only || f === args.only)
    .sort();

  if (pdfFiles.length === 0) {
    console.error("No PDFs found.");
    process.exit(1);
  }

  console.log(`Building KB from ${pdfFiles.length} PDFs in ${SOURCE_DIR}\n`);

  const client = getClient();
  const manifest = readManifest();
  const exemplars: Array<{ title: string; snippets: DistillationResult["snippets"] }> = [];

  for (const file of pdfFiles) {
    const filePath = join(SOURCE_DIR, file);
    const bytes = readFileSync(filePath);
    const hash = await sha256OfArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    const abstractPath = join(ABSTRACTS_DIR, `${hash}.md`);
    const entitiesPath = join(ENTITIES_DIR, `${hash}.json`);
    const snippetsPath = join(SNIPPETS_DIR, `${hash}.json`);
    const allExist = [abstractPath, entitiesPath, snippetsPath].every(existsSync);

    if (allExist && !args.force) {
      console.log(`✓ ${file}  (cached, hash=${hash.slice(0, 8)})`);
      // Still need exemplars for voice synthesis.
      try {
        exemplars.push({
          title: file,
          snippets: JSON.parse(readFileSync(snippetsPath, "utf8")) as DistillationResult["snippets"],
        });
      } catch {
        // ignore
      }
      continue;
    }

    console.log(`→ ${file}  (parsing + distilling, hash=${hash.slice(0, 8)})`);
    const startedAt = Date.now();
    let result: DistillationResult;
    try {
      result = await distillProposal(client, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (error) {
      console.error(`  ✗ Distillation failed: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    writeFileSync(
      abstractPath,
      abstractToMarkdown(hash, result.abstract.title, result.abstract),
    );
    writeFileSync(entitiesPath, JSON.stringify(result.entities, null, 2) + "\n");
    writeFileSync(snippetsPath, JSON.stringify(result.snippets, null, 2) + "\n");

    manifest[hash] = {
      hash,
      sourceFile: file,
      title: result.abstract.title,
      builtAt: Date.now(),
    };
    writeManifest(manifest);

    exemplars.push({ title: result.abstract.title, snippets: result.snippets });
    console.log(`  ✓ Done in ${elapsed}s`);
  }

  // Synthesize voice doc.
  if (!existsSync(VOICE_PATH) || args.force) {
    if (exemplars.length === 0) {
      console.warn("No exemplars; skipping voice synthesis");
    } else {
      console.log(`\n→ Synthesizing voice doc from ${exemplars.length} exemplars`);
      try {
        const voice = await synthesizeVoice(client, exemplars);
        writeFileSync(VOICE_PATH, voice + "\n");
        console.log("  ✓ Wrote kb/voice.synthesized.md");
      } catch (error) {
        console.error(
          `  ✗ Voice synthesis failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  } else {
    console.log("\n✓ kb/voice.synthesized.md already exists (use --force to regenerate)");
  }

  console.log("\nKB build complete.");
}

void main().catch((error) => {
  console.error("KB build failed:", error);
  process.exit(1);
});
