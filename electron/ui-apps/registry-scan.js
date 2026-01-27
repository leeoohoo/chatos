import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import { uiAppsPluginSchema } from './schemas.js';
import { resolveUiAppsAi } from './ai.js';

function readPluginManifest(manifestPath, maxManifestBytes) {
  const stat = fs.statSync(manifestPath);
  if (stat.size > maxManifestBytes) {
    throw new Error(`Manifest too large (${stat.size} bytes): ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

function resolveEntry(pluginDir, entry) {
  const resolveEntryItem = (raw, label = 'entry') => {
    const normalized = typeof raw === 'string' ? { type: 'module', path: raw } : raw;
    const entryType = normalized?.type;
    if (entryType !== 'module') {
      if (label === 'entry') throw new Error('Only module entry is supported');
      throw new Error(`Only module ${label} is supported`);
    }
    const relPath = typeof normalized?.path === 'string' ? normalized.path.trim() : '';
    if (!relPath) throw new Error(`${label}.path is required`);
    const resolved = path.resolve(pluginDir, relPath);
    const relative = path.relative(pluginDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${label}.path must be within plugin directory`);
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`${label}.path not found: ${relPath}`);
    }

    let stat = null;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new Error(`${label}.path not found: ${relPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`${label}.path must be a file for module apps: ${relPath}`);
    }

    return { type: entryType, url: pathToFileURL(resolved).toString() };
  };

  const resolved = resolveEntryItem(entry, 'entry');
  const compact = entry && typeof entry === 'object' ? entry.compact : null;
  if (compact) {
    resolved.compact = resolveEntryItem(compact, 'entry.compact');
  }
  return resolved;
}

function resolveApps({ pluginDir, plugin, errors, context }) {
  const seenIds = new Set();
  const apps = [];
  (Array.isArray(plugin.apps) ? plugin.apps : []).forEach((app) => {
    const appId = typeof app?.id === 'string' ? app.id.trim() : '';
    if (!appId) return;
    if (seenIds.has(appId)) {
      errors.push({
        dir: pluginDir,
        source: 'manifest',
        message: `Duplicate app id "${appId}" in plugin "${plugin?.id}"`,
      });
      return;
    }
    seenIds.add(appId);

    try {
      const entry = resolveEntry(pluginDir, app.entry);
      const ai = resolveUiAppsAi(pluginDir, plugin?.id, app, errors, context);
      apps.push({
        id: app.id,
        name: app.name,
        description: app.description || '',
        icon: app.icon || '',
        entry,
        ai,
        route: `apps/plugin/${encodeURIComponent(plugin.id)}/${encodeURIComponent(app.id)}`,
      });
    } catch (err) {
      errors.push({
        dir: pluginDir,
        source: 'entry',
        message: `App "${plugin?.id}:${appId}" entry error: ${err?.message || String(err)}`,
      });
    }
  });
  return apps;
}

function resolveBackend(pluginDir, plugin, errors) {
  const rel = typeof plugin?.backend?.entry === 'string' ? plugin.backend.entry.trim() : '';
  if (!rel) return null;

  const resolved = path.resolve(pluginDir, rel);
  const relative = path.relative(pluginDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    errors.push({
      dir: pluginDir,
      source: 'backend',
      message: 'backend.entry must be within plugin directory',
    });
    return { entry: rel, resolved: null };
  }

  let stat = null;
  try {
    stat = fs.statSync(resolved);
  } catch {
    errors.push({
      dir: pluginDir,
      source: 'backend',
      message: `backend.entry not found: ${rel}`,
    });
    return { entry: rel, resolved: null };
  }

  if (!stat.isFile()) {
    errors.push({
      dir: pluginDir,
      source: 'backend',
      message: `backend.entry must be a file: ${rel}`,
    });
    return { entry: rel, resolved: null };
  }

  return { entry: rel, resolved, mtimeMs: stat.mtimeMs };
}

export function scanPluginsDir({
  dirPath,
  source,
  manifestFile,
  maxManifestBytes,
  stateDir,
  sessionRoot,
  projectRoot,
  dataRootDir,
  isPluginTrusted,
  errors,
} = {}) {
  const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
  if (!normalized) return [];

  let entries = [];
  try {
    entries = fs.readdirSync(normalized, { withFileTypes: true });
  } catch {
    return [];
  }

  const plugins = [];
  entries.forEach((entry) => {
    if (!entry?.isDirectory?.()) return;
    const pluginDir = path.join(normalized, entry.name);
    const manifestPath = path.join(pluginDir, manifestFile);
    try {
      if (!fs.existsSync(manifestPath)) return;
    } catch {
      return;
    }
    try {
      const parsed = readPluginManifest(manifestPath, maxManifestBytes);
      const plugin = uiAppsPluginSchema.parse(parsed);
      const apps = resolveApps({
        pluginDir,
        plugin,
        errors,
        context: {
          stateDir,
          sessionRoot,
          projectRoot,
          dataRootDir,
        },
      });
      const backend = resolveBackend(pluginDir, plugin, errors);
      const trusted = typeof isPluginTrusted === 'function'
        ? isPluginTrusted({ id: plugin.id, source, pluginDir })
        : false;
      plugins.push({
        id: plugin.id,
        providerAppId: plugin.providerAppId || '',
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        source,
        trusted,
        backend,
        apps,
        pluginDir,
      });
    } catch (err) {
      errors.push({
        dir: pluginDir,
        source,
        message: err?.message || String(err),
      });
    }
  });

  return plugins;
}
