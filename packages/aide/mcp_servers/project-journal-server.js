#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { clampNumber, parseArgs } from './cli-utils.js';
import { safeTrim } from '../shared/text-utils.js';
import { resolveAppStateDir, STATE_FILE_NAMES } from '../shared/state-paths.js';
import { resolveSessionRoot as resolveSessionRootCore } from '../shared/session-root.js';
import { createToolResponder } from './shared/tool-helpers.js';
import { createMcpServer } from './shared/server-bootstrap.js';
import { ensureDir, ensureFileExists } from './shared/fs-utils.js';
import {
  createDedupeStore,
  readDedupeEntry,
  writeDedupeEntry,
  removeDedupeEntry,
  flushDedupeStore,
} from './shared/dedupe-store.js';
import { buildDedupeKey } from './shared/dedupe-utils.js';
import { createWriteQueue } from './shared/write-queue.js';

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const envWorkspaceRoot = safeTrim(process.env.MODEL_CLI_WORKSPACE_ROOT);
const envSessionRoot = safeTrim(process.env.MODEL_CLI_SESSION_ROOT);
const argSessionRoot = safeTrim(args.root);
const sessionRoot =
  envWorkspaceRoot || envSessionRoot || argSessionRoot || resolveSessionRootCore({ preferCwd: true });
const explicitSessionRoot = Boolean(envWorkspaceRoot || envSessionRoot || argSessionRoot);
const resolveEnv = envWorkspaceRoot
  ? { ...process.env, MODEL_CLI_SESSION_ROOT: envWorkspaceRoot }
  : process.env;
const root = resolveAppStateDir(sessionRoot, { preferSessionRoot: explicitSessionRoot, env: resolveEnv });
const serverName = args.name || 'project_journal';
const { textResponse, structuredResponse } = createToolResponder({ serverName });
const execLogPath = resolveStorePath(
  args['exec-log'] || args.exec_log || args.execLog,
  STATE_FILE_NAMES.projectExecLog
);
const projectInfoPath = resolveStorePath(
  args['project-info'] || args.project_info || args.projectInfo,
  STATE_FILE_NAMES.projectInfo
);
const journalDedupeStorePath =
  process.env.MODEL_CLI_PROJECT_JOURNAL_DEDUPE ||
  path.join(path.dirname(execLogPath), 'project-journal-dedupe.json');
const journalDedupeStore = createDedupeStore({
  filePath: journalDedupeStorePath,
  maxEntries: 5000,
  ttlMs: 30 * 24 * 60 * 60 * 1000,
  maxIdsPerKey: 20,
});
const enqueueJournalWrite = createWriteQueue();

ensureDir(root, { requireDirectory: true });
ensureFileExists(execLogPath, '');
ensureJsonFileExists(projectInfoPath, defaultProjectInfo());

const { server } = createMcpServer({ serverName, version: '0.1.0' });

