#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { clampNumber, parseArgs } from './cli-utils.js';
import { createPromptFileChangeConfirm } from './shell/prompt-file-change-confirm.js';
import { createDb } from '../shared/data/storage.js';
import { SettingsService } from '../shared/data/services/settings-service.js';
import { createFilesystemOps } from './filesystem/ops.js';
import { createSessionManager } from './shell/session-manager.js';
import { registerShellTools } from './shell/register-tools.js';
import { ensureAppDbPath, resolveFileChangesPath, resolveUiPromptsPath } from '../shared/state-paths.js';
import { resolveSessionRoot } from '../shared/session-root.js';
import { createToolResponder } from './shared/tool-helpers.js';
import { createMcpServer } from './shared/server-bootstrap.js';
import { ensureDir, ensureFileExists } from './shared/fs-utils.js';
import { resolveBoolFlag } from './shared/flags.js';
import { normalizeKey } from '../shared/text-utils.js';

const execAsync = promisify(exec);
const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

function normalizeShellSafetyMode(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  if (raw === 'relaxed' || raw === 'unsafe' || raw === 'loose') return 'relaxed';
  if (raw === 'strict' || raw === 'safe') return 'strict';
  return '';
}

function resolveShellSafetyMode({ explicitUnsafe, explicitMode, runtimeMode } = {}) {
  if (explicitUnsafe) return 'relaxed';
  if (explicitMode) return explicitMode;
  if (runtimeMode) return runtimeMode;
  return 'strict';
}

const root = path.resolve(args.root || process.cwd());
const serverName = args.name || 'shell_tasks';
// Default timeout raised to 5 minutes; can be adjusted via --timeout/--timeout-ms up to 15 minutes
const defaultTimeout = clampNumber(args.timeout || args['timeout-ms'], 1000, 15 * 60 * 1000, 5 * 60 * 1000);
let maxBuffer = clampNumber(args['max-buffer'], 1024 * 16, 8 * 1024 * 1024, 2 * 1024 * 1024);
const defaultShell =
  args.shell ||
  process.env.SHELL ||
  (process.platform === 'win32' ? process.env.COMSPEC || process.env.ComSpec || 'cmd.exe' : '/bin/bash');
const allowUnsafeShellFlag = resolveBoolFlag(
  args['allow-unsafe-shell'] ?? process.env.MODEL_CLI_ALLOW_UNSAFE_SHELL,
  false
);
const sessionRoot = resolveSessionRoot();
const sessions = createSessionManager({ execAsync, root, defaultShell, serverName, sessionRoot });
const promptLogPath =
  process.env.MODEL_CLI_UI_PROMPTS ||
  resolveUiPromptsPath(sessionRoot);
const fileChangeLogPath =
  process.env.MODEL_CLI_FILE_CHANGES ||
  resolveFileChangesPath(sessionRoot);
const adminDbPath =
  process.env.MODEL_CLI_TASK_DB ||
  ensureAppDbPath(sessionRoot);
const fsOps = createFilesystemOps({ root, serverName, fileChangeLogPath });
const { textResponse, structuredResponse } = createToolResponder({ serverName });

let settingsDb = null;
try {
  const db = createDb({ dbPath: adminDbPath });
  settingsDb = new SettingsService(db);
  settingsDb.ensureRuntime();
} catch {
  settingsDb = null;
}
const explicitMode = normalizeShellSafetyMode(args['shell-mode'] || process.env.MODEL_CLI_SHELL_SAFETY_MODE);
const runtimeMode = normalizeShellSafetyMode(settingsDb?.getRuntime?.()?.shellSafetyMode);
const runtimeMaxBuffer = clampNumber(
  settingsDb?.getRuntime?.()?.shellMaxBufferBytes,
  1024 * 16,
  50 * 1024 * 1024,
  null
);
if (Number.isFinite(runtimeMaxBuffer)) {
  maxBuffer = runtimeMaxBuffer;
}
const shellSafetyMode = resolveShellSafetyMode({
  explicitUnsafe: allowUnsafeShellFlag,
  explicitMode,
  runtimeMode,
});
const allowUnsafeShell = shellSafetyMode === 'relaxed';
const workspaceNote = [
  `Workspace root: ${root}.`,
  'The server checks literal path arguments to keep them inside this directory.',
  'This is not a sandbox.',
  shellSafetyMode === 'relaxed'
    ? 'Shell safety mode: relaxed (expansions allowed; weaker confinement).'
    : 'Shell safety mode: strict (expansions/variable substitutions blocked by default).',
].join(' ');

