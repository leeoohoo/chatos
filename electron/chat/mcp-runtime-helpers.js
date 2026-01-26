import fs from 'fs';
import path from 'path';
import { normalizeId } from './normalize.js';

export function createMcpRuntimeHelpers({ defaultPaths } = {}) {
  const computeMcpSignature = ({ servers, skipServers, baseDir, mode } = {}) => {
    const toJson = (value) => {
      if (!value || typeof value !== 'object') return '';
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    };
    const list = Array.isArray(servers) ? servers : [];
    const items = list
      .map((entry) => {
        const name = typeof entry?.name === 'string' ? entry.name.trim().toLowerCase() : '';
        const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
        if (!name || !url) return null;
        const enabled = entry?.enabled !== false ? '1' : '0';
        const apiKeyEnv =
          typeof entry?.api_key_env === 'string'
            ? entry.api_key_env.trim()
            : typeof entry?.apiKeyEnv === 'string'
              ? entry.apiKeyEnv.trim()
              : '';
        const tags = Array.isArray(entry?.tags)
          ? entry.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean).sort().join(',')
          : '';
        const auth = entry?.auth && typeof entry.auth === 'object' ? toJson(entry.auth) : '';
        const callMeta =
          entry?.callMeta && typeof entry.callMeta === 'object'
            ? toJson(entry.callMeta)
            : entry?.call_meta && typeof entry.call_meta === 'object'
              ? toJson(entry.call_meta)
              : '';
        return `${name}\u0000${url}\u0000${enabled}\u0000${apiKeyEnv}\u0000${tags}\u0000${auth}\u0000${callMeta}`;
      })
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const skips = Array.isArray(skipServers)
      ? skipServers
          .map((value) => String(value || '').trim().toLowerCase())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
      : [];
    const base = typeof baseDir === 'string' && baseDir.trim() ? path.resolve(baseDir.trim()) : '';
    const modeTag = typeof mode === 'string' && mode.trim() ? mode.trim() : 'config';
    return `${modeTag}\u0000${base}\u0001${items.join('\u0001')}\u0002${skips.join('\u0001')}`;
  };

  const normalizeRuntimeServerEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
    if (!name || !url) return null;
    const tags = Array.isArray(entry?.tags)
      ? entry.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
      : [];
    const apiKeyEnv =
      typeof entry?.api_key_env === 'string'
        ? entry.api_key_env.trim()
        : typeof entry?.apiKeyEnv === 'string'
          ? entry.apiKeyEnv.trim()
          : '';
    const auth = entry?.auth && typeof entry.auth === 'object' ? entry.auth : entry?.auth;
    const callMeta =
      entry?.callMeta && typeof entry.callMeta === 'object'
        ? entry.callMeta
        : entry?.call_meta && typeof entry.call_meta === 'object'
          ? entry.call_meta
          : undefined;
    const appId =
      typeof entry?.app_id === 'string'
        ? entry.app_id.trim()
        : typeof entry?.appId === 'string'
          ? entry.appId.trim()
          : '';
    return {
      name,
      url,
      description: typeof entry?.description === 'string' ? entry.description : '',
      tags,
      enabled: entry?.enabled !== false,
      ...(apiKeyEnv ? { api_key_env: apiKeyEnv } : null),
      ...(auth ? { auth } : null),
      ...(callMeta ? { callMeta } : null),
      ...(appId ? { app_id: appId } : null),
    };
  };

  const buildRuntimeMcpServers = ({ selectedIds, servers, extraServers } = {}) => {
    const selected = new Set(
      (Array.isArray(selectedIds) ? selectedIds : []).map((id) => normalizeId(id)).filter(Boolean)
    );
    const byId = new Map(
      (Array.isArray(servers) ? servers : [])
        .filter((srv) => normalizeId(srv?.id))
        .map((srv) => [normalizeId(srv.id), srv])
    );
    const seen = new Set();
    const out = [];
    const add = (entry) => {
      const normalized = normalizeRuntimeServerEntry(entry);
      if (!normalized) return;
      const key = normalized.name.toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(normalized);
    };
    if (selected.size > 0) {
      selected.forEach((id) => {
        const entry = byId.get(id);
        if (entry) add(entry);
      });
    }
    (Array.isArray(extraServers) ? extraServers : []).forEach(add);
    return out;
  };

  const resolveMcpConfigPath = () => {
    const explicit = typeof defaultPaths?.mcpConfig === 'string' ? defaultPaths.mcpConfig.trim() : '';
    if (explicit) return explicit;
    const anchor = typeof defaultPaths?.models === 'string' ? defaultPaths.models.trim() : '';
    if (!anchor) return '';
    return path.join(path.dirname(anchor), 'mcp.config.json');
  };

  const readMcpConfigMtimeMs = () => {
    const configPath = resolveMcpConfigPath();
    if (!configPath) return null;
    try {
      const stat = fs.statSync(configPath);
      return Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : null;
    } catch {
      return null;
    }
  };

  return {
    computeMcpSignature,
    buildRuntimeMcpServers,
    resolveMcpConfigPath,
    readMcpConfigMtimeMs,
  };
}
