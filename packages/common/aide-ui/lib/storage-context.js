import {
  RUN_FILTER_AUTO,
  RUN_FILTER_ALL,
  RUN_FILTER_UNKNOWN,
  buildScopedStorageKey,
  createStorageKeys,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from './storage-helpers.js';

export function createStorageContext(prefix) {
  const storageKeys = createStorageKeys(prefix);

  return {
    RUN_FILTER_STORAGE_KEY: storageKeys.RUN_FILTER_STORAGE_KEY,
    RUN_FILTER_AUTO,
    RUN_FILTER_ALL,
    RUN_FILTER_UNKNOWN,
    safeLocalStorageGet,
    safeLocalStorageSet,
    THEME_STORAGE_KEY: storageKeys.THEME_STORAGE_KEY,
    DISPATCH_CWD_STORAGE_KEY: storageKeys.DISPATCH_CWD_STORAGE_KEY,
    HIDDEN_RUNS_STORAGE_KEY: storageKeys.HIDDEN_RUNS_STORAGE_KEY,
    WORKSPACE_ROOT_STORAGE_KEY_PREFIX: storageKeys.WORKSPACE_ROOT_STORAGE_KEY_PREFIX,
    WORKSPACE_EXPLORER_SPLIT_WIDTH_KEY_PREFIX: storageKeys.WORKSPACE_EXPLORER_SPLIT_WIDTH_KEY_PREFIX,
    WORKSPACE_EXPLORER_AUTO_OPEN_HISTORY_KEY: storageKeys.WORKSPACE_EXPLORER_AUTO_OPEN_HISTORY_KEY,
    FLOATING_ISLAND_COLLAPSED_STORAGE_KEY: storageKeys.FLOATING_ISLAND_COLLAPSED_STORAGE_KEY,
    buildWorkspaceRootStorageKey(runScope) {
      return buildScopedStorageKey(storageKeys.WORKSPACE_ROOT_STORAGE_KEY_PREFIX, runScope, RUN_FILTER_ALL);
    },
    buildWorkspaceExplorerSplitWidthStorageKey(runScope) {
      return buildScopedStorageKey(storageKeys.WORKSPACE_EXPLORER_SPLIT_WIDTH_KEY_PREFIX, runScope, RUN_FILTER_ALL);
    },
  };
}
