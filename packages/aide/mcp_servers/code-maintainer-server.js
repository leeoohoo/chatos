#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { clampNumber, parseArgs } from './cli-utils.js';
import { createDb } from '../shared/data/storage.js';
import { SettingsService } from '../shared/data/services/settings-service.js';
import { createFilesystemOps, resolveSessionRoot } from './filesystem/ops.js';
import { registerFilesystemTools } from './filesystem/register-tools.js';
import { ensureAppDbPath, resolveFileChangesPath } from '../shared/state-paths.js';
import { createToolResponder } from './shared/tool-helpers.js';
import { createMcpServer } from './shared/server-bootstrap.js';
import { ensureDir } from './shared/fs-utils.js';
import { booleanFromArg, resolveBoolFlag } from './shared/flags.js';
import { normalizeSymlinkPolicy } from '../shared/runtime-settings-utils.js';

const fsp = fs.promises;

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const root = path.resolve(args.root || process.cwd());
const allowWrites = booleanFromArg(args.write) || /write/i.test(String(args.mode || ''));
const serverName = args.name || 'code_maintainer';
let maxFileBytes = clampNumber(args['max-bytes'], 1024, 50 * 1024 * 1024, 256 * 1024);
let maxWriteBytes = clampNumber(args['max-write-bytes'], 1024, 100 * 1024 * 1024, 5 * 1024 * 1024);
const searchLimit = clampNumber(args['max-search-results'], 1, 200, 40);
const workspaceNote = `Workspace root: ${root}. Paths must stay inside this directory; absolute or relative paths resolving outside will be rejected.`;

ensureDir(root, { readable: true, writable: allowWrites });

const sessionRoot = resolveSessionRoot();
const fileChangeLogPath =
  process.env.MODEL_CLI_FILE_CHANGES || resolveFileChangesPath(sessionRoot);
const adminDbPath = process.env.MODEL_CLI_TASK_DB || ensureAppDbPath(sessionRoot);

let settingsDb = null;
try {
  const db = createDb({ dbPath: adminDbPath });
  settingsDb = new SettingsService(db);
  settingsDb.ensureRuntime();
} catch {
  settingsDb = null;
}

const runtimeConfig = settingsDb?.getRuntime?.() || null;
const symlinkPolicy = normalizeSymlinkPolicy(runtimeConfig?.filesystemSymlinkPolicy, { allowAliases: true });
const allowSymlinkEscape =
  symlinkPolicy === 'deny'
    ? false
    : resolveBoolFlag(process.env.MODEL_CLI_ALLOW_SYMLINK_ESCAPE, true);
const runtimeMaxFileBytes = clampNumber(runtimeConfig?.filesystemMaxFileBytes, 1024, 50 * 1024 * 1024, null);
if (Number.isFinite(runtimeMaxFileBytes)) {
  maxFileBytes = runtimeMaxFileBytes;
}
const runtimeMaxWriteBytes = clampNumber(runtimeConfig?.filesystemMaxWriteBytes, 1024, 100 * 1024 * 1024, null);
if (Number.isFinite(runtimeMaxWriteBytes)) {
  maxWriteBytes = runtimeMaxWriteBytes;
}

const { server } = createMcpServer({ serverName, version: '0.1.0' });
const { textResponse, structuredResponse } = createToolResponder({ serverName });

function logProgress(message) {
  console.error(`[${serverName}] ${message}`);
}

const fsOps = createFilesystemOps({
  root,
  serverName,
  fileChangeLogPath,
  logProgress,
  allowSymlinkEscape,
});

registerFilesystemTools({
  server,
  z,
  serverName,
  workspaceNote,
  allowWrites,
  root,
  maxFileBytes,
  maxWriteBytes,
  searchLimit,
  fsOps,
  logProgress,
});

