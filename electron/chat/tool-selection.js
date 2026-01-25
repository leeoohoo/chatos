import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../packages/common/host-app.js';
import { normalizeMcpServerName } from '../../packages/common/mcp-utils.js';
import { resolveEngineModule } from '../../src/engine-loader.js';
import { resolveEngineRoot } from '../../src/engine-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const ENGINE_ROOT = resolveEngineRoot({ projectRoot });
if (!ENGINE_ROOT) {
  throw new Error('Engine sources not found (expected ./packages/aide relative to chatos).');
}

function resolveEngineModulePath(relativePath) {
  return resolveEngineModule({ engineRoot: ENGINE_ROOT, relativePath, allowMissing: true });
}

const { listTools } = await import(pathToFileURL(resolveEngineModulePath('tools/index.js')).href);

export function resolveAllowedTools({ agent, mcpServers = [], allowedMcpPrefixes } = {}) {
  const agentRecord = agent && typeof agent === 'object' ? agent : {};

  const serverAllowed = (server) => {
    if (isExternalOnlyMcpServerName(server?.name) && !allowExternalOnlyMcpServers()) {
      return false;
    }
    return true;
  };

  const toolNames = listTools();
  const out = new Set();
  out.add('get_current_time');

  const usePrefixAllowList = Array.isArray(allowedMcpPrefixes);
  if (usePrefixAllowList) {
    const prefixes = allowedMcpPrefixes.map((prefix) => String(prefix || '')).filter(Boolean);
    if (prefixes.length > 0) {
      for (const toolName of toolNames) {
        if (!toolName.startsWith('mcp_')) continue;
        for (const prefix of prefixes) {
          if (toolName.startsWith(prefix)) {
            out.add(toolName);
            break;
          }
        }
      }
    }
    return Array.from(out);
  }

  const allowedMcpNames = new Set(
    (Array.isArray(agentRecord.mcpServerIds) ? agentRecord.mcpServerIds : [])
      .map((id) => mcpServers.find((srv) => srv?.id === id))
      .filter((srv) => srv && srv.enabled !== false && serverAllowed(srv))
      .map((srv) => srv.name)
      .filter(Boolean)
      .map((name) => normalizeMcpServerName(name))
  );

  if (allowedMcpNames.size > 0) {
    for (const toolName of toolNames) {
      if (!toolName.startsWith('mcp_')) continue;
      for (const server of allowedMcpNames) {
        const prefix = `mcp_${server}_`;
        if (toolName.startsWith(prefix)) {
          out.add(toolName);
          break;
        }
      }
    }
  }

  return Array.from(out);
}
