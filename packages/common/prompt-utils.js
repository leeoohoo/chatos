export function appendPromptBlock(baseText, extraText) {
  const base = typeof baseText === 'string' ? baseText.trim() : '';
  const extra = typeof extraText === 'string' ? extraText.trim() : '';
  if (!base) return extra;
  if (!extra) return base;
  return `${base}\n\n${extra}`;
}

export const RESERVED_PROMPT_NAMES = new Set([
  'internal',
  'internal_main',
  'internal_subagent',
  'default',
  'user_prompt',
  'subagent_user_prompt',
]);
