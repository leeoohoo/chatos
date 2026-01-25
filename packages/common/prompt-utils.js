export function appendPromptBlock(baseText, extraText) {
  const base = typeof baseText === 'string' ? baseText.trim() : '';
  const extra = typeof extraText === 'string' ? extraText.trim() : '';
  if (!base) return extra;
  if (!extra) return base;
  return `${base}\n\n${extra}`;
}
