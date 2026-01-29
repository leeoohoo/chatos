import path from 'path';

function normalizeDiffText(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function stripDiffPathPrefix(rawPath) {
  const value = String(rawPath || '').trim();
  if (!value) return '';
  if (value === '/dev/null') return value;
  if (value.startsWith('a/')) return value.slice(2);
  if (value.startsWith('b/')) return value.slice(2);
  return value;
}

function parseDiffBlockMeta(diffBlock) {
  const lines = normalizeDiffText(diffBlock).split('\n');
  let aPath = '';
  let bPath = '';
  for (const line of lines) {
    if (!aPath && line.startsWith('--- ')) {
      const [token] = line.slice(4).split(/\t+/);
      aPath = String(token || '').trim();
      continue;
    }
    if (!bPath && line.startsWith('+++ ')) {
      const [token] = line.slice(4).split(/\t+/);
      bPath = String(token || '').trim();
      continue;
    }
    if (aPath && bPath) break;
  }
  if (!aPath && !bPath) return null;
  const beforeExists = aPath !== '/dev/null';
  const afterExists = bPath !== '/dev/null';
  const picked = afterExists ? bPath : aPath;
  const relPath = stripDiffPathPrefix(picked);
  if (!relPath || relPath === '/dev/null') return null;
  return {
    relPath: relPath.replace(/\\/g, '/').replace(/^\.\/+/, ''),
    beforeExists,
    afterExists,
  };
}

function splitCombinedDiffIntoBlocks(diffText) {
  const normalized = normalizeDiffText(diffText);
  if (!normalized.trim()) return [];
  const lines = normalized.split('\n');
  const blocks = [];
  let current = [];
  let sawHeaderA = false;
  let sawHeaderB = false;

  const flush = () => {
    const joined = current.join('\n').trimEnd();
    if (joined.trim()) blocks.push(joined);
    current = [];
    sawHeaderA = false;
    sawHeaderB = false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : '';
    if (line.startsWith('diff --git ')) {
      flush();
    } else if (line.startsWith('--- ') && next.startsWith('+++ ') && sawHeaderA && sawHeaderB) {
      // Some diffs (e.g. synthetic untracked blocks) may be concatenated after git diff output.
      // A single file diff should only contain one header pair, so treat a second header as a new block.
      flush();
    }

    current.push(line);
    if (line.startsWith('--- ')) sawHeaderA = true;
    if (line.startsWith('+++ ')) sawHeaderB = true;
  }
  flush();
  return blocks;
}

export function isInsideWorkspaceRoot(workspaceRoot, targetPath) {
  const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
  if (!root) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

export async function logFileChangesFromDiff({ diffText, workspaceRoot, fsOps, tool, mode, userMessageId } = {}) {
  if (!fsOps || typeof fsOps.logFileChange !== 'function') return;
  const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
  if (!root) return;
  const blocks = splitCombinedDiffIntoBlocks(diffText);
  for (const block of blocks) {
    const meta = parseDiffBlockMeta(block);
    if (!meta?.relPath) continue;
    const absPath = path.resolve(root, meta.relPath);
    if (!isInsideWorkspaceRoot(root, absPath)) continue;
    // eslint-disable-next-line no-await-in-loop
    await fsOps.logFileChange({
      relPath: meta.relPath,
      absolutePath: absPath,
      before: { exists: meta.beforeExists, content: '' },
      after: { exists: meta.afterExists, content: '' },
      tool: tool || 'run_shell_command',
      mode: mode || 'shell',
      patchText: block,
      userMessageId,
    });
  }
}