registerTools();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[${serverName}] MCP project journal server ready (logs=${relativePath(execLogPath)}, info=${relativePath(projectInfoPath)}).`
  );
}

main().catch((err) => {
  console.error(`[${serverName}] crashed:`, err);
  process.exit(1);
});

function registerTools() {
  server.registerTool(
    'add_exec_log',
    {
      title: 'Add execution log',
      description: [
        'Record a per-project execution log entry (what was done, changed files, key changes).',
        'A title will be generated as: "<timestamp> #tag1 #tag2" unless you provide a custom title.',
        'Example: {"tag":"feat","summary":"Add project journal MCP","files":["mcp_servers/project-journal-server.js"],"highlights":["New MCP server","Added default prompt"],"next_steps":["Run smoke tests"]}',
      ].join('\n'),
      inputSchema: z.object({
        tag: z.string().optional().describe('Primary label (also included in the title), e.g. "feat/auth"'),
        tags: z.array(z.string()).optional().describe('Additional labels/tags'),
        title: z.string().optional().describe('Optional custom title'),
        summary: z.string().min(1).describe('What was done (concise)'),
        details: z.string().optional().describe('More context / rationale (optional)'),
        files: z.array(z.string()).optional().describe('Changed/added files (relative paths)'),
        highlights: z.array(z.string()).optional().describe('Key changes / additions'),
        next_steps: z.array(z.string()).optional().describe('Suggested next steps'),
        dedupe_key: z.string().optional().describe('Optional idempotency key to dedupe repeated calls'),
        runId: z.string().optional().describe('Run ID (optional; defaults to current run)'),
        sessionId: z.string().optional().describe('Session ID (optional; defaults to current session)'),
      }),
    },
    async (input) => {
      const result = await enqueueJournalWrite(() => {
        const runId = pickRunId(input?.runId);
        const sessionId = pickSessionId(input?.sessionId);
        const dedupeKey = buildDedupeKey(input?.dedupe_key, {
          scope: 'exec_log',
          runId,
          sessionId,
        });
        if (dedupeKey) {
          const existing = readDedupeEntry(journalDedupeStore, dedupeKey);
          if (existing) {
            const resolved = resolveExecLogFromIds(existing.ids);
            if (resolved) {
              writeDedupeEntry(journalDedupeStore, dedupeKey, [resolved.id]);
              flushDedupeStore(journalDedupeStore);
              return { entry: resolved, deduped: true };
            }
            removeDedupeEntry(journalDedupeStore, dedupeKey);
          }
        }

        const ts = new Date().toISOString();
        const entry = {
          id: crypto.randomUUID(),
          ts,
          title: '',
          tags: normalizeTags(input?.tags, input?.tag),
          summary: safeTrim(input?.summary),
          details: typeof input?.details === 'string' ? input.details : '',
          files: normalizeStringArray(input?.files),
          highlights: normalizeStringArray(input?.highlights),
          nextSteps: normalizeStringArray(input?.next_steps),
          runId,
          sessionId,
        };
        entry.title = safeTrim(input?.title) || buildDefaultTitle(ts, entry.tags);

        appendJsonl(execLogPath, entry);
        if (dedupeKey) {
          writeDedupeEntry(journalDedupeStore, dedupeKey, [entry.id]);
        }
        flushDedupeStore(journalDedupeStore);
        return { entry, deduped: false };
      });

      const header = result.deduped ? 'Execution log already recorded (deduped)' : 'Execution log recorded';
      return structuredResponse(renderExecLogSummary(result.entry, header), {
        status: result.deduped ? 'noop' : 'ok',
        entry: result.entry,
        deduped: result.deduped === true,
      });
    }
  );

  server.registerTool(
    'list_exec_logs',
    {
      title: 'List execution logs',
      description: [
        'List the most recent execution logs (newest first).',
        'Filters: tag (exact) and query (substring search across title/summary/details).',
        'Example: {"limit":10} or {"tag":"feat","limit":5} or {"query":"mcp","limit":20}',
      ].join('\n'),
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional().describe('Max items to return (default 10)'),
        tag: z.string().optional().describe('Filter by tag (exact match)'),
        query: z.string().optional().describe('Search substring across title/summary/details/highlights'),
      }),
    },
    async ({ limit, tag, query } = {}) => {
      const capped = clampNumber(limit, 1, 200, 10);
      const logs = listExecLogs({ limit: capped, tag, query });
      return structuredResponse(formatExecLogList(logs), {
        status: 'ok',
        logs: logs.map((e) => ({
          id: e.id,
          ts: e.ts,
          title: e.title,
          tags: e.tags || [],
          summary: e.summary || '',
        })),
      });
    }
  );

  server.registerTool(
    'get_exec_log',
    {
      title: 'Get execution log',
      description: 'Get a specific execution log entry by id.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Execution log id'),
      }),
    },
    async ({ id }) => {
      const entry = findExecLogById(id);
      if (!entry) {
        return structuredResponse(`Execution log not found (id=${id}).`, { status: 'not_found', id });
      }
      return structuredResponse(renderExecLogDetail(entry), { status: 'ok', entry });
    }
  );

  server.registerTool(
    'search_exec_logs',
    {
      title: 'Search execution logs',
      description: 'Search execution logs by substring (title/summary/details/highlights).',
      inputSchema: z.object({
        query: z.string().min(1).describe('Search keyword (substring, case-insensitive)'),
        tag: z.string().optional().describe('Optional tag filter (exact match)'),
        limit: z.number().int().min(1).max(200).optional().describe('Max items to return (default 20)'),
      }),
    },
    async ({ query, tag, limit } = {}) => {
      const capped = clampNumber(limit, 1, 200, 20);
      const logs = listExecLogs({ limit: capped, tag, query });
      return structuredResponse(formatExecLogList(logs), {
        status: 'ok',
        logs: logs.map((e) => ({
          id: e.id,
          ts: e.ts,
          title: e.title,
          tags: e.tags || [],
          summary: e.summary || '',
        })),
      });
    }
  );

  server.registerTool(
    'get_project_info',
    {
      title: 'Get project info',
      description:
        'Read per-project notes (background, summary, git URL, key configs, iteration notes).',
      inputSchema: z.object({
        include_iterations: z.boolean().optional().describe('Include iteration entries (default true)'),
        iterations_limit: z.number().int().min(0).max(50).optional().describe('Max iteration items (default 10)'),
      }),
    },
    async ({ include_iterations: includeIterations, iterations_limit: iterationsLimit } = {}) => {
      const info = readProjectInfo();
      const payload = projectInfoForOutput(info, { includeIterations, iterationsLimit });
      return structuredResponse(renderProjectInfoText(payload), { status: 'ok', info: payload });
    }
  );

  server.registerTool(
    'set_project_info',
    {
      title: 'Set/update project info',
      description: [
        'Create or update the per-project info note (rarely-changing notes).',
        'Default behavior is MERGE (only provided fields are updated).',
        'Use overwrite=true to reset unspecified fields back to empty defaults.',
      ].join('\n'),
      inputSchema: z.object({
        summary: z.string().optional().describe('One-paragraph project summary'),
        background: z.string().optional().describe('Project background/context'),
        git_url: z.string().optional().describe('Git remote URL'),
        main_config: z.string().optional().describe('Key configs / entry points / important paths'),
        notes: z.string().optional().describe('Other stable notes'),
        tags: z.array(z.string()).optional().describe('Project tags'),
        overwrite: z.boolean().optional().describe('If true, reset unspecified fields (default false)'),
      }),
    },
    async (input) => {
      const updated = await enqueueJournalWrite(() => writeProjectInfo(input, { overwrite: input?.overwrite === true }));
      const payload = projectInfoForOutput(updated, { includeIterations: true, iterationsLimit: 10 });
      return structuredResponse('Project info saved.', { status: 'ok', info: payload });
    }
  );

  server.registerTool(
    'add_project_iteration',
    {
      title: 'Add project iteration note',
      description: 'Append a lightweight iteration/changelog entry into project info.',
      inputSchema: z.object({
        title: z.string().min(1).describe('Iteration title, e.g. "v0.2: MCP servers"'),
        summary: z.string().optional().describe('Short iteration summary'),
        details: z.string().optional().describe('Longer details (optional)'),
        tags: z.array(z.string()).optional().describe('Tags for this iteration'),
        dedupe_key: z.string().optional().describe('Optional idempotency key to dedupe repeated calls'),
      }),
    },
    async (input) => {
      const result = await enqueueJournalWrite(() => {
        const dedupeKey = buildDedupeKey(input?.dedupe_key, { scope: 'iteration' });
        if (dedupeKey) {
          const existing = readDedupeEntry(journalDedupeStore, dedupeKey);
          if (existing) {
            const resolved = resolveIterationFromIds(existing.ids);
            if (resolved) {
              writeDedupeEntry(journalDedupeStore, dedupeKey, [resolved.id]);
              flushDedupeStore(journalDedupeStore);
              return { iteration: resolved, deduped: true, info: readProjectInfo() };
            }
            removeDedupeEntry(journalDedupeStore, dedupeKey);
          }
        }

        const info = readProjectInfo();
        const now = new Date().toISOString();
        const entry = {
          id: crypto.randomUUID(),
          ts: now,
          title: safeTrim(input?.title),
          summary: safeTrim(input?.summary),
          details: typeof input?.details === 'string' ? input.details : '',
          tags: normalizeTags(input?.tags),
        };
        const iterations = Array.isArray(info.iterations) ? info.iterations.slice() : [];
        iterations.unshift(entry);
        const next = {
          ...info,
          iterations,
          updatedAt: now,
          createdAt: info.createdAt || now,
          version: 1,
        };
        atomicWriteJson(projectInfoPath, next);
        if (dedupeKey) {
          writeDedupeEntry(journalDedupeStore, dedupeKey, [entry.id]);
        }
        flushDedupeStore(journalDedupeStore);
        return { iteration: entry, deduped: false, info: next };
      });
      const payload = projectInfoForOutput(result.info, { includeIterations: true, iterationsLimit: 10 });
      const message = result.deduped ? 'Project iteration already saved (deduped).' : 'Project iteration saved.';
      return structuredResponse(message, {
        status: result.deduped ? 'noop' : 'ok',
        iteration: result.iteration,
        info: payload,
        deduped: result.deduped === true,
      });
    }
  );
}

function buildDefaultTitle(ts, tags) {
  const tagText = tags && tags.length > 0 ? ` #${tags.join(' #')}` : '';
  return `${ts}${tagText}`;
}

