import { getRegistryCenter } from '../backend/registry-center.js';
import { uniqueStrings } from '../../packages/common/text-utils.js';
import { readPromptSource } from './prompt-source.js';
import { syncUiAppsAiContributes } from './ai.js';

export function syncRegistryCenterFromUiApps({ adminServices, pluginsInternal, maxPromptBytes, errors }) {
  const services = adminServices;
  if (!services?.mcpServers) return;

  let registry = null;
  try {
    registry = getRegistryCenter({ db: services.mcpServers.db });
  } catch {
    registry = null;
  }
  if (!registry) return;

  (Array.isArray(pluginsInternal) ? pluginsInternal : []).forEach((plugin) => {
    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
    const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
    if (!pluginId || !pluginDir) return;

    const providerAppIdRaw = typeof plugin?.providerAppId === 'string' ? plugin.providerAppId.trim() : '';
    const providerAppId = providerAppIdRaw || pluginId;
    const allowGrants = plugin?.trusted === true;

    try {
      registry.registerApp(providerAppId, { name: plugin?.name || providerAppId, version: plugin?.version || '' });
    } catch {
      // ignore
    }

    (Array.isArray(plugin?.apps) ? plugin.apps : []).forEach((app) => {
      const appId = typeof app?.id === 'string' ? app.id.trim() : '';
      if (!appId) return;
      const consumerAppId = `${pluginId}.${appId}`;

      const ai = app?.ai && typeof app.ai === 'object' ? app.ai : null;
      if (!ai) return;

      const mcp = ai?.mcp && typeof ai.mcp === 'object' ? ai.mcp : null;
      if (mcp?.name && mcp?.url) {
        const desiredTags = uniqueStrings([
          ...(Array.isArray(mcp.tags) ? mcp.tags : []),
          'uiapp',
          `uiapp:${pluginId}`,
          `uiapp:${pluginId}:${appId}`,
          `uiapp:${pluginId}.${appId}`,
        ]).sort((a, b) => a.localeCompare(b));
        try {
          const serverRecord = registry.registerMcpServer(providerAppId, {
            id: String(mcp.name || '').trim(),
            name: String(mcp.name || '').trim(),
            url: String(mcp.url || '').trim(),
            description: String(mcp.description || '').trim(),
            tags: desiredTags,
            enabled: typeof mcp.enabled === 'boolean' ? mcp.enabled : true,
            auth: mcp.auth || undefined,
            callMeta: mcp.callMeta || mcp.call_meta || undefined,
          });
          if (serverRecord?.id) {
            if (allowGrants) {
              try {
                registry.grantMcpServerAccess(consumerAppId, serverRecord.id);
              } catch (err) {
                errors.push({
                  dir: pluginDir,
                  source: 'registry',
                  message: `Failed to grant MCP server "${mcp.name}" to "${consumerAppId}": ${err?.message || String(err)}`,
                });
              }
            } else {
              try {
                registry.revokeMcpServerAccess(consumerAppId, serverRecord.id);
              } catch (err) {
                errors.push({
                  dir: pluginDir,
                  source: 'registry',
                  message: `Failed to revoke MCP server "${mcp.name}" from "${consumerAppId}": ${err?.message || String(err)}`,
                });
              }
            }
          }
        } catch (err) {
          errors.push({
            dir: pluginDir,
            source: 'registry',
            message: `Failed to register MCP server "${mcp.name}" for "${providerAppId}": ${err?.message || String(err)}`,
          });
        }
      }

      const prompt = ai?.mcpPrompt && typeof ai.mcpPrompt === 'object' ? ai.mcpPrompt : null;
      const promptNames = prompt?.names && typeof prompt.names === 'object' ? prompt.names : null;
      if (prompt && promptNames) {
        const title =
          typeof prompt.title === 'string' && prompt.title.trim()
            ? prompt.title.trim()
            : `${app?.name || appId} MCP Prompt`;

        const variants = [
          { name: promptNames.zh, source: prompt.zh, label: 'ai.mcpPrompt.zh' },
          { name: promptNames.en, source: prompt.en, label: 'ai.mcpPrompt.en' },
        ].filter((v) => v?.source && v?.name);

        variants.forEach((variant) => {
          let content = '';
          try {
            content = readPromptSource({
              pluginDir,
              source: variant.source,
              label: variant.label,
              maxPromptBytes,
            });
          } catch (err) {
            errors.push({
              dir: pluginDir,
              source: 'registry',
              message: `Failed to read ${variant.label} for "${pluginId}:${appId}": ${err?.message || String(err)}`,
            });
            return;
          }
          if (!content) return;

          const promptName = String(variant.name || '').trim();
          if (!promptName) return;
          try {
            const promptRecord = registry.registerPrompt(providerAppId, {
              id: promptName,
              name: promptName,
              title,
              type: 'system',
              content,
            });
            if (promptRecord?.id) {
              if (allowGrants) {
                try {
                  registry.grantPromptAccess(consumerAppId, promptRecord.id);
                } catch (err) {
                  errors.push({
                    dir: pluginDir,
                    source: 'registry',
                    message: `Failed to grant Prompt "${promptName}" to "${consumerAppId}": ${err?.message || String(err)}`,
                  });
                }
              } else {
                try {
                  registry.revokePromptAccess(consumerAppId, promptRecord.id);
                } catch (err) {
                  errors.push({
                    dir: pluginDir,
                    source: 'registry',
                    message: `Failed to revoke Prompt "${promptName}" from "${consumerAppId}": ${err?.message || String(err)}`,
                  });
                }
              }
            }
          } catch (err) {
            errors.push({
              dir: pluginDir,
              source: 'registry',
              message: `Failed to register Prompt "${promptName}" for "${providerAppId}": ${err?.message || String(err)}`,
            });
          }
        });
      }
    });
  });
}

export function syncAiContributes({ adminServices, pluginsInternal, maxPromptBytes, errors }) {
  const trustedPlugins = (Array.isArray(pluginsInternal) ? pluginsInternal : []).filter(
    (plugin) => plugin?.trusted === true
  );
  return syncUiAppsAiContributes(
    { adminServices, maxPromptBytes },
    trustedPlugins,
    errors
  );
}
