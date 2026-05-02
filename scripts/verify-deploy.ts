#!/usr/bin/env tsx
/**
 * Post-deploy verification script.
 *
 * Usage: `pnpm verify:deploy https://your-app.vercel.app`
 *
 * Pings /api/health and exits non-zero if any dependency is red. Used as the
 * final gate before declaring a deployment successful.
 */
export {};

const url = process.argv[2];
if (!url) {
  console.error("Usage: pnpm verify:deploy <url>");
  process.exit(1);
}

const target = url.replace(/\/$/, "") + "/api/health";

console.log(`→ GET ${target}`);

try {
  const response = await fetch(target, { cache: "no-store" });
  const body = await response.json();

  console.log(JSON.stringify(body, null, 2));

  if (!response.ok || !body.ok) {
    console.error(`✗ Health check failed (HTTP ${response.status})`);
    process.exit(1);
  }

  console.log(`✓ Health check passed`);
  process.exit(0);
} catch (error) {
  console.error(
    `✗ Failed to reach ${target}:`,
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