function renderExecLogSummary(entry, header = '') {
  const parts = [];
  if (header) parts.push(header);
  parts.push(entry.title);
  parts.push(`id=${entry.id}`);
  if (entry.summary) parts.push(`summary: ${entry.summary}`);
  if (entry.files && entry.files.length > 0) parts.push(`files: ${entry.files.join(', ')}`);
  if (entry.highlights && entry.highlights.length > 0) parts.push(`highlights: ${entry.highlights.join(' | ')}`);
  if (entry.nextSteps && entry.nextSteps.length > 0) parts.push(`next: ${entry.nextSteps.join(' | ')}`);
  return parts.join('\n');
}

function renderExecLogDetail(entry) {
  const tagText = entry.tags && entry.tags.length > 0 ? `#${entry.tags.join(' #')}` : '<none>';
  const renderBlockList = (items) => {
    if (!items || items.length === 0) return ' <empty>';
    return `\n  - ${items.join('\n  - ')}`;
  };
  const lines = [
    entry.title || '<untitled>',
    `id: ${entry.id}`,
    `ts: ${entry.ts || '<unknown>'}`,
    `tags: ${tagText}`,
    `runId: ${entry.runId || '<unspecified>'}`,
    `sessionId: ${entry.sessionId || '<unspecified>'}`,
    '',
    `summary: ${entry.summary || '<empty>'}`,
    entry.details ? `details:\n${entry.details}` : 'details: <empty>',
    '',
    `files:${renderBlockList(entry.files)}`,
    '',
    `highlights:${renderBlockList(entry.highlights)}`,
    '',
    `next_steps:${renderBlockList(entry.nextSteps)}`,
  ];
  return lines.join('\n');
}