ensureFileExists(promptLogPath);
ensureFileExists(fileChangeLogPath);
ensureDir(root, { requireDirectory: true });
sessions.registerCleanupHandlers();

const { server, runId } = createMcpServer({ serverName, version: '0.1.0' });

const promptFileChangeConfirm = createPromptFileChangeConfirm({
  promptLogPath,
  serverName,
  runId,
  ensureFileExists,
  truncateForUi,
});

registerShellTools({
  server,
  z,
  serverName,
  workspaceNote,
  defaultTimeout,
  maxBuffer,
  defaultShell,
  execAsync,
  sessions,
  workspaceRoot: root,
  fsOps,
  ensurePath,
  safeStat,
  assertCommandPathsWithinRoot,
  clampNumber,
  shouldConfirmFileChanges,
  looksLikeFileMutationCommand,
  isSafeGitPreviewCommand,
  canPreviewGitDiff,
  getGitStatusPorcelain,
  getGitDiff,
  buildUntrackedPseudoDiff,
  rollbackGitWorkspace,
  promptFileChangeConfirm,
  normalizeEnv,
  formatCommandResult,
  textResponse,
  structuredResponse,
  truncateForUi,
  analyzeShellCommand,
  shellSafetyMode,
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${serverName}] MCP shell server ready (root=${root}).`);
}

main().catch((err) => {
  console.error('Shell server crashed:', err);
  sessions.triggerCleanup('startup_failure')
    .catch(() => {})
    .finally(() => process.exit(1));
});

async function ensurePath(relPath = '.') {
  return resolvePathWithinWorkspace(relPath, root);
}

function buildOutsideRootMessage(relPath) {
  return `Path "${relPath}" is outside the workspace root (${root}). Use literal paths inside this root or set cwd within it.`;
}

function assertCommandPathsWithinRoot(commandText, workingDir = root, shellPath = defaultShell) {
  if (!allowUnsafeShell) {
    const unsafe = detectUnsafeShellSyntax(commandText, shellPath);
    if (unsafe.length > 0) {
      const details = unsafe.join(', ');
      throw new Error(
        [
          'Command contains shell expansions that cannot be safely checked for workspace confinement.',
          `Detected: ${details}`,
          'Rewrite using literal paths inside the workspace root, or set MODEL_CLI_ALLOW_UNSAFE_SHELL=1 to bypass.',
        ].join('\n')
      );
    }
  }
  const tokens = splitCommandTokens(commandText, shellPath);
  if (tokens.length === 0) {
    return [];
  }
  const violations = [];
  const resolvedPaths = new Set();
  tokens.forEach((token, index) => {
    if (!token) return;
    const candidates = extractPathCandidates(token);
    const tokenIsCommand = isCommandToken(tokens, index);
    for (const candidate of candidates) {
      if (!looksLikePath(candidate)) continue;
      if (tokenIsCommand && isAllowedSystemBinary(candidate, tokenIsCommand)) {
        continue;
      }
      const resolved = resolveCandidateToAbsolute(candidate, workingDir);
      if (resolved?.error) {
        violations.push({ raw: candidate, resolved: resolved.error.message || '<unresolved>' });
        continue;
      }
      if (!resolved?.path) continue;
      if (!isInsideWorkspace(resolved.path)) {
        violations.push({ raw: candidate, resolved: resolved.path });
        continue;
      }
      resolvedPaths.add(resolved.path);
    }
  });
  if (violations.length > 0) {
    const seen = new Set();
    const blocked = [];
    for (const entry of violations) {
      const key = `${entry.raw}|${entry.resolved}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocked.push(`${entry.raw} -> ${entry.resolved}`);
    }
    const details = blocked.length > 0 ? blocked.join(', ') : '<unknown path>';
    throw new Error(
      [
        'Command contains path(s) outside the workspace root.',
        `Workspace root: ${root}`,
        `Blocked: ${details}`,
        'Use paths relative to the workspace or set cwd within it.',
      ].join('\n')
    );
  }
  return Array.from(resolvedPaths);
}

function resolveShellKind(shellPath) {
  const base = path.basename(String(shellPath || '')).toLowerCase();
  if (base === 'cmd.exe' || base === 'cmd') return 'cmd';
  if (base === 'powershell.exe' || base === 'powershell' || base === 'pwsh.exe' || base === 'pwsh') {
    return 'powershell';
  }
  return 'sh';
}

