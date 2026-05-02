import { z } from "zod";

/**
 * Environment schema — validated at boot.
 *
 * `parse(process.env)` runs on first import; missing or malformed values throw
 * with a typed error so the failure mode is loud instead of silent.
 *
 * Vercel auto-injects BLOB_READ_WRITE_TOKEN / KV_* once the corresponding
 * integrations are provisioned in the dashboard. The Anthropic values come
 * from Eric (the take-home contact). OpenAI base URL is included as a
 * commented option for future provider switching.
 */
const envSchema = z.object({
  // Buoyant proxy.
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY is required (the proxy auth token)"),
  ANTHROPIC_BASE_URL: z
    .string()
    .url()
    .default("https://hiring-proxy.trybuoyant.ai/anthropic"),

  // Vercel storage. Optional in local dev so the app boots without them
  // (parse/edit/export will fail loudly when invoked, which is correct).
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  KV_REST_API_URL: z.string().url().optional(),
  KV_REST_API_TOKEN: z.string().min(1).optional(),

  // App env for /api/health labeling.
  NEXT_PUBLIC_APP_ENV: z.enum(["development", "preview", "production"]).default(
    "development",
  ),

  // Vercel sets these automatically.
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  VERCEL_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Environment validation failed:\n${issues}\n\nSee .env.example for the required variables.`,
    );
  }
  return parsed.data;
}

export const env = loadEnv();

/**
 * True when running on Vercel (any env). Used to gate behaviors that don't
 * make sense in local dev (e.g. some auto-injected env validation).
 */
export const isVercel = Boolean(env.VERCEL_ENV);

/**
 * Convenience flag for whether storage is fully configured.
 */
export const hasBlob = Boolean(env.BLOB_READ_WRITE_TOKEN);
export const hasKv = Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
