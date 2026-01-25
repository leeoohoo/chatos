import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../shared/host-app.js';
import {
  getMcpPromptNameForServer,
  isMcpPromptName,
  normalizeMcpServerName,
  normalizePromptLanguage,
} from '../../shared/mcp-utils.js';

export function buildMcpPromptBundles({ prompts = [], mcpServers = [], language } = {}) {
  const lang = normalizePromptLanguage(language);
  const allowExternalOnly = allowExternalOnlyMcpServers();
  const promptMap = new Map();
  (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
    if (!prompt) return;
    if (!isMcpPromptName(prompt.name)) return;
    const content = typeof prompt.content === 'string' ? prompt.content.trim() : '';
    if (!content) return;
    const name = String(prompt.name || '').trim().toLowerCase();
    if (!name) return;
    promptMap.set(name, content);
  });

  const normalizeServers = (list) => (Array.isArray(list) ? list : []).filter((srv) => srv?.name);
  const servers = normalizeServers(mcpServers).filter(
    (srv) => allowExternalOnly || !isExternalOnlyMcpServerName(srv.name)
  );

  const buildFor = (predicate) => {
    const selectedNames = [];
    const texts = [];
    const missingPromptNames = [];
    servers.forEach((server) => {
      if (!predicate(server)) return;
      const preferredName = getMcpPromptNameForServer(server.name, lang).toLowerCase();
      const fallbackName = getMcpPromptNameForServer(server.name).toLowerCase();
      const candidates = preferredName === fallbackName ? [preferredName] : [preferredName, fallbackName];
      let resolved = '';
      let usedName = preferredName;
      for (const name of candidates) {
        const content = promptMap.get(name) || '';
        if (content) {
          resolved = content;
          usedName = name;
          break;
        }
      }
      selectedNames.push(usedName);
      if (!resolved) {
        missingPromptNames.push(preferredName);
        return;
      }
      texts.push(resolved);
    });
    return {
      promptNames: selectedNames,
      text: texts.join('\n\n'),
      missingPromptNames,
    };
  };

  const isEnabled = (srv) => srv.enabled !== false;
  return {
    main: buildFor(isEnabled),
    subagent: buildFor(isEnabled),
  };
}

export { getMcpPromptNameForServer, isMcpPromptName, normalizeMcpServerName };