function formatExecLogList(logs) {
  if (!logs || logs.length === 0) {
    return 'No execution logs yet. Use add_exec_log to record one.';
  }
  return logs
    .map((e, idx) => {
      const tagText = e.tags && e.tags.length > 0 ? ` #${e.tags.join(' #')}` : '';
      const title = e.title || `${e.ts || '<unknown>'}${tagText}`;
      const summary = e.summary ? ` - ${e.summary}` : '';
      return `${String(idx + 1).padStart(2, ' ')}. ${title}${summary} (id=${e.id})`;
    })
    .join('\n');
}

function listExecLogs({ limit, tag, query } = {}) {
  const capped = clampNumber(limit, 1, 200, 10);
  const q = safeTrim(query).toLowerCase();
  const tagFilter = safeTrim(tag);
  const all = readExecLogs();
  const result = [];
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const entry = all[i];
    if (!entry || typeof entry !== 'object') continue;
    if (tagFilter) {
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      if (!tags.includes(tagFilter)) continue;
    }
    if (q) {
      if (!matchesExecLogQuery(entry, q)) continue;
    }
    result.push(entry);
    if (result.length >= capped) break;
  }
  return result;
}

function matchesExecLogQuery(entry, queryLower) {
  const fields = [
    typeof entry.title === 'string' ? entry.title : '',
    typeof entry.summary === 'string' ? entry.summary : '',
    typeof entry.details === 'string' ? entry.details : '',
    Array.isArray(entry.highlights) ? entry.highlights.join(' ') : '',
    Array.isArray(entry.files) ? entry.files.join(' ') : '',
  ];
  return fields.some((text) => text.toLowerCase().includes(queryLower));
}

