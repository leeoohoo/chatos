import path from 'path';

import { buildUserMessageContent } from '../../packages/common/chat-utils.js';
import { getMcpPromptNameForServer, normalizePromptLanguage } from '../../packages/common/mcp-utils.js';
import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../packages/common/host-app.js';

export function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeWorkspaceRoot(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  return path.resolve(trimmed);
}

export { buildUserMessageContent };
export { getMcpPromptNameForServer, normalizePromptLanguage };
export { normalizeMcpServerName } from '../../packages/common/mcp-utils.js';

export function buildSystemPrompt({
  agent,
  prompts,
  subagents,
  mcpServers,
  language,
  extraPromptNames,
  autoMcpPrompts = true,
} = {}) {
  const agentRecord = agent && typeof agent === 'object' ? agent : {};
  const promptById = new Map((Array.isArray(prompts) ? prompts : []).map((p) => [p.id, p]));
  const promptByName = new Map(
    (Array.isArray(prompts) ? prompts : [])
      .filter((p) => p?.name)
      .map((p) => [String(p.name).trim().toLowerCase(), p])
  );
  const promptSections = (Array.isArray(agentRecord.promptIds) ? agentRecord.promptIds : [])
    .map((id) => promptById.get(id))
    .map((p) => (typeof p?.content === 'string' ? p.content.trim() : ''))
    .filter(Boolean);
  const selectedPromptNames = new Set(
    (Array.isArray(agentRecord.promptIds) ? agentRecord.promptIds : [])
      .map((id) => promptById.get(id))
      .map((p) => String(p?.name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const extraPromptSections = [];
  const addedExtra = new Set();
  (Array.isArray(extraPromptNames) ? extraPromptNames : []).forEach((name) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key || selectedPromptNames.has(key) || addedExtra.has(key)) return;
    const record = promptByName.get(key);
    const content = typeof record?.content === 'string' ? record.content.trim() : '';
    if (!content) return;
    extraPromptSections.push(content);
    addedExtra.add(key);
  });

  const enabledSubagents = new Map(
    (Array.isArray(subagents) ? subagents : [])
      .filter((s) => s?.enabled !== false && s?.id)
      .map((s) => [s.id, s])
  );
  const selectedSubagents = (Array.isArray(agentRecord.subagentIds) ? agentRecord.subagentIds : [])
    .map((id) => enabledSubagents.get(id))
    .filter(Boolean);
  const skills = Array.isArray(agentRecord.skills) ? agentRecord.skills.map((s) => String(s).trim()).filter(Boolean) : [];

  const mcpById = new Map((Array.isArray(mcpServers) ? mcpServers : []).filter((s) => s?.id).map((s) => [s.id, s]));
  const serverAllowed = (server) => {
    if (isExternalOnlyMcpServerName(server?.name) && !allowExternalOnlyMcpServers()) {
      return false;
    }
    return true;
  };
  const selectedMcp = (Array.isArray(agentRecord.mcpServerIds) ? agentRecord.mcpServerIds : [])
    .map((id) => mcpById.get(id))
    .filter((srv) => srv && srv.enabled !== false && serverAllowed(srv));

  const mcpPromptTexts = [];
  if (autoMcpPrompts && selectedMcp.length > 0) {
    const lang = normalizePromptLanguage(language);
    selectedMcp.forEach((server) => {
      const preferredName = getMcpPromptNameForServer(server?.name, lang).toLowerCase();
      const fallbackName = getMcpPromptNameForServer(server?.name).toLowerCase();
      const candidates = preferredName === fallbackName ? [preferredName] : [preferredName, fallbackName];
      for (const name of candidates) {
        if (selectedPromptNames.has(name)) continue;
        if (addedExtra.has(name)) continue;
        const record = promptByName.get(name);
        const content = typeof record?.content === 'string' ? record.content.trim() : '';
        if (!content) continue;
        mcpPromptTexts.push(content);
        break;
      }
    });
  }

  const capabilityLines = [];
  if (selectedSubagents.length > 0) {
    const names = selectedSubagents.map((s) => s.name || s.id).filter(Boolean).slice(0, 12);
    capabilityLines.push(`- 可用子代理: ${names.join(', ')}`);
  }
  if (skills.length > 0) {
    capabilityLines.push(`- 偏好 skills: ${skills.slice(0, 24).join(', ')}`);
  }
  if (selectedMcp.length > 0) {
    const names = selectedMcp.map((s) => s.name || s.id).filter(Boolean).slice(0, 12);
    capabilityLines.push(`- 可用 MCP servers: ${names.join(', ')}`);
  }

  const blocks = [];
  if (promptSections.length > 0) {
    blocks.push(promptSections.join('\n\n'));
  }
  if (extraPromptSections.length > 0) {
    blocks.push(extraPromptSections.join('\n\n'));
  }
  if (mcpPromptTexts.length > 0) {
    blocks.push(mcpPromptTexts.join('\n\n'));
  }
  if (capabilityLines.length > 0) {
    blocks.push(['【能力范围】', ...capabilityLines].join('\n'));
  }
  return blocks.join('\n\n').trim();
}