function detectUnsafeShellSyntax(commandText, shellPath = defaultShell) {
  const input = String(commandText || '');
  if (!input.trim()) return [];
  const shellKind = resolveShellKind(shellPath);
  const issues = new Set();

  if (shellKind === 'cmd') {
    if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(input)) {
      issues.add('cmd env expansion (%VAR%)');
    }
    if (/![A-Za-z_][A-Za-z0-9_]*!/.test(input)) {
      issues.add('cmd delayed expansion (!VAR!)');
    }
    return Array.from(issues);
  }

  let quote = null;
  let escape = false;
  const usesBackslashEscape = shellKind === 'sh';
  const usesBacktickEscape = shellKind === 'powershell';
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (usesBackslashEscape && char === '\\' && quote !== "'") {
      escape = true;
      continue;
    }
    if (usesBacktickEscape && char === '`' && quote !== "'") {
      escape = true;
      continue;
    }
    if (char === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'";
      continue;
    }
    if (char === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (quote === "'") continue;

    if (char === '$') {
      const next = input[i + 1];
      if (!next) continue;
      if (next === '(') {
        issues.add('command substitution ($())');
        continue;
      }
      if (next === '{') {
        issues.add('parameter expansion (${...})');
        continue;
      }
      if (/[A-Za-z0-9_?#!$*@-]/.test(next)) {
        issues.add('variable expansion ($VAR)');
        continue;
      }
    }
    if (shellKind !== 'powershell' && char === '`') {
      issues.add('command substitution (`...`)');
      continue;
    }
    if ((char === '<' || char === '>') && input[i + 1] === '(') {
      issues.add('process substitution (<(...))');
    }
  }
  return Array.from(issues);
}