function findExecLogById(id) {
  const target = safeTrim(id);
  if (!target) return null;
  const all = readExecLogs();
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const entry = all[i];
    if (entry && typeof entry === 'object' && entry.id === target) {
      return entry;
    }
  }
  return null;
}

function readExecLogs() {
  try {
    if (!fs.existsSync(execLogPath)) return [];
    const raw = fs.readFileSync(execLogPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line && line.trim().length > 0);
    const result = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
          result.push(parsed);
        }
      } catch {
        // ignore parse errors
      }
    }
    return result;
  } catch {
    return [];
  }
}

function appendJsonl(filePath, payload) {
  ensureFileExists(filePath, '');
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function defaultProjectInfo() {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    summary: '',
    background: '',
    gitUrl: '',
    mainConfig: '',
    notes: '',
    tags: [],
    iterations: [],
  };
}

function readProjectInfo() {
  const fallback = defaultProjectInfo();
  try {
    if (!fs.existsSync(projectInfoPath)) {
      return fallback;
    }
    const raw = fs.readFileSync(projectInfoPath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      ...fallback,
      ...parsed,
      version: 1,
      tags: normalizeTags(parsed?.tags),
      iterations: Array.isArray(parsed?.iterations) ? parsed.iterations : [],
    };
  } catch {
    return fallback;
  }
}

function writeProjectInfo(input, { overwrite } = {}) {
  const now = new Date().toISOString();
  const prev = readProjectInfo();
  const base = overwrite ? defaultProjectInfo() : prev;
  const patch = normalizeProjectInfoPatch(input);
  const next = {
    ...base,
    ...patch,
    version: 1,
    createdAt: base.createdAt || prev.createdAt || now,
    updatedAt: now,
  };
  if (!Array.isArray(next.iterations)) {
    next.iterations = [];
  }
  if (!Array.isArray(next.tags)) {
    next.tags = [];
  }
  atomicWriteJson(projectInfoPath, next);
  return next;
}

function normalizeProjectInfoPatch(input) {
  const patch = {};
  if (!input || typeof input !== 'object') return patch;
  if (typeof input.summary === 'string') patch.summary = input.summary;
  if (typeof input.background === 'string') patch.background = input.background;
  if (typeof input.git_url === 'string') patch.gitUrl = input.git_url;
  if (typeof input.main_config === 'string') patch.mainConfig = input.main_config;
  if (typeof input.notes === 'string') patch.notes = input.notes;
  if (Array.isArray(input.tags)) patch.tags = normalizeTags(input.tags);
  return patch;
}

function projectInfoForOutput(info, { includeIterations, iterationsLimit } = {}) {
  const include = includeIterations !== false;
  const limit = clampNumber(iterationsLimit, 0, 50, 10);
  const iterations = include
    ? (Array.isArray(info.iterations) ? info.iterations.slice(0, limit) : [])
    : [];
  return {
    version: 1,
    createdAt: info.createdAt || '',
    updatedAt: info.updatedAt || '',
    summary: info.summary || '',
    background: info.background || '',
    gitUrl: info.gitUrl || '',
    mainConfig: info.mainConfig || '',
    notes: info.notes || '',
    tags: Array.isArray(info.tags) ? info.tags : [],
    iterations,
  };
}

