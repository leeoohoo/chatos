import fs from 'fs';
import path from 'path';

export function resolveCliEntrypointPath({ baseProjectRoot, preferSrc = false } = {}) {
  const baseRoot = typeof baseProjectRoot === 'string' && baseProjectRoot.trim()
    ? baseProjectRoot.trim()
    : process.cwd();
  const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  if (resources) {
    const asarPath = path.join(resources, 'app.asar');
    try {
      if (fs.existsSync(asarPath)) {
        const distCandidate = path.join(asarPath, 'dist', 'cli.js');
        if (fs.existsSync(distCandidate)) return distCandidate;
        const srcCandidate = path.join(asarPath, 'src', 'cli.js');
        if (fs.existsSync(srcCandidate)) return srcCandidate;
      }
    } catch {
      // ignore
    }
  }

  const srcLocal = path.join(baseRoot, 'src', 'cli.js');
  const distLocal = path.join(baseRoot, 'dist', 'cli.js');
  if (preferSrc) {
    try {
      if (fs.existsSync(srcLocal)) return srcLocal;
    } catch {
      // ignore
    }
  }
  try {
    if (fs.existsSync(distLocal)) return distLocal;
  } catch {
    // ignore
  }
  if (!preferSrc) {
    try {
      if (fs.existsSync(srcLocal)) return srcLocal;
    } catch {
      // ignore
    }
  }
  return distLocal;
}
