import { normalizeKey } from './text-utils.js';

export function normalizeMcpServerName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizePromptLanguage(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'zh' || raw === 'en') return raw;
  return '';
}

export function getMcpPromptNameForServer(serverName, language) {
  const base = `mcp_${normalizeMcpServerName(serverName)}`;
  const lang = normalizePromptLanguage(language);
  if (lang === 'en') return `${base}__en`;
  return base;
}

export function getMcpPromptNamesForServer(serverName) {
  const base = `mcp_${normalizeMcpServerName(serverName)}`;
  return [base, `${base}__en`];
}

export function isMcpPromptName(name) {
  return normalizeKey(name).startsWith('mcp_');
}