function renderProjectInfoText(info) {
  const lines = [
    'Project info',
    `Updated: ${info.updatedAt || '<unknown>'}`,
    info.gitUrl ? `Git: ${info.gitUrl}` : 'Git: <empty>',
    info.tags && info.tags.length > 0 ? `Tags: #${info.tags.join(' #')}` : 'Tags: <empty>',
    '',
    info.summary ? `Summary:\n${info.summary}` : 'Summary: <empty>',
    '',
    info.background ? `Background:\n${info.background}` : 'Background: <empty>',
    '',
    info.mainConfig ? `Main config:\n${info.mainConfig}` : 'Main config: <empty>',
    '',
    info.notes ? `Notes:\n${info.notes}` : 'Notes: <empty>',
  ];
  if (info.iterations && info.iterations.length > 0) {
    lines.push('', 'Iterations (latest first):');
    info.iterations.forEach((it) => {
      const tagText = it.tags && it.tags.length > 0 ? ` #${it.tags.join(' #')}` : '';
      const summary = it.summary ? ` - ${it.summary}` : '';
      lines.push(`- ${it.ts || '<unknown>'} ${it.title || '<untitled>'}${summary}${tagText} (id=${it.id})`);
    });
  }
  return lines.join('\n');
}

function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  ensureDir(dir, { requireDirectory: true });
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const content = `${JSON.stringify(obj, null, 2)}\n`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
      fs.renameSync(tmp, filePath);
    } catch (err2) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw err2;
    }
  }
}

function ensureJsonFileExists(filePath, defaultObject) {
  try {
    if (fs.existsSync(filePath)) return;
  } catch {
    // ignore
  }
  try {
    atomicWriteJson(filePath, defaultObject);
  } catch {
    // ignore
  }
}

function relativePath(target) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..')) {
    return target;
  }
  return rel;
}

function resolveStorePath(rawValue, defaultRelPath) {
  const raw = safeTrim(rawValue) || defaultRelPath;
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Store path must stay inside root: ${raw}`);
  }
  return resolved;
}

function pickSessionId(candidate) {
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  if (normalized) return normalized;
  const fromEnv = typeof process.env.MODEL_CLI_SESSION_ID === 'string' ? process.env.MODEL_CLI_SESSION_ID.trim() : '';
  return fromEnv || '';
}

function pickRunId(candidate) {
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  if (normalized) return normalized;
  const fromEnv = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
  return fromEnv || '';
}

function normalizeTags(tags, extraTag) {
  const out = [];
  const push = (value) => {
    const normalized = safeTrim(value);
    if (!normalized) return;
    if (!out.includes(normalized)) out.push(normalized);
  };
  if (Array.isArray(tags)) {
    tags.forEach((t) => push(t));
  } else if (typeof tags === 'string') {
    push(tags);
  }
  push(extraTag);
  return out;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  value.forEach((item) => {
    const normalized = safeTrim(item);
    if (!normalized) return;
    if (!out.includes(normalized)) out.push(normalized);
  });
  return out;
}

function resolveExecLogFromIds(ids) {
  const list = Array.isArray(ids) ? ids : [];
  for (const id of list) {
    const entry = findExecLogById(id);
    if (entry) return entry;
  }
  return null;
}

function resolveIterationFromIds(ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) return null;
  const info = readProjectInfo();
  const iterations = Array.isArray(info.iterations) ? info.iterations : [];
  for (const id of list) {
    const match = iterations.find((entry) => entry?.id === id);
    if (match) return match;
  }
  return null;
}

function printHelp() {
  console.log(
    [
      'Usage: node project-journal-server.js [--root <path>] [--name <id>] [--exec-log <path>] [--project-info <path>]',
      '',
      'Options:',
      '  --root <path>          Legacy session root hint (fallback when MODEL_CLI_SESSION_ROOT is not set)',
      '  --name <id>            MCP server name (default project_journal)',
      `  --exec-log <path>      Exec log JSONL path (default ${STATE_FILE_NAMES.projectExecLog} under per-app stateDir)`,
      `  --project-info <path>  Project info JSON path (default ${STATE_FILE_NAMES.projectInfo} under per-app stateDir)`,
      '  --help                 Show help',
    ].join('\n')
  );
}
