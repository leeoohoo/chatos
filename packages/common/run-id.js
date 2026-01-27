import crypto from 'crypto';

export function ensureRunId(env = process.env) {
  const resolvedEnv = env && typeof env === 'object' ? env : process.env;
  const existing = typeof resolvedEnv.MODEL_CLI_RUN_ID === 'string' ? resolvedEnv.MODEL_CLI_RUN_ID.trim() : '';
  if (existing) return existing;
  const short = crypto.randomUUID().split('-')[0];
  const generated = `run-${Date.now().toString(36)}-${short}`;
  resolvedEnv.MODEL_CLI_RUN_ID = generated;
  return generated;
}
