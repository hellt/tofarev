import { z } from 'zod';

export const MODEL = 'zai-org/GLM-5.3-Flash';
export const ENDPOINT = 'https://api.tokenfactory.nebius.com/v1';
export const OPENCODE_VERSION = '1.18.33';
export const Rules = ['.cursor/rules/karpathy-guidelines.mdc', '.cursor/rules/ponytail.mdc'] as const;
export const ConfigSchema = z.strictObject({
  repository: z.string().max(201).regex(/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/).default('srl-labs/containerlab'),
  repositoryId: z.number().int().positive().default(290960521),
  allowedUsers: z.array(z.string().regex(/^[\w-]+$/)).min(1).default(['hellt', 'flosch62', 'kaelemc']),
  appSlug: z.string().regex(/^[a-z0-9-]+$/).default('tofarev'),
  shareSessions: z.boolean().default(false),
  reasoningEffort: z.enum(['low', 'high', 'max']).default('high'),
  limits: z.strictObject({
    durationMs: z.number().int().min(1000).max(1_800_000).default(1_800_000),
    turns: z.number().int().min(1).max(1000).optional(),
    contextTokens: z.number().int().min(1024).max(100_000).default(100_000),
    requestBytes: z.number().int().min(1024).max(2_097_152).default(2_097_152),
    outputTokens: z.number().int().min(512).max(16_384).default(16_384),
    blobBytes: z.number().int().min(1).max(1_048_576).default(1_048_576),
    snapshotBytes: z.number().int().min(1).max(104_857_600).default(104_857_600),
    diffBytes: z.number().int().min(1).max(250_000).default(250_000),
    reportBytes: z.number().int().min(4000).max(60_000).default(60_000),
  }).refine(l => l.outputTokens < l.contextTokens, 'Output budget must be smaller than context budget').prefault({}),
});
export type Config = z.infer<typeof ConfigSchema>;
export function config(input: unknown = {}): Config { return ConfigSchema.parse(input); }
export function apiKey(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.TOFAREV_API_KEY?.trim();
  if (!value) throw new Error('TOFAREV_API_KEY is required for inference');
  return value;
}
