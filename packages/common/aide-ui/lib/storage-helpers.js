export const RUN_FILTER_AUTO = '__auto__';
export const RUN_FILTER_ALL = 'all';
export const RUN_FILTER_UNKNOWN = '__unknown__';

export function createStorageKeys(prefix) {
  const normalized = typeof prefix === 'string' ? prefix.trim() : '';
  const base = normalized || 'aide.ui';
  return {
    RUN_FILTER_STORAGE_KEY: `${base}.runFilter`,
    THEME_STORAGE_KEY: `${base}.theme`,
    DISPATCH_CWD_STORAGE_KEY: `${base}.dispatchCwd`,
    HIDDEN_RUNS_STORAGE_KEY: `${base}.hiddenRunIds`,
    WORKSPACE_ROOT_STORAGE_KEY_PREFIX: `${base}.workspaceRoot`,
    WORKSPACE_EXPLORER_SPLIT_WIDTH_KEY_PREFIX: `${base}.workspaceExplorer.splitLeftWidth`,
    WORKSPACE_EXPLORER_AUTO_OPEN_HISTORY_KEY: `${base}.workspaceExplorer.autoOpenHistory`,
    FLOATING_ISLAND_COLLAPSED_STORAGE_KEY: `${base}.floatingIsland.collapsed`,
  };
}

export function buildScopedStorageKey(prefix, runScope, fallback = RUN_FILTER_ALL) {
  const normalized = typeof runScope === 'string' ? runScope.trim() : '';
  const suffix = normalized || fallback;
  return `${prefix}:${suffix}`;
}

export function safeLocalStorageGet(key) {
  try {
    if (!window?.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageSet(key, value) {
  try {
    if (!window?.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}
