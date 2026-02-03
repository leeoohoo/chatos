import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { adjustCommandArgs, parseMcpEndpoint } from './endpoints.js';
import { createMcpStreamTracker, registerMcpNotificationHandlers } from './stream-utils.js';
import { ensureUiAppNodeModules, isUiAppMcpServer } from './ui-app-utils.js';
import { resolveConfigHostApp } from '../../../shared/host-app.js';
import { ensureAppDbPath } from '../../../shared/state-paths.js';

function resolveMcpCommandLine(command, args, env) {
  const resolvedArgs = Array.isArray(args) ? args.slice() : [];
  const resolvedCommand = typeof command === 'string' ? command.trim() : '';
  if (!resolvedCommand) {
    return { command, args: resolvedArgs };
  }

  const normalizeBasename = (value) => {
    const text = String(value || '').trim().replace(/\\/g, '/');
    const base = text.split('/').pop() || '';
    return base.toLowerCase();
  };

  const isNodeBasename = (base) => base === 'node' || base === 'node.exe' || base === 'nodejs' || base === 'nodejs.exe';
  const isEnvBasename = (base) => base === 'env' || base === 'env.exe';

  const ensureElectronAsNode = () => {
    if (!process?.versions?.electron) return;
    if (env && typeof env === 'object') {
      env.ELECTRON_RUN_AS_NODE = env.ELECTRON_RUN_AS_NODE || '1';
    }
  };

  const resolveWithExecPath = (overrideArgs) => {
    const execPath = typeof process?.execPath === 'string' ? process.execPath.trim() : '';
    if (!execPath) return null;
    ensureElectronAsNode();
    return { command: execPath, args: Array.isArray(overrideArgs) ? overrideArgs : resolvedArgs };
  };

  const base = normalizeBasename(resolvedCommand);

  // Handle: cmd:///usr/bin/env node /path/server.js ...
  if (isEnvBasename(base) && resolvedArgs.length > 0) {
    const firstArgBase = normalizeBasename(resolvedArgs[0]);
    if (isNodeBasename(firstArgBase)) {
      const fallback = resolveWithExecPath(resolvedArgs.slice(1));
      if (fallback) return fallback;
    }
  }

  if (!isNodeBasename(base)) {
    return { command: resolvedCommand, args: resolvedArgs };
  }

  // If the config references an absolute system Node path and it exists, keep it.
  // Otherwise fall back to the current runtime (Electron's Node or the CLI's Node)
  // to avoid PATH/lookup issues.
  const isAbsoluteLike = (value) => {
    if (!value) return false;
    if (path.isAbsolute(value)) return true;
    return /^[a-zA-Z]:[\\/]/.test(value);
  };
  if (isAbsoluteLike(resolvedCommand)) {
    try {
      if (fs.existsSync(resolvedCommand)) {
        return { command: resolvedCommand, args: resolvedArgs };
      }
    } catch {
      // fall through to Electron runtime
    }
  }

  const fallback = resolveWithExecPath(resolvedArgs);
  if (fallback) return fallback;
  return { command: resolvedCommand, args: resolvedArgs };
}

async function fetchAllTools(client) {
  const collected = [];
  let cursor = null;
  do {
    // eslint-disable-next-line no-await-in-loop
    const result = await client.listTools(cursor ? { cursor } : undefined);
    if (Array.isArray(result?.tools)) {
      collected.push(...result.tools);
    }
    cursor = result?.nextCursor || null;
  } while (cursor);
  client.cacheToolMetadata(collected);
  return collected;
}

