/**
 * Vercel KV — parse cache.
 *
 * Why we cache parses: parsing a 24-page proposal through Claude takes
 * ~10–20s and costs ~$0.20. Caching by SHA-256 of the PDF bytes means
 * re-uploads of the same doc (e.g. demos, repeat reviewers) are instant +
 * free.
 *
 * KV is configured but optional: if env vars aren't set, we transparently
 * fall through to a re-parse. This keeps local dev usable without provisioning.
 */

import type { DocumentModel } from "./doc-model";
import { documentModelSchema } from "./doc-model-zod";
import { hasKv } from "./env";

const PARSE_CACHE_PREFIX = "parse:";
const PARSE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

let kvSingleton: typeof import("@vercel/kv").kv | null = null;

async function getKv() {
  if (!hasKv) return null;
  if (kvSingleton) return kvSingleton;
  const mod = await import("@vercel/kv");
  kvSingleton = mod.kv;
  return kvSingleton;
}

export async function getCachedParse(
  hash: string,
): Promise<DocumentModel | null> {
  const kv = await getKv();
  if (!kv) return null;
  try {
    const raw = await kv.get(PARSE_CACHE_PREFIX + hash);
    if (!raw) return null;
    const parsed = documentModelSchema.safeParse(raw);
    if (!parsed.success) {
      // Stale schema — drop it. Next parse will rewrite a fresh one.
      await kv.del(PARSE_CACHE_PREFIX + hash);
      return null;
    }
    return parsed.data;
  } catch (error) {
    // KV failures shouldn't block the user — log and re-parse.
    console.warn("[kv] getCachedParse failed:", error);
    return null;
  }
}

export async function setCachedParse(
  hash: string,
  model: DocumentModel,
): Promise<void> {
  const kv = await getKv();
  if (!kv) return;
  try {
    await kv.set(PARSE_CACHE_PREFIX + hash, model, {
      ex: PARSE_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.warn("[kv] setCachedParse failed:", error);
  }
}

export async function deleteCachedParse(hash: string): Promise<void> {
  const kv = await getKv();
  if (!kv) return;
  try {
    await kv.del(PARSE_CACHE_PREFIX + hash);
  } catch (error) {
    console.warn("[kv] deleteCachedParse failed:", error);
  }
}
