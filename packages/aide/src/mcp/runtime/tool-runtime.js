import path from 'path';
import fs from 'fs';
import { performance } from 'perf_hooks';
import { extractTraceMeta } from '../../../shared/trace-utils.js';
import { resolveTerminalsDir } from '../../../shared/state-paths.js';
import { registerTool } from '../../tools/index.js';
import {
  getDefaultToolMaxTimeoutMs,
  getDefaultToolTimeoutMs,
  maybeForceUiPrompterTimeout as forceUiPrompterTimeout,
  parseTimeoutMs,
  shouldDisableToolTimeout,
  withNoTimeoutOptions,
} from './timeouts.js';
import { generateTaskId, normalizeAsyncTaskConfig, waitForUiPromptResult } from './async-tools.js';
import { buildCancelArgs, resolveCancelToolName } from './tool-cancel.js';
import { normalizeSessionId } from './identity-utils.js';
import { resolveMcpStreamTimeoutMs, shouldUseFinalStreamResult } from './stream-utils.js';
import { sleepWithSignal, throwIfAborted } from './async-utils.js';
import { extractContentText } from '../../../../common/mcp-content-utils.js';

function summarizeArgs(value) {
  if (value === null || value === undefined) {
    return { type: String(value) };
  }
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length };
  }
  const kind = typeof value;
  if (kind !== 'object') {
    return { type: kind };
  }
  const keys = Object.keys(value);
  return {
    type: 'object',
    keyCount: keys.length,
    keys: keys.slice(0, 20),
  };
}

function isMcpDisconnectedError(err) {
  const message = String(err?.message || err || '').toLowerCase();
  if (!message) return false;
  if (message.includes('not connected')) return true;
  if (message.includes('disconnected')) return true;
  if (message.includes('connection closed')) return true;
  return false;
}

function maybeInjectCallerArgs({ server, tool, args, toolContext }) {
  if (server !== 'task_manager') return args;
  if (tool !== 'add_task') return args;
  if (!args || typeof args !== 'object') return args;
  const normalizeCaller = (value) => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!normalized) return '';
    if (normalized === 'main') return 'main';
    if (normalized === 'sub' || normalized === 'subagent' || normalized === 'worker') return 'subagent';
    return '';
  };
  const caller = normalizeCaller(toolContext?.caller);
  if (!caller) return args;
  if (normalizeCaller(args.caller) === caller) return args;
  return { ...args, caller };
}

function buildToolIdentifier(serverName, toolName) {
  const normalize = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_');
  const server = normalize(serverName) || 'mcp_server';
  const tool = normalize(toolName) || 'tool';
  return `mcp_${server}_${tool}`;
}

function buildToolDescription(serverName, tool) {
  const parts = [];
  if (serverName) {
    parts.push(`[${serverName}]`);
  }
  if (tool.annotations?.title) {
    parts.push(tool.annotations.title);
  } else if (tool.description) {
    parts.push(tool.description);
  } else {
    parts.push('MCP 工具');
  }
  return parts.join(' ');
}

function formatCallResult(serverName, toolName, result) {
  if (!result) {
    return `[${serverName}/${toolName}] 工具未返回结果。`;
  }
  const header = `[${serverName}/${toolName}]`;
  if (result.isError) {
    const errorText = extractContentText(result.content) || 'MCP 工具执行失败。';
    return `${header} ❌ ${errorText}`;
  }
  const segments = [];
  const textBlock = extractContentText(result.content);
  if (textBlock) {
    segments.push(textBlock);
  }
  if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
    segments.push(JSON.stringify(result.structuredContent, null, 2));
  }
  if (segments.length === 0) {
    segments.push('工具执行成功，但没有可展示的文本输出。');
  }
  return `${header}\n${segments.join('\n\n')}`;
}

function normalizeWorkdir(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  return path.resolve(trimmed);
}

function applyUiAppWorkdirOverride(meta, workdir) {
  if (!meta || !workdir) return meta;
  const uiApp = meta?.chatos?.uiApp;
  if (!uiApp || typeof uiApp !== 'object') return meta;
  return {
    ...meta,
    workdir,
    chatos: {
      ...meta.chatos,
      uiApp: {
        ...uiApp,
        projectRoot: workdir,
        sessionRoot: '',
      },
    },
  };
}