async function connectAndRegisterTools({
  entry,
  client,
  transport,
  sessionRoot,
  pidName,
  workspaceRoot,
  runtimeLogger,
  eventLogger,
  streamTracker,
  baseDir,
  runtimeOptions,
  deps = {},
} = {}) {
  const logger = deps?.log || console;
  if (!client || !transport) {
    throw new Error('Missing MCP client or transport');
  }
  if (transport && typeof transport === 'object') {
    transport.onclose = () => {
      logger.warn?.(`连接 ${entry?.name || '<unnamed>'} 已关闭`);
      runtimeLogger?.warn('MCP 连接已关闭', { server: entry?.name || '<unnamed>' });
      eventLogger?.log?.('mcp_disconnect', { server: entry?.name || '<unnamed>' });
    };
  }
  await client.connect(transport);
  const env = runtimeOptions?.env && typeof runtimeOptions.env === 'object' ? runtimeOptions.env : {};
  deps?.appendRunPid?.({
    runId: typeof env?.MODEL_CLI_RUN_ID === 'string' ? env.MODEL_CLI_RUN_ID.trim() : '',
    sessionRoot,
    pid: transport?.pid,
    kind: 'mcp',
    name: entry?.name || pidName,
  });
  const toolsFromServer = await fetchAllTools(client);
  if (toolsFromServer.length === 0) {
    logger.warn?.(`${entry?.name || '<unnamed>'} 未公开任何工具。`);
    runtimeLogger?.warn('MCP 未公开工具', { server: entry?.name || '<unnamed>' });
    eventLogger?.log?.('mcp_warning', {
      stage: 'no_tools',
      server: entry?.name || '<unnamed>',
      message: 'No tools exposed',
    });
  }
  const runtimeMeta = deps?.buildRuntimeCallMeta?.({ workspaceRoot });
  const normalizeToolName = deps?.normalizeToolName;
  const availableTools = new Map(
    toolsFromServer
      .map((tool) => ({
        raw: typeof tool?.name === 'string' ? tool.name.trim() : '',
      }))
      .filter((entry) => entry.raw)
      .map((entry) => [normalizeToolName ? normalizeToolName(entry.raw) : entry.raw, entry.raw])
  );
  let reconnectPromise = null;
  const reconnect = async ({ reason } = {}) => {
    if (!entry || !baseDir || !runtimeOptions) return null;
    if (reconnectPromise) return reconnectPromise;
    reconnectPromise = (async () => {
      const message = reason?.message || String(reason || '');
      runtimeLogger?.warn('MCP 连接中断，正在重连', {
        server: entry?.name || '<unnamed>',
        ...(message ? { message } : null),
      });
      try {
        const handle = await deps?.connectMcpServer?.(entry, baseDir, sessionRoot, workspaceRoot, runtimeOptions);
        if (!handle) {
          throw new Error('MCP reconnect returned null');
        }
        return handle;
      } catch (err) {
        runtimeLogger?.error('MCP 重连失败', { server: entry?.name || '<unnamed>' }, err);
        eventLogger?.log?.('mcp_error', {
          stage: 'reconnect',
          server: entry?.name || '<unnamed>',
          message: err?.message || String(err),
        });
        throw err;
      } finally {
        reconnectPromise = null;
      }
    })();
    return reconnectPromise;
  };
  const registeredTools = toolsFromServer
    .map((tool) =>
      deps?.registerRemoteTool?.(client, entry, tool, runtimeMeta, runtimeLogger, eventLogger, streamTracker, {
        reconnect,
        availableTools,
      })
    )
    .filter(Boolean);
  return { entry, client, transport, registeredTools, streamTracker };
}

