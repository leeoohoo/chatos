import path from 'path';
import { createLogger } from '../logger.js';
import { loadMcpConfig } from '../mcp.js';
import { mapAllSettledWithConcurrency, resolveConcurrency } from './runtime/concurrency.js';
import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../shared/host-app.js';
import { createRuntimeLogger } from '../../shared/runtime-log.js';
import { normalizeKey } from '../../shared/text-utils.js';
import { normalizeToolName } from './runtime/identity-utils.js';
import { connectMcpServer } from './runtime/server-connection.js';
import { appendRunPid, buildRuntimeCallMeta, registerRemoteTool } from './runtime/tool-runtime.js';

const log = createLogger('MCP');


async function initializeMcpRuntime(
  configPath,
  sessionRoot = process.cwd(),
  workspaceRoot = process.cwd(),
  options = {}
) {
  const runtimeLogger =
    options?.runtimeLogger ||
    createRuntimeLogger({
      sessionRoot,
      scope: 'MCP',
    });
  const eventLogger = options?.eventLogger || null;
  const hasInlineServers =
    options &&
    (Object.prototype.hasOwnProperty.call(options, 'servers') ||
      Object.prototype.hasOwnProperty.call(options, 'serverList'));
  const explicitBaseDir = typeof options?.baseDir === 'string' ? options.baseDir.trim() : '';
  let servers = [];
  let baseDir = '';
  let resolvedConfigPath = typeof configPath === 'string' ? configPath : '';
  if (hasInlineServers) {
    const inlineServers = Array.isArray(options?.servers)
      ? options.servers
      : Array.isArray(options?.serverList)
        ? options.serverList
        : [];
    servers = inlineServers;
    baseDir = explicitBaseDir || (resolvedConfigPath ? path.dirname(resolvedConfigPath) : process.cwd());
  } else {
    try {
      const loaded = loadMcpConfig(configPath);
      servers = loaded?.servers || [];
      resolvedConfigPath = typeof loaded?.path === 'string' ? loaded.path : resolvedConfigPath;
      baseDir = explicitBaseDir || (resolvedConfigPath ? path.dirname(resolvedConfigPath) : process.cwd());
    } catch (err) {
      log.error('读取 mcp.config.json 失败', err);
      runtimeLogger?.error('读取 mcp.config.json 失败', { configPath }, err);
      eventLogger?.log?.('mcp_error', {
        stage: 'load_config',
        path: configPath || '',
        message: err?.message || String(err),
      });
      return null;
    }
  }
  const extraServers = Array.isArray(options?.extraServers) ? options.extraServers : [];
  const mergedServers = (() => {
    const seen = new Set();
    const out = [];
    [...(Array.isArray(servers) ? servers : []), ...extraServers].forEach((entry) => {
      const key = normalizeKey(entry?.name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(entry);
    });
    return out;
  })();
  if (mergedServers.length === 0) return null;
  const allowExternalOnly = allowExternalOnlyMcpServers();
  const enabledServers = mergedServers.filter(
    (entry) => entry && entry.enabled !== false && (allowExternalOnly || !isExternalOnlyMcpServerName(entry.name))
  );
  const skip = new Set(
    Array.isArray(options.skipServers) ? options.skipServers.map((s) => normalizeKey(s)).filter(Boolean) : []
  );
  const filteredServers =
    skip.size > 0
      ? enabledServers.filter((entry) => !skip.has(normalizeKey(entry?.name)))
      : enabledServers;
  const baseDirResolved = baseDir || process.cwd();
  const connectTargets = filteredServers.filter((entry) => entry && entry.url);
  const startupConcurrency = resolveConcurrency(
    options?.mcpStartupConcurrency ?? process.env.MODEL_CLI_MCP_STARTUP_CONCURRENCY,
    4
  );
  const runtimeOptions = {
    ...options,
    runtimeLogger,
    eventLogger,
    registerRemoteTool,
    buildRuntimeCallMeta,
    normalizeToolName,
    appendRunPid,
    log,
  };
  const settled = await mapAllSettledWithConcurrency(connectTargets, startupConcurrency, (entry) =>
    connectMcpServer(entry, baseDirResolved, sessionRoot, workspaceRoot, runtimeOptions)
  );
  const handles = [];
  settled.forEach((result, idx) => {
    const entry = connectTargets[idx];
    if (!result) return;
    if (result.status === 'fulfilled') {
      if (result.value) handles.push(result.value);
      return;
    }
    log.warn(`无法连接到 ${entry?.name || '<unnamed>'}`, result.reason);
    runtimeLogger?.warn('无法连接到 MCP 服务器', { server: entry?.name || '<unnamed>' }, result.reason);
    eventLogger?.log?.('mcp_error', {
      stage: 'connect',
      server: entry?.name || '<unnamed>',
      message: result.reason?.message || String(result.reason || ''),
    });
  });
  if (handles.length === 0) {
    runtimeLogger?.warn('MCP 启动失败：未连接到任何服务器', {
      servers: connectTargets.map((entry) => entry?.name || '<unnamed>'),
    });
    eventLogger?.log?.('mcp_warning', {
      stage: 'startup',
      message: 'No MCP servers connected',
      servers: connectTargets.map((entry) => entry?.name || '<unnamed>'),
    });
    return null;
  }
  const toolNames = handles.flatMap((handle) =>
    handle.registeredTools.map((tool) => tool.identifier)
  );
  return {
    toolNames,
    applyToConfig: (appConfig) => {
      if (!appConfig || !appConfig.models || toolNames.length === 0) {
        return;
      }
      Object.values(appConfig.models).forEach((settings) => {
        if (!settings) return;
        const current = Array.isArray(settings.tools) ? settings.tools.slice() : [];
        let changed = false;
        for (const toolName of toolNames) {
          if (!current.includes(toolName)) {
            current.push(toolName);
            changed = true;
          }
        }
        if (changed) {
          settings.tools = current;
        }
      });
    },
    async shutdown() {
      await Promise.all(
        handles.map(async (handle) => {
          try {
            await handle.transport.close();
          } catch {
            // ignore
          }
        })
      );
    },
  };
}

export { initializeMcpRuntime };