function mergeTraceMeta(meta, traceMeta) {
  if (!traceMeta) return meta;
  const base = meta && typeof meta === 'object' ? { ...meta } : {};
  const chatos = base.chatos && typeof base.chatos === 'object' ? { ...base.chatos } : {};
  const existingTrace = chatos.trace && typeof chatos.trace === 'object' ? chatos.trace : {};
  chatos.trace = { ...existingTrace, ...traceMeta };
  return { ...base, chatos };
}

function buildCallMeta(serverEntry, runtimeMeta, toolContext) {
  const base = runtimeMeta && typeof runtimeMeta === 'object' ? { ...runtimeMeta } : null;
  const raw = serverEntry?.callMeta ?? serverEntry?.call_meta;
  const override = raw && typeof raw === 'object' ? { ...raw } : null;
  let merged = null;
  if (base && override) {
    merged = { ...base, ...override };
  } else if (base) {
    merged = { ...base };
  } else if (override) {
    merged = { ...override };
  }
  const contextWorkdir = normalizeWorkdir(toolContext?.workdir);
  const contextSessionId = normalizeSessionId(toolContext?.session?.sessionId);
  let next = merged;
  if (contextWorkdir) {
    const withWorkdir = next ? { ...next, workdir: contextWorkdir } : { workdir: contextWorkdir };
    next = applyUiAppWorkdirOverride(withWorkdir, contextWorkdir);
  }
  if (contextSessionId) {
    if (!next) {
      next = { sessionId: contextSessionId };
    } else if (!Object.prototype.hasOwnProperty.call(next, 'sessionId')) {
      next = { ...next, sessionId: contextSessionId };
    }
  }
  const contextToolCallId = normalizeSessionId(toolContext?.toolCallId);
  if (contextToolCallId) {
    const hasToolCallId =
      next &&
      (Object.prototype.hasOwnProperty.call(next, 'toolCallId') ||
        Object.prototype.hasOwnProperty.call(next, 'tool_call_id'));
    if (!next) {
      next = { toolCallId: contextToolCallId, tool_call_id: contextToolCallId };
    } else if (!hasToolCallId) {
      next = { ...next, toolCallId: contextToolCallId, tool_call_id: contextToolCallId };
    }
  }
  const traceMeta = extractTraceMeta(toolContext?.trace);
  if (traceMeta) {
    next = mergeTraceMeta(next, traceMeta);
  }
  return next;
}

export function buildRuntimeCallMeta({ workspaceRoot } = {}) {
  const root = normalizeWorkdir(workspaceRoot);
  if (!root) return null;
  return { workdir: root };
}

function buildRequestOptions(serverEntry) {
  const defaultTimeout = getDefaultToolTimeoutMs();
  const defaultMaxTimeout = getDefaultToolMaxTimeoutMs();
  const timeout = parseTimeoutMs(serverEntry?.timeout_ms, defaultTimeout);
  const maxTotal = parseTimeoutMs(
    serverEntry?.max_timeout_ms,
    defaultMaxTimeout,
    timeout || defaultTimeout
  );
  const options = {
    timeout,
    resetTimeoutOnProgress: true,
  };
  if (maxTotal && maxTotal >= timeout) {
    options.maxTotalTimeout = maxTotal;
  }
  return options;
}

async function callSubagentTool(client, requestOptions, name, args, options = {}) {
  const effectiveOptions =
    options?.signal && typeof options.signal === 'object'
      ? { ...requestOptions, signal: options.signal }
      : requestOptions;
  const meta = options?.meta && typeof options.meta === 'object' ? options.meta : null;
  const response = await client.callTool(
    { name, arguments: args, ...(meta ? { _meta: meta } : {}) },
    undefined,
    effectiveOptions
  );
  return parseJsonContent(response);
}

function extractSubagentJobResponse(result) {
  if (!result || typeof result !== 'object') {
    return '';
  }
  if (typeof result.response === 'string') {
    return result.response.trim();
  }
  if (Array.isArray(result.response)) {
    const joined = result.response
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && typeof entry.text === 'string') {
          return entry.text;
        }
        return '';
      })
      .join('');
    return joined.trim();
  }
  return '';
}