function splitCommandTokens(input, shellPath = defaultShell) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escape = false;
  const shellKind = resolveShellKind(shellPath);
  const allowSemicolon = shellKind !== 'cmd';
  const escapeChar = shellKind === 'sh' ? '\\' : shellKind === 'powershell' ? '`' : '';
  const isSeparator = (char) =>
    char === '|' || char === '&' || char === '<' || char === '>' || (allowSemicolon && char === ';');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (escapeChar && char === escapeChar && quote !== "'") {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (isSeparator(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function extractPathCandidates(token) {
  if (!token) return [];
  const stripped = token.replace(/^[0-9]*[<>]+/, '');
  return stripped
    .split('=')
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikePath(value) {
  if (!value) return false;
  if (value.startsWith('-')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return false; // URL
  if (process.platform === 'win32') {
    if (value.startsWith('\\\\')) return true;
    if (/^[A-Za-z]:[\\/]/.test(value)) return true;
    if (value.startsWith('.\\') || value.startsWith('..\\')) return true;
    if (value.includes('\\')) return true;
  }
  return (
    value.startsWith('/') ||
    value.startsWith('~/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value === '..' ||
    value.includes('/') ||
    /^[^.]+\.[^./]+$/.test(value)
  );
}

function isCommandToken(tokens, index) {
  if (!Array.isArray(tokens) || index < 0 || index >= tokens.length) {
    return false;
  }
  for (let i = 0; i < index; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token === 'sudo' || token === 'env') continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) continue;
    return false;
  }
  return true;
}

function resolveCandidateToAbsolute(candidate, workingDir = root) {
  if (!candidate) return { path: null };
  try {
    const resolved = resolvePathWithinWorkspace(candidate, workingDir || root);
    return { path: resolved };
  } catch (err) {
    return { path: null, error: err };
  }
}

function isAllowedSystemBinary(target, isCommandPosition) {
  if (!isCommandPosition) {
    return false;
  }
  const normalized = path.resolve(target);
  if (process.platform === 'win32') {
    const systemRoot =
      typeof process.env.SystemRoot === 'string' && process.env.SystemRoot.trim()
        ? process.env.SystemRoot.trim()
        : 'C:\\Windows';
    const prefixes = [path.join(systemRoot, 'System32'), systemRoot].map((dir) => dir.replace(/[\\/]+$/, ''));
    return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`));
  }
  const prefixes = [
    '/bin',
    '/sbin',
    '/usr/bin',
    '/usr/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/opt/homebrew/bin',
  ].map((dir) => dir.replace(/\/+$/, ''));
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`));
}

function isInsideWorkspace(target) {
  const normalized = path.resolve(target);
  return normalized === root || normalized.startsWith(root + path.sep);
}

function resolvePathWithinWorkspace(rawPath, baseDir = root) {
  const raw = rawPath === undefined || rawPath === null ? '.' : rawPath;
  const base = isInsideWorkspace(baseDir) ? baseDir : root;
  let input = String(raw).trim();
  if (!input || input === '.') {
    return base;
  }

  input = expandHomePath(input);

  const isAbs = path.isAbsolute(input);
  if (isAbs) {
    const normalizedAbs = path.resolve(input);
    if (!isInsideWorkspace(normalizedAbs)) {
      throw new Error(buildOutsideRootMessage(rawPath));
    }
    return normalizedAbs;
  }

  const candidate = path.resolve(base, input);
  if (!isInsideWorkspace(candidate)) {
    throw new Error(buildOutsideRootMessage(rawPath));
  }
  return candidate;
}

function expandHomePath(value) {
  const raw = String(value || '');
  if (!raw.startsWith('~')) return raw;
  // Only expand "~" and "~/" (or "~\\"). Ignore "~user" style.
  if (raw !== '~' && !raw.startsWith('~/') && !raw.startsWith('~\\')) return raw;
  const home = os.homedir();
  if (!home) return raw;
  if (raw === '~') return home;
  const rest = raw.slice(2);
  return path.join(home, rest);
}

async function safeStat(target) {
  try {
    return await fs.promises.stat(target);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function normalizeEnv(input) {
  if (!input || typeof input !== 'object') {
    return {};
  }
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      output[key] = value;
    }
  }
  return output;
}

function formatCommandResult({ command, cwd, stdout, stderr, exitCode, signal, timedOut, elapsedMs, bytesReceived }) {
  const header = [`$ ${command}`, `cwd: ${cwd}`];
  if (exitCode !== null && exitCode !== undefined) {
    header.push(`exit code: ${exitCode}`);
  }
  if (signal) {
    header.push(`signal: ${signal}`);
  }
  if (timedOut) {
    header.push('timed out');
  }
  if (Number.isFinite(Number(elapsedMs))) {
    header.push(`elapsed: ${Math.max(0, Math.round(Number(elapsedMs)))}ms`);
  }
  if (Number.isFinite(Number(bytesReceived)) && Number(bytesReceived) > 0) {
    header.push(`bytes: ${Math.round(Number(bytesReceived))}`);
  }
  const divider = '-'.repeat(40);
  const stdoutBlock = stdout ? `STDOUT:\n${stdout}` : 'STDOUT: <empty>';
  const stderrBlock = stderr ? `STDERR:\n${stderr}` : 'STDERR: <empty>';
  return `${header.join(' | ')}\n${divider}\n${stdoutBlock}\n\n${stderrBlock}`;
}

function shouldConfirmFileChanges() {
  try {
    const runtime = settingsDb?.getRuntime?.();
    if (!runtime) return false;
    return runtime.confirmFileChanges === true;
  } catch {
    return false;
  }
}

function looksLikeFileMutationCommand(commandText) {
  const cmd = String(commandText || '').trim();
  if (!cmd) return false;
  const lower = cmd.toLowerCase();
  if (lower.includes('>') || lower.includes('>>') || lower.includes('| tee ')) return true;
  return /\b(rm|mv|cp|touch|mkdir|rmdir|sed|perl|python|node|deno)\b/.test(lower);
}

function analyzeShellCommand(commandText = '') {
  const cmd = String(commandText || '');
  const lower = cmd.toLowerCase();
  const warnings = [];
  const usesPipe = /\|/.test(lower);
  const usesRedirect = />|<|>>/.test(lower);
  const usesBackground = /\s&\s*$/.test(lower) || /(^|\s)nohup\s/.test(lower);
  const usesSudo = /(^|\s)sudo(\s|$)/.test(lower);
  const dangerous =
    /\brm\s+-rf\s+\/(\s|$)/.test(lower) ||
    /\bmkfs(\.| )/.test(lower) ||
    /\bdd\s+if=/.test(lower) ||
    /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(lower);
  if (usesPipe) {
    warnings.push('检测到管道符 (|)，注意输出可能被进一步处理。');
  }
  if (usesRedirect) {
    warnings.push('检测到重定向符号 (> / >> / <)，注意可能覆盖文件。');
  }
  if (usesBackground) {
    warnings.push('检测到后台执行 (&/nohup)，建议使用 session_run 管理长任务。');
  }
  if (usesSudo) {
    warnings.push('检测到 sudo，注意权限与安全风险。');
  }
  if (/\b(cat|find|rg|grep)\b/.test(lower) && !/(\|\s*(head|tail)\b|-m\s*\d+)/.test(lower)) {
    warnings.push('命令可能产生大输出，建议用 head/tail 或限制匹配条数。');
  }
  if (dangerous) {
    warnings.push('检测到高风险命令模式（如 rm -rf / 或低级磁盘操作）。');
  }
  return {
    usesPipe,
    usesRedirect,
    usesBackground,
    usesSudo,
    dangerous,
    warnings,
  };
}

function isSafeGitPreviewCommand(commandText) {
  const cmd = normalizeKey(commandText);
  if (!cmd) return false;
  if (cmd.startsWith('git ') || cmd === 'git') return false;
  if (/\bgit\s+/.test(cmd)) return false;
  if (cmd.startsWith('npm ') || cmd.startsWith('pnpm ') || cmd.startsWith('yarn ')) return false;
  return true;
}

async function canPreviewGitDiff(workingDir) {
  const cwd = workingDir || root;
  try {
    const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', {
      cwd,
      timeout: 4000,
      maxBuffer: 512 * 1024,
      shell: defaultShell,
    });
    if (!normalizeKey(stdout).includes('true')) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    const { stdout } = await execAsync('git status --porcelain', {
      cwd,
      timeout: 4000,
      maxBuffer: 512 * 1024,
      shell: defaultShell,
    });
    return !String(stdout || '').trim();
  } catch {
    return false;
  }
}

async function getGitStatusPorcelain(workingDir) {
  const cwd = workingDir || root;
  try {
    const { stdout } = await execAsync('git status --porcelain', {
      cwd,
      timeout: 6000,
      maxBuffer: 1024 * 1024,
      shell: defaultShell,
    });
    return String(stdout || '');
  } catch {
    return '';
  }
}

async function getGitDiff(workingDir) {
  const cwd = workingDir || root;
  try {
    const { stdout } = await execAsync('git diff --no-color', {
      cwd,
      timeout: 8000,
      maxBuffer: 8 * 1024 * 1024,
      shell: defaultShell,
    });
    return String(stdout || '');
  } catch {
    return '';
  }
}

function parseUntrackedFilesFromStatus(statusText) {
  const lines = String(statusText || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const out = [];
  lines.forEach((line) => {
    if (!line.startsWith('?? ')) return;
    const rel = line.slice(3).trim();
    if (rel) out.push(rel);
  });
  return out;
}

async function buildUntrackedPseudoDiff(workingDir, statusText) {
  const cwd = workingDir || root;
  const files = parseUntrackedFilesFromStatus(statusText).slice(0, 5);
  if (files.length === 0) return '';
  const parts = [];
  for (const rel of files) {
    const abs = path.resolve(cwd, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      continue;
    }
    let content = '';
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      content = truncateForUi(raw, 12_000);
    } catch {
      content = '<binary or unreadable>';
    }
    const lines = String(content || '').split('\n');
    const hunk = lines.map((l) => `+${l}`).join('\n');
    parts.push(`--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${hunk}`);
  }
  return parts.join('\n\n');
}

async function rollbackGitWorkspace(workingDir) {
  const cwd = workingDir || root;
  try {
    await execAsync('git checkout -- .', {
      cwd,
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      shell: defaultShell,
    });
  } catch {
    // ignore
  }
  try {
    await execAsync('git clean -fd', {
      cwd,
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      shell: defaultShell,
    });
  } catch {
    // ignore
  }
}

function truncateForUi(text, maxChars) {
  const value = typeof text === 'string' ? text : text == null ? '' : String(text);
  const limit = Number.isFinite(Number(maxChars)) ? Number(maxChars) : 60_000;
  if (limit <= 0) return value;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n... (truncated ${value.length - limit} chars)`;
}

function printHelp() {
  console.log(
    [
      'Usage: node shell-server.js [--root <path>] [--timeout <ms>] [--max-buffer <bytes>]',
      '',
      'Options:',
      '  --root <path>       Workspace root; all commands are restricted within this directory',
      '  --timeout <ms>      Default command timeout (1000-900000 ms, default 300000)',
      '  --max-buffer <b>    Max STDOUT/STDERR buffer (min 16KB, default 2MB)',
      '  --shell <path>      Optional shell override',
      '  --allow-unsafe-shell  Allow shell expansions/variable substitution (weakens path checks)',
      '  --shell-mode <strict|relaxed>  Safety mode override (default strict)',
      '  --name <id>         MCP server name',
      '  --help              Show help',
    ].join('\n')
  );
}
