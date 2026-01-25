import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { resolveEngineRoot } from './engine-paths.js';

export function resolveEngineModule({ projectRoot, engineRoot, relativePath, allowMissing = false } = {}) {
  const root =
    typeof engineRoot === 'string' && engineRoot.trim()
      ? engineRoot.trim()
      : resolveEngineRoot({ projectRoot });
  if (!root) {
    throw new Error('Engine sources not found (expected ./packages/aide relative to chatos).');
  }
  const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!rel) {
    throw new Error('relativePath is required');
  }
  const srcPath = path.join(root, 'src', rel);
  if (fs.existsSync(srcPath)) return srcPath;
  const distPath = path.join(root, 'dist', rel);
  if (fs.existsSync(distPath) || allowMissing) return distPath;
  throw new Error(`Engine module not found: ${rel}`);
}

export async function importEngineModule(options) {
  const filePath = resolveEngineModule(options);
  return await import(pathToFileURL(filePath).href);
}