export async function connectMcpServer(entry, baseDir, sessionRoot, workspaceRoot, runtimeOptions = {}) {
  const runtimeLogger = runtimeOptions?.runtimeLogger;
  const eventLogger = runtimeOptions?.eventLogger || null;
  const onNotification = typeof runtimeOptions?.onNotification === 'function' ? runtimeOptions.onNotification : null;
  const streamTracker = createMcpStreamTracker();
  const endpoint = parseMcpEndpoint(entry.url);
  if (!endpoint) {
    throw new Error('MCP 端点为空或无法解析。');
  }
  const baseEnv = runtimeOptions?.env && typeof runtimeOptions.env === 'object' ? runtimeOptions.env : {};

  const deps = {
    log: runtimeOptions?.log || console,
    appendRunPid: runtimeOptions?.appendRunPid,
    buildRuntimeCallMeta: runtimeOptions?.buildRuntimeCallMeta,
    normalizeToolName: runtimeOptions?.normalizeToolName,
    registerRemoteTool: runtimeOptions?.registerRemoteTool,
    connectMcpServer,
  };

  if (endpoint.type === 'command') {
    const configHostApp = resolveConfigHostApp({ env: baseEnv, fallbackHostApp: '' });
    const uiAppMeta = entry?.callMeta?.chatos?.uiApp;
    const hasUiAppMeta =
      Boolean(uiAppMeta?.pluginId) || Boolean(uiAppMeta?.appId) || Boolean(uiAppMeta?.dataDir);
    const isUiAppServer =
      hasUiAppMeta ||
      isUiAppMcpServer(entry, {
        endpoint,
        baseDir,
        sessionRoot,
        env: baseEnv,
        hostApp: configHostApp,
      });
    if (isUiAppServer) {
      ensureUiAppNodeModules(sessionRoot, runtimeLogger);
    }
    const client = new Client({
      name: 'model-cli',
      version: '0.1.0',
    });
    registerMcpNotificationHandlers(client, {
      serverName: entry?.name || '<unnamed>',
      onNotification,
      eventLogger,
      streamTracker,
    });
    // Inherit parent env so API keys are available to MCP servers (e.g., subagent_router using ModelClient)
    const env = { ...baseEnv };
    if (isUiAppServer && configHostApp) {
      env.MODEL_CLI_HOST_APP = configHostApp;
    }
    if (sessionRoot) {
      env.MODEL_CLI_SESSION_ROOT = sessionRoot;
    }
    if (workspaceRoot) {
      env.MODEL_CLI_WORKSPACE_ROOT = workspaceRoot;
    }
    if (runtimeOptions?.taskTable && typeof runtimeOptions.taskTable === 'string') {
      const tableName = runtimeOptions.taskTable.trim();
      if (tableName) {
        env.MODEL_CLI_TASK_TABLE = tableName;
      }
    }
    if (runtimeOptions?.taskScope && typeof runtimeOptions.taskScope === 'string') {
      const scope = runtimeOptions.taskScope.trim();
      if (scope) {
        env.MODEL_CLI_TASK_SCOPE = scope;
      }
    }
    // Ensure task-server writes to the app-scoped DB under session root,
    // regardless of where the CLI is launched.
    if (!env.MODEL_CLI_TASK_DB) {
      const stateRoot = env.MODEL_CLI_SESSION_ROOT || sessionRoot || process.cwd();
      env.MODEL_CLI_TASK_DB = ensureAppDbPath(stateRoot, { env });
    }
    if (runtimeOptions?.caller && typeof runtimeOptions.caller === 'string' && runtimeOptions.caller.trim()) {
      env.MODEL_CLI_CALLER = runtimeOptions.caller.trim();
    }
    if (entry.api_key_env) {
      const key = entry.api_key_env.trim();
      if (key && baseEnv[key]) {
        env[key] = baseEnv[key];
      }
    }
    const adjustedArgs = adjustCommandArgs(endpoint.args, workspaceRoot);
    const resolved = resolveMcpCommandLine(endpoint.command, adjustedArgs, env);
    const transport = new StdioClientTransport({
      command: resolved.command,
      args: resolved.args,
      cwd: baseDir,
      env,
      stderr: 'pipe',
    });
    const stderrLines = [];
    const maxStderrLines = 30;
    const maxStderrChars = 8000;
    let stderrChars = 0;
    let stderrBuffer = '';
    const pushStderrLine = (line) => {
      if (!line) return;
      if (stderrLines.length >= maxStderrLines) {
        stderrLines.shift();
      }
      const remaining = Math.max(0, maxStderrChars - stderrChars);
      const clipped = remaining > 0 ? String(line).slice(0, remaining) : '';
      if (!clipped) return;
      stderrLines.push(clipped);
      stderrChars += clipped.length;
    };
    const stderrStream = transport.stderr;
    if (stderrStream && typeof stderrStream.on === 'function') {
      stderrStream.on('data', (chunk) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
        stderrBuffer += text;
        while (true) {
          const idx = stderrBuffer.indexOf('\n');
          if (idx < 0) break;
          const line = stderrBuffer.slice(0, idx).trimEnd();
          stderrBuffer = stderrBuffer.slice(idx + 1);
          pushStderrLine(line.trim());
        }
        if (stderrBuffer.length > 2048) {
          // avoid unbounded buffer growth on noisy servers with no newlines
          pushStderrLine(stderrBuffer.slice(0, 2048).trim());
          stderrBuffer = '';
        }
      });
    }
    try {
      return await connectAndRegisterTools({
        entry,
        client,
        transport,
        sessionRoot,
        pidName: endpoint.command,
        workspaceRoot,
        runtimeLogger,
        eventLogger,
        streamTracker,
        baseDir,
        runtimeOptions,
        deps,
      });
    } catch (err) {
      const normalizedCommand = String(resolved.command || endpoint.command || '')
        .trim()
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .toLowerCase();
      const code = err?.code;
      const message = String(err?.message || err || '');
      const isNotFound =
        code === 'ENOENT' ||
        (message.includes('ENOENT') && message.toLowerCase().includes('spawn'));
      if (isNotFound) {
        if (normalizedCommand === 'npx' || normalizedCommand === 'npm') {
          throw new Error(
            `未找到 ${normalizedCommand}（${message}）。如果这是 npm MCP server，请先安装 Node.js（包含 npm/npx），并确保桌面 App 的 PATH 能找到它（Homebrew/Volta/asdf/nvm 等）。`
          );
        }
        throw new Error(`无法启动 MCP 命令：${resolved.command}（${message}）。请确认命令已安装且在 PATH 中。`);
      }
      const stderrTail = stderrLines.join('\n').trim();
      if (stderrTail) {
        throw new Error(`${message}\n\n[MCP stderr]\n${stderrTail}`);
      }
      throw err;
    }
  }

  if (endpoint.type === 'http') {
    const host = String(endpoint.url?.hostname || '').toLowerCase();
    const href = String(endpoint.url?.href || '');
    if (host === 'github.com' || host === 'raw.githubusercontent.com') {
      throw new Error(
        `看起来你配置的是 GitHub 链接（${href}），这通常不是 MCP 端点。若是 npm 包 MCP server，请用：cmd://npx -y <pkg>@latest（或直接填 npx 命令）。`
      );
    }
    const errors = [];
    try {
      const client = new Client({ name: 'model-cli', version: '0.1.0' });
      const transport = new StreamableHTTPClientTransport(endpoint.url);
      registerMcpNotificationHandlers(client, {
        serverName: entry?.name || '<unnamed>',
        onNotification,
        eventLogger,
        streamTracker,
      });
      return await connectAndRegisterTools({
        entry,
        client,
        transport,
        sessionRoot,
        workspaceRoot,
        runtimeLogger,
        eventLogger,
        streamTracker,
        baseDir,
        runtimeOptions,
        deps,
      });
    } catch (err) {
      errors.push(`streamable_http: ${err?.message || err}`);
    }
    try {
      const client = new Client({ name: 'model-cli', version: '0.1.0' });
      const transport = new SSEClientTransport(endpoint.url);
      registerMcpNotificationHandlers(client, {
        serverName: entry?.name || '<unnamed>',
        onNotification,
        eventLogger,
        streamTracker,
      });
      return await connectAndRegisterTools({
        entry,
        client,
        transport,
        sessionRoot,
        workspaceRoot,
        runtimeLogger,
        eventLogger,
        streamTracker,
        baseDir,
        runtimeOptions,
        deps,
      });
    } catch (err) {
      errors.push(`sse: ${err?.message || err}`);
    }
    throw new Error(`无法连接到 HTTP MCP 端点：${endpoint.url.href}（${errors.join(' | ')}）`);
  }

  if (endpoint.type === 'ws') {
    const client = new Client({ name: 'model-cli', version: '0.1.0' });
    const transport = new WebSocketClientTransport(endpoint.url);
    registerMcpNotificationHandlers(client, {
      serverName: entry?.name || '<unnamed>',
      onNotification,
      eventLogger,
      streamTracker,
    });
    return connectAndRegisterTools({
      entry,
      client,
      transport,
      sessionRoot,
      workspaceRoot,
      runtimeLogger,
      eventLogger,
      streamTracker,
      baseDir,
      runtimeOptions,
      deps,
    });
  }

  throw new Error(
    `不支持的 MCP 端点类型：${endpoint.type}（支持：cmd://、命令行、http(s)://、ws(s)://）`
  );
}