function parseJsonContent(result) {
  if (!result) return null;
  const text = extractContentText(result.content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function registerRemoteTool(
  client,
  serverEntry,
  tool,
  runtimeMeta,
  runtimeLogger,
  eventLogger,
  streamTracker,
  options = {}
) {
  const serverName = serverEntry?.name || 'server';
  const normalizedServer = String(serverName || '').toLowerCase();
  const reconnect = typeof options?.reconnect === 'function' ? options.reconnect : null;
  let activeClient = client;
  let activeStreamTracker = streamTracker;
  if (
    normalizedServer === 'subagent_router' &&
    (tool.name === 'get_sub_agent_status' ||
      tool.name === 'start_sub_agent_async' ||
      tool.name === 'cancel_sub_agent_job')
  ) {
    // Only used internally for async orchestration; not exposed to the model/toolset.
    return null;
  }
  const identifier = buildToolIdentifier(serverName, tool.name);
  const description = buildToolDescription(serverName, tool);
  const parameters =
    tool.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} };
  const requestOptions = buildRequestOptions(serverEntry);
  const availableTools = options?.availableTools;
  if (normalizedServer === 'subagent_router' && tool.name === 'run_sub_agent') {
    registerTool({
      name: identifier,
      description,
      parameters,
      handler: async (args = {}, toolContext = {}) => {
        const signal = toolContext?.signal;
        const callMeta = buildCallMeta(serverEntry, runtimeMeta, toolContext);
        const callerModel =
          typeof toolContext?.model === 'string' ? toolContext.model.trim() : '';
        const mergedArgs = {
          ...(args && typeof args === 'object' ? args : {}),
        };
        if (callerModel && !mergedArgs.caller_model) {
          mergedArgs.caller_model = callerModel;
        }
        let jobId = null;
        try {
          throwIfAborted(signal);
          const start = await callSubagentTool(
            client,
            requestOptions,
            'start_sub_agent_async',
            mergedArgs,
            { signal, meta: callMeta }
          );
          jobId = start?.job_id;
          if (!jobId) {
            const errMsg = start?.error ? `：${start.error}` : '：未返回 job_id';
            return `[${serverName}/run_sub_agent] ❌ 无法启动子代理${errMsg}`;
          }
          if (start?.status === 'error') {
            return `[${serverName}/run_sub_agent] ❌ job=${jobId} 启动失败：${start?.error || 'unknown error'}`;
          }
          const pollIntervalMs = 30_000;
          const maxTotalMs = requestOptions.maxTotalTimeout || getDefaultToolMaxTimeoutMs();
          let lastProgressMono = performance.now();
          let deadlineMono = lastProgressMono + maxTotalMs;
          let lastUpdatedAt = -Infinity;
          let lastPollWall = Date.now();
          let consecutiveErrors = 0;
          while (performance.now() < deadlineMono) {
            await sleepWithSignal(pollIntervalMs, signal);
            const nowWall = Date.now();
            const wallGapMs = nowWall - lastPollWall;
            lastPollWall = nowWall;
            // If the process was suspended (e.g., system sleep) or heavily delayed,
            // don't let wall-clock jumps trigger premature timeouts.
            if (wallGapMs > pollIntervalMs * 3) {
              lastProgressMono = performance.now();
              deadlineMono = lastProgressMono + maxTotalMs;
            }
            let status;
            try {
              status = await callSubagentTool(client, requestOptions, 'get_sub_agent_status', {
                job_id: jobId,
              }, { signal, meta: callMeta });
              consecutiveErrors = 0;
            } catch (err) {
              if (err?.name === 'AbortError') {
                throw err;
              }
              throwIfAborted(signal);
              consecutiveErrors += 1;
              if (consecutiveErrors >= 3) {
                throw err;
              }
              continue;
            }
            const state = status?.status;
            const updatedAt = status?.updated_at ? Date.parse(status.updated_at) : NaN;
            if (state === 'running' && Number.isFinite(updatedAt) && updatedAt > lastUpdatedAt) {
              lastUpdatedAt = updatedAt;
              lastProgressMono = performance.now();
              deadlineMono = lastProgressMono + maxTotalMs; // extend deadline when the job is still making progress
            }
            if (state === 'done') {
              const legacyReturn = process.env.MODEL_CLI_SUBAGENT_MCP_RETURN_JSON === '1';
              if (legacyReturn) {
                const resultText = status?.result
                  ? JSON.stringify(status.result, null, 2)
                  : JSON.stringify(status, null, 2);
                return `[${serverName}/run_sub_agent] ✅ 完成 (job=${jobId})\n${resultText}`;
              }
              const finalResponse = extractSubagentJobResponse(status?.result);
              if (finalResponse) {
                return finalResponse;
              }
              return status?.result
                ? JSON.stringify(status.result, null, 2)
                : JSON.stringify(status, null, 2);
            }
            if (state === 'error') {
              return `[${serverName}/run_sub_agent] ❌ job=${jobId} 失败：${status?.error || 'unknown error'}`;
            }
            throwIfAborted(signal);
          }
          return `[${serverName}/run_sub_agent] ❌ 等待超时 (job=${jobId})`;
        } catch (err) {
          if (err?.name === 'AbortError') {
            if (jobId) {
              try {
                const cancelTimeoutMs = 1500;
                const cancelOptions = {
                  ...requestOptions,
                  timeout: cancelTimeoutMs,
                  maxTotalTimeout: cancelTimeoutMs,
                  resetTimeoutOnProgress: false,
                };
                callSubagentTool(client, cancelOptions, 'cancel_sub_agent_job', { job_id: jobId }, { meta: callMeta }).catch(() => {});
              } catch {
                // ignore cancellation failures
              }
            }
            throw err;
          }
          return `[${serverName}/run_sub_agent] ❌ 轮询失败：${err?.message || err}`;
        }
      },
    });
    return { identifier, remoteName: tool.name };
  }
  registerTool({
    name: identifier,
    description,
    parameters,
    handler: async (args = {}, toolContext = {}) => {
      const effectiveOptions = shouldDisableToolTimeout(normalizedServer, tool.name)
        ? withNoTimeoutOptions(requestOptions)
        : requestOptions;
      const optionsWithSignal =
        toolContext?.signal && typeof toolContext.signal === 'object'
          ? { ...effectiveOptions, signal: toolContext.signal }
          : effectiveOptions;
      const injectedArgs = maybeInjectCallerArgs({
        server: normalizedServer,
        tool: tool.name,
        args,
        toolContext,
      });
      const normalizedArgs = forceUiPrompterTimeout({
        server: normalizedServer,
        tool: tool.name,
        args: injectedArgs,
      });
      const baseCallMeta = buildCallMeta(serverEntry, runtimeMeta, toolContext);
      const asyncTaskConfig = normalizeAsyncTaskConfig(baseCallMeta?.asyncTask, tool.name);
      const isAsyncTask = Boolean(asyncTaskConfig);
      const taskIdKey = asyncTaskConfig?.taskIdKey || '';
      let taskId = '';
      if (isAsyncTask) {
        const existingTaskId =
          taskIdKey && baseCallMeta && typeof baseCallMeta[taskIdKey] === 'string'
            ? baseCallMeta[taskIdKey].trim()
            : '';
        taskId = existingTaskId || generateTaskId({
          sessionId: toolContext?.session?.sessionId,
          serverName,
          toolName: tool.name,
        });
      }
      const resolveCallMeta = (useFinalStream) => {
        if (isAsyncTask) {
          return {
            ...(baseCallMeta || {}),
            ...(taskIdKey ? { [taskIdKey]: taskId } : null),
            stream: false,
          };
        }
        if (useFinalStream && (!baseCallMeta || !Object.prototype.hasOwnProperty.call(baseCallMeta, 'stream'))) {
          return { ...(baseCallMeta || {}), stream: true };
        }
        return baseCallMeta;
      };
      const cancelToolName = resolveCancelToolName(serverEntry, tool.name, availableTools);
      const cancelOptions = {
        timeout: 2000,
        maxTotalTimeout: 2000,
        resetTimeoutOnProgress: false,
      };
      let cancelSent = false;
      const sendCancel = () => {
        if (cancelSent || !cancelToolName) return;
        cancelSent = true;
        const cancelArgs = buildCancelArgs({
          callMeta: baseCallMeta,
          toolContext,
          args: normalizedArgs,
          taskId,
        });
        const cancelMeta = baseCallMeta && typeof baseCallMeta === 'object'
          ? { ...baseCallMeta, stream: false }
          : { stream: false };
        activeClient
          .callTool(
            {
              name: cancelToolName,
              arguments: cancelArgs,
              ...(cancelMeta ? { _meta: cancelMeta } : {}),
            },
            undefined,
            cancelOptions
          )
          .catch(() => {});
      };
      let cancelCleanup = null;
      if (cancelToolName && toolContext?.signal && typeof toolContext.signal.addEventListener === 'function') {
        const onAbort = () => sendCancel();
        toolContext.signal.addEventListener('abort', onAbort, { once: true });
        cancelCleanup = () => {
          try {
            toolContext.signal.removeEventListener('abort', onAbort);
          } catch {
            // ignore
          }
        };
      }
      const traceMeta = extractTraceMeta(toolContext?.trace);
      const logToolError = (err) => {
        runtimeLogger?.error(
          'MCP 工具调用失败',
          {
            server: serverName,
            tool: tool.name,
            caller: toolContext?.caller || '',
            args: summarizeArgs(normalizedArgs),
            trace: traceMeta || undefined,
          },
          err
        );
        eventLogger?.log?.('mcp_error', {
          stage: 'tool_call',
          server: serverName,
          tool: tool.name,
          caller: toolContext?.caller || '',
          args: summarizeArgs(normalizedArgs),
          message: err?.message || String(err),
          trace: traceMeta || undefined,
        });
      };
      const callToolOnce = async () => {
        const useFinalStream = activeStreamTracker && shouldUseFinalStreamResult(serverName, tool.name);
        const callMeta = resolveCallMeta(useFinalStream);
        const streamEnabled = !isAsyncTask && useFinalStream && callMeta?.stream !== false;
        let streamResultPromise = null;
        if (streamEnabled && typeof activeClient?._requestMessageId === 'number') {
          const rpcId = activeClient._requestMessageId;
          streamResultPromise = activeStreamTracker.waitForFinalText({
            rpcId,
            timeoutMs: resolveMcpStreamTimeoutMs(optionsWithSignal),
            signal: toolContext?.signal,
            sessionId: toolContext?.session?.sessionId,
            onAbort: sendCancel,
          });
        }
        const response = await activeClient.callTool(
          {
            name: tool.name,
            arguments: normalizedArgs,
            ...(callMeta ? { _meta: callMeta } : {}),
          },
          undefined,
          optionsWithSignal
        );
        return { response, streamResultPromise, callMeta };
      };
      let response;
      let streamResultPromise = null;
      let callMeta = resolveCallMeta(false);
      try {
        ({ response, streamResultPromise, callMeta } = await callToolOnce());
      } catch (err) {
        const aborted = err?.name === 'AbortError' || toolContext?.signal?.aborted;
        if (!aborted && isMcpDisconnectedError(err) && reconnect) {
          try {
            const handle = await reconnect({ reason: err });
            if (handle?.client) {
              activeClient = handle.client;
            }
            if (handle?.streamTracker) {
              activeStreamTracker = handle.streamTracker;
            }
            ({ response, streamResultPromise, callMeta } = await callToolOnce());
          } catch (retryErr) {
            logToolError(retryErr);
            throw retryErr;
          }
        } else {
          logToolError(err);
          throw err;
        }
      } finally {
        if (cancelCleanup) {
          cancelCleanup();
        }
      }
      if (isAsyncTask) {
        if (response?.isError) {
          return formatCallResult(serverName, tool.name, response);
        }
        if (asyncTaskConfig?.resultSource && asyncTaskConfig.resultSource !== 'ui_prompts') {
          return `[${serverName}/${tool.name}] ❌ 不支持的异步结果源: ${asyncTaskConfig.resultSource}`;
        }
        const asyncResult = await waitForUiPromptResult({
          taskId,
          config: asyncTaskConfig,
          callMeta,
          options: optionsWithSignal,
          signal: toolContext?.signal,
        });
        if (asyncResult.found) {
          const text = typeof asyncResult.text === 'string' ? asyncResult.text.trim() : '';
          return text || '（无结果内容）';
        }
        return `[${serverName}/${tool.name}] ❌ 等待交互待办结果超时 (taskId=${taskId || 'unknown'})`;
      }
      if (streamResultPromise) {
        try {
          const finalText = await streamResultPromise;
          if (typeof finalText === 'string' && finalText.trim()) {
            return finalText;
          }
        } catch {
          // ignore stream wait errors, fall back to call result
        }
      }
      return formatCallResult(serverName, tool.name, response);
    },
  });
  return { identifier, remoteName: tool.name };
}

export function appendRunPid({ runId, sessionRoot, pid, kind, name } = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const root = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : '';
  const num = Number(pid);
  if (!rid || !root || !Number.isFinite(num) || num <= 0) {
    return;
  }
  const dir = resolveTerminalsDir(root);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const pidsPath = path.join(dir, `${rid}.pids.jsonl`);
  const payload = {
    ts: new Date().toISOString(),
    runId: rid,
    pid: num,
    kind: typeof kind === 'string' && kind.trim() ? kind.trim() : 'process',
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
  };
  try {
    fs.appendFileSync(pidsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // ignore pid registry failures
  }
}
