#!/usr/bin/env node
/**
 * Copies pdfjs-dist's worker into `public/pdfjs/` so the app serves it from
 * its own origin. Pinning the worker locally avoids CDN flakiness during
 * demos and keeps version-skew bugs out of the picture.
 *
 * Runs as a postinstall so a fresh `pnpm install` always sets it up.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const target = resolve(root, "public/pdfjs/pdf.worker.min.mjs");

try {
  const require = createRequire(import.meta.url);
  const source = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  // eslint-disable-next-line no-console
  console.log(`✓ Copied PDF.js worker → ${target.replace(root + "/", "")}`);
} catch (error) {
  // Don't fail install if pdfjs-dist isn't yet resolvable (e.g. monorepo edge cases).
  // eslint-disable-next-line no-console
  console.warn(
    "[copy-pdf-worker] skipped:",
    error instanceof Error ? error.message : error,
  );
}
