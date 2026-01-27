import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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

let engineDepsPromise = null;
export async function loadEngineDeps() {
  if (engineDepsPromise) return engineDepsPromise;
  engineDepsPromise = (async () => {
    const [
      sessionMod,
      clientMod,
      configMod,
      mcpRuntimeMod,
      subagentRuntimeMod,
      toolsMod,
      landConfigMod,
      summaryMod,
      clientHelpersMod,
    ] = await Promise.all([
      import(pathToFileURL(resolveEngineModulePath('session.js')).href),
      import(pathToFileURL(resolveEngineModulePath('client.js')).href),
      import(pathToFileURL(resolveEngineModulePath('config.js')).href),
      import(pathToFileURL(resolveEngineModulePath('mcp/runtime.js')).href),
      import(pathToFileURL(resolveEngineModulePath('subagents/runtime.js')).href),
      import(pathToFileURL(resolveEngineModulePath('tools/index.js')).href),
      import(pathToFileURL(resolveEngineModulePath('land-config.js')).href),
      import(pathToFileURL(resolveEngineModulePath('chat/summary.js')).href),
      import(pathToFileURL(resolveEngineModulePath('client-helpers.js')).href),
    ]);
    return {
      ChatSession: sessionMod.ChatSession,
      ModelClient: clientMod.ModelClient,
      createAppConfigFromModels: configMod.createAppConfigFromModels,
      initializeMcpRuntime: mcpRuntimeMod.initializeMcpRuntime,
      runWithSubAgentContext: subagentRuntimeMod.runWithSubAgentContext,
      registerTool: toolsMod.registerTool,
      buildLandConfigSelection: landConfigMod.buildLandConfigSelection,
      resolveLandConfig: landConfigMod.resolveLandConfig,
      createSummaryManager: summaryMod.createSummaryManager,
      summarizeSession: summaryMod.summarizeSession,
      estimateTokenCount: summaryMod.estimateTokenCount,
      throwIfAborted: summaryMod.throwIfAborted,
      sanitizeToolResultForSession: clientHelpersMod.sanitizeToolResultForSession,
    };
  })();
  return engineDepsPromise;
}