registerCodeMaintenanceTools({
  server,
  z,
  fsOps,
  allowWrites,
  maxFileBytes,
  workspaceNote,
  logProgress,
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${serverName}] MCP code maintainer server ready (root=${root}, writes=${allowWrites ? 'on' : 'off'}).`);
}

main().catch((err) => {
  console.error(`[${serverName}] crashed:`, err);
  process.exit(1);
});

function registerCodeMaintenanceTools({
  server,
  z,
  fsOps,
  allowWrites,
  maxFileBytes,
  workspaceNote,
  logProgress,
} = {}) {
  if (!server) throw new Error('Missing MCP server');
  if (!z) throw new Error('Missing zod');
  if (!fsOps) throw new Error('Missing filesystem ops');

  const safeMaxFileBytes = clampNumber(maxFileBytes, 1024, 1024 * 1024, 256 * 1024);
  const note = typeof workspaceNote === 'string' ? workspaceNote : '';

  const { ensurePath, relativePath, logFileChange } = fsOps;

  server.registerTool(
    'read_file_raw',
    {
      title: 'Read file (raw)',
      description: ['Return UTF-8 file content without line numbers.', note].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
      }),
    },
    async ({ path: filePath }) => {
      const target = await ensurePath(filePath);
      const stats = await safeStat(target);
      if (!stats || !stats.isFile()) {
        throw new Error('Target file does not exist or is not a regular file.');
      }
      if (stats.size > safeMaxFileBytes) {
        throw new Error(`File too large (${formatBytes(stats.size)}), exceeds limit ${formatBytes(safeMaxFileBytes)}.`);
      }
      const buffer = await fsp.readFile(target);
      if (isBinaryBuffer(buffer)) {
        throw new Error('Target appears to be a binary file; read_file_raw only supports UTF-8 text.');
      }
      const content = buffer.toString('utf8');
      const rel = relativePath(target);
      const sha256 = hashContent(content);
      return structuredResponse(content, {
        path: rel,
        sha256,
        size_bytes: stats.size,
      });
    }
  );

  server.registerTool(
    'read_file_range',
    {
      title: 'Read file (line range)',
      description: [
        'Return UTF-8 content from start_line to end_line (1-based, inclusive).',
        `File size is limited by --max-bytes (${formatBytes(safeMaxFileBytes)} by default).`,
        note,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        start_line: z.number().int().min(1).describe('Start line (1-based, inclusive)'),
        end_line: z.number().int().min(1).describe('End line (1-based, inclusive)'),
        with_line_numbers: z.boolean().optional().describe('Prefix each line with its line number'),
      }),
    },
    async ({ path: filePath, start_line: startLine, end_line: endLine, with_line_numbers: withLineNumbers }) => {
      const target = await ensurePath(filePath);
      const stats = await safeStat(target);
      if (!stats || !stats.isFile()) {
        throw new Error('Target file does not exist or is not a regular file.');
      }
      if (stats.size > safeMaxFileBytes) {
        throw new Error(`File too large (${formatBytes(stats.size)}), exceeds limit ${formatBytes(safeMaxFileBytes)}.`);
      }
      const buffer = await fsp.readFile(target);
      if (isBinaryBuffer(buffer)) {
        throw new Error('Target appears to be a binary file; read_file_range only supports UTF-8 text.');
      }
      const content = buffer.toString('utf8');
      const lines = content.split(/\r?\n/);
      const totalLines = lines.length;
      const start = clampNumber(startLine, 1, totalLines, 1);
      const end = clampNumber(endLine, 1, totalLines, totalLines);
      if (start > end) {
        throw new Error(`Invalid range: start_line (${start}) must be <= end_line (${end}).`);
      }
      const extracted = lines.slice(start - 1, end);
      const rendered = withLineNumbers
        ? extracted.map((line, idx) => `${(start + idx).toString().padStart(6, ' ')} | ${line}`).join('\n')
        : extracted.join('\n');
      const rel = relativePath(target);
      const header = `# ${rel} (lines ${start}-${end} of ${totalLines})`;
      return structuredResponse(`${header}\n\n${rendered}`, {
        path: rel,
        start_line: start,
        end_line: end,
        total_lines: totalLines,
      });
    }
  );

  server.registerTool(
    'stat_path',
    {
      title: 'Stat path',
      description: ['Return basic info for a file/directory under the workspace root.', note].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('Path relative to root'),
      }),
    },
    async ({ path: targetPath }) => {
      const target = await ensurePath(targetPath);
      const stats = await safeStat(target);
      const rel = relativePath(target);
      if (!stats) {
        return structuredResponse(`✗ Not found: ${rel}`, { exists: false, path: rel });
      }

      const isFile = stats.isFile();
      const isDir = stats.isDirectory();
      const type = isFile ? 'file' : isDir ? 'directory' : 'other';
      const payload = {
        exists: true,
        path: rel,
        type,
        size_bytes: stats.size,
        mtime: stats.mtime?.toISOString?.() || null,
      };

      if (isFile && stats.size <= safeMaxFileBytes) {
        try {
          const content = await fsp.readFile(target, { encoding: 'utf8' });
          payload.sha256 = hashContent(content);
        } catch {
          // ignore hashing errors
        }
      }

      const summary = `✓ ${rel} (${type}${isFile ? `, ${formatBytes(stats.size)}` : ''})`;
      return structuredResponse(summary, payload);
    }
  );

  if (!allowWrites) {
    return;
  }

  server.registerTool(
    'move_path',
    {
      title: 'Move/rename path',
      description: ['Move or rename a file/directory within the workspace root.', note].join('\n'),
      inputSchema: z.object({
        from: z.string().describe('Source path relative to root'),
        to: z.string().describe('Destination path relative to root'),
        overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default false)'),
      }),
    },
    async ({ from, to, overwrite }) => {
      const overwriteDest = Boolean(overwrite);
      const fromAbs = await ensurePath(from);
      const toAbs = await ensurePath(to);
      const fromRel = relativePath(fromAbs);
      const toRel = relativePath(toAbs);

      const fromStats = await safeStat(fromAbs);
      if (!fromStats) {
        throw new Error(`Source not found: ${fromRel}`);
      }

      const toStats = await safeStat(toAbs);
      if (toStats && !overwriteDest) {
        throw new Error(`Destination already exists: ${toRel} (set overwrite=true to replace)`);
      }

      if (toStats && overwriteDest) {
        await fsp.rm(toAbs, { recursive: true, force: true });
      }

      await fsp.mkdir(path.dirname(toAbs), { recursive: true });

      try {
        await fsp.rename(fromAbs, toAbs);
      } catch (err) {
        if (err && err.code === 'EXDEV') {
          await fsp.cp(fromAbs, toAbs, { recursive: true, force: overwriteDest });
          await fsp.rm(fromAbs, { recursive: true, force: true });
        } else {
          throw err;
        }
      }

      const patchText = `*** Begin Patch\n*** Update File: ${fromRel}\n*** Move to: ${toRel}\n*** End Patch\n`;
      await logFileChange?.({
        relPath: fromRel,
        absolutePath: fromAbs,
        before: { exists: true, content: '' },
        after: { exists: false, content: '' },
        tool: 'move_path',
        mode: overwriteDest ? 'move_overwrite' : 'move',
        patchText,
      });
      await logFileChange?.({
        relPath: toRel,
        absolutePath: toAbs,
        before: { exists: false, content: '' },
        after: { exists: true, content: '' },
        tool: 'move_path',
        mode: overwriteDest ? 'move_overwrite' : 'move',
        patchText,
      });

      logProgress?.(`Moved ${fromRel} -> ${toRel}`);
      return structuredResponse(`✓ Moved ${fromRel} -> ${toRel}`, {
        status: 'ok',
        from: fromRel,
        to: toRel,
        overwrite: overwriteDest,
      });
    }
  );

  server.registerTool(
    'copy_path',
    {
      title: 'Copy path',
      description: ['Copy a file/directory within the workspace root.', note].join('\n'),
      inputSchema: z.object({
        from: z.string().describe('Source path relative to root'),
        to: z.string().describe('Destination path relative to root'),
        overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default false)'),
      }),
    },
    async ({ from, to, overwrite }) => {
      const overwriteDest = Boolean(overwrite);
      const fromAbs = await ensurePath(from);
      const toAbs = await ensurePath(to);
      const fromRel = relativePath(fromAbs);
      const toRel = relativePath(toAbs);

      const fromStats = await safeStat(fromAbs);
      if (!fromStats) {
        throw new Error(`Source not found: ${fromRel}`);
      }

      const toStats = await safeStat(toAbs);
      if (toStats && !overwriteDest) {
        throw new Error(`Destination already exists: ${toRel} (set overwrite=true to replace)`);
      }

      await fsp.mkdir(path.dirname(toAbs), { recursive: true });
      await fsp.cp(fromAbs, toAbs, { recursive: true, force: overwriteDest });

      const patchText = `*** Begin Patch\n*** Add File: ${toRel}\n+<copied from ${fromRel}>\n*** End Patch\n`;
      await logFileChange?.({
        relPath: toRel,
        absolutePath: toAbs,
        before: { exists: Boolean(toStats), content: '' },
        after: { exists: true, content: '' },
        tool: 'copy_path',
        mode: overwriteDest ? 'copy_overwrite' : 'copy',
        patchText,
      });

      logProgress?.(`Copied ${fromRel} -> ${toRel}`);
      return structuredResponse(`✓ Copied ${fromRel} -> ${toRel}`, {
        status: 'ok',
        from: fromRel,
        to: toRel,
        overwrite: overwriteDest,
      });
    }
  );
}

function safeStat(target) {
  return fsp
    .stat(target)
    .catch((err) => {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    });
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return 'n/a';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]} (${bytes} B)`;
}

function isBinaryBuffer(buffer, sampleSize = 512) {
  if (!buffer) return false;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length === 0) return false;
  const sample = buf.length > sampleSize ? buf.subarray(0, sampleSize) : buf;
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function printHelp() {
  console.log(
    [
      'Usage: node code-maintainer-server.js [--root <path>] [--write] [--name <id>] [--max-bytes <n>]',
      '',
      'Options:',
      '  --root <path>            MCP root (default current directory)',
      '  --write                  Enable write/delete tools',
      '  --mode <read|write>      Compatibility flag; write == --write',
      '  --name <id>              MCP server name (for logging)',
      '  --max-bytes <n>          Max bytes to read per file (default 256KB)',
      '  --max-write-bytes <n>    Max bytes to write per operation (default 5MB)',
      '  --max-search-results <n> Max search hits to return (default 40)',
      '  --help                   Show help',
    ].join('\n')
  );
}
