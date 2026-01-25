import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createJsonlLogger, resolveToolLogPath } from './logging.js';
import { patchMcpServer } from './tool-helpers.js';

export function resolveRunId(env = process.env) {
  return typeof env.MODEL_CLI_RUN_ID === 'string' ? env.MODEL_CLI_RUN_ID.trim() : '';
}

export function resolveToolLogger({ env = process.env, runId } = {}) {
  const toolLogPath = resolveToolLogPath(env);
  const toolLogLevel =
    typeof env.MODEL_CLI_MCP_LOG_LEVEL === 'string' ? env.MODEL_CLI_MCP_LOG_LEVEL.trim().toLowerCase() : '';
  const resolvedRunId = typeof runId === 'string' ? runId.trim() : resolveRunId(env);
  const logger =
    toolLogPath && toolLogLevel !== 'off'
      ? createJsonlLogger({
          filePath: toolLogPath,
          maxBytes: env.MODEL_CLI_MCP_TOOL_LOG_MAX_BYTES,
          maxLines: env.MODEL_CLI_MCP_TOOL_LOG_MAX_LINES,
          maxFieldChars: env.MODEL_CLI_MCP_TOOL_LOG_MAX_FIELD_CHARS,
          runId: resolvedRunId,
        })
      : null;
  return { logger, runId: resolvedRunId, toolLogPath, toolLogLevel };
}

export function createMcpServer({ serverName, version = '0.1.0', env = process.env, runId } = {}) {
  const resolvedName = typeof serverName === 'string' ? serverName : String(serverName ?? 'mcp_server');
  const { logger, runId: resolvedRunId, toolLogPath, toolLogLevel } = resolveToolLogger({ env, runId });
  const server = new McpServer({
    name: resolvedName,
    version,
  });
  patchMcpServer(server, { serverName: resolvedName, logger });
  return { server, runId: resolvedRunId, toolLogger: logger, toolLogPath, toolLogLevel, serverName: resolvedName };
}
