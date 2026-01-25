import { appendPromptBlock } from '../../shared/prompt-utils.js';

function readRegistrySnapshot(services) {
  const db = services?.mcpServers?.db || services?.prompts?.db || null;
  if (!db || typeof db.list !== 'function') {
    return { mcpServers: [], prompts: [], mcpGrants: [], promptGrants: [] };
  }
  try {
    return {
      mcpServers: db.list('registryMcpServers') || [],
      prompts: db.list('registryPrompts') || [],
      mcpGrants: db.list('mcpServerGrants') || [],
      promptGrants: db.list('promptGrants') || [],
    };
  } catch {
    return { mcpServers: [], prompts: [], mcpGrants: [], promptGrants: [] };
  }
}

export function resolveSubagentLandSelection({
  adminServices,
  buildLandConfigSelection,
  resolveLandConfig,
} = {}) {
  const runtimeConfig = adminServices?.settings?.getRuntimeConfig ? adminServices.settings.getRuntimeConfig() : null;
  const promptLanguage = runtimeConfig?.promptLanguage || null;
  const landConfigId = typeof runtimeConfig?.landConfigId === 'string' ? runtimeConfig.landConfigId.trim() : '';
  const landConfigRecords = adminServices?.landConfigs?.list ? adminServices.landConfigs.list() : [];
  const selectedLandConfig = resolveLandConfig({ landConfigs: landConfigRecords, landConfigId });
  const registrySnapshot = readRegistrySnapshot(adminServices);
  const promptRecords = adminServices.prompts.list();
  const mcpServerRecords = adminServices.mcpServers.list();
  const landSelection = selectedLandConfig
    ? buildLandConfigSelection({
        landConfig: selectedLandConfig,
        prompts: promptRecords,
        mcpServers: mcpServerRecords,
        registryMcpServers: registrySnapshot.mcpServers,
        registryPrompts: registrySnapshot.prompts,
        registryMcpGrants: registrySnapshot.mcpGrants,
        registryPromptGrants: registrySnapshot.promptGrants,
        promptLanguage,
      })
    : null;
  const combinedSubagentPrompt = landSelection
    ? appendPromptBlock(landSelection.sub.promptText, landSelection.sub.mcpPromptText)
    : '';
  const missingMcpPromptNames = Array.isArray(landSelection?.sub?.missingMcpPromptNames)
    ? landSelection.sub.missingMcpPromptNames
    : [];
  const missingAppServers = Array.isArray(landSelection?.sub?.missingAppServers)
    ? landSelection.sub.missingAppServers
    : [];
  return {
    landSelection,
    combinedSubagentPrompt,
    missingMcpPromptNames,
    missingAppServers,
  };
}
