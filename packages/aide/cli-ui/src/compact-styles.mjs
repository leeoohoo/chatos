export function getCompactStyles() {
  return `
    .aide-compact-root {
      position: relative;
      height: 100%;
      min-height: 0;
      display: flex;
      flex-direction: column;
      color: var(--aide-compact-text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .aide-compact-header {
      padding: 14px 16px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--aide-compact-border);
    }
    .aide-compact-title {
      font-size: 15px;
      font-weight: 700;
      line-height: 1.2;
    }
    .aide-compact-meta {
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
    }
    .aide-compact-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 12px 16px 180px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-sizing: border-box;
    }
    .aide-compact-card {
      border-radius: 12px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-card-bg);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .aide-compact-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .aide-compact-card-title {
      font-weight: 700;
      font-size: 13px;
    }
    .aide-compact-card-meta {
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
    }
    .aide-compact-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .aide-compact-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px;
      border-radius: 10px;
      background: var(--aide-compact-muted-bg);
    }
    .aide-compact-row-title {
      font-weight: 600;
      font-size: 12px;
      line-height: 1.2;
    }
    .aide-compact-row-text {
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
      line-height: 1.4;
    }
    .aide-compact-row-main {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }
    .aide-compact-tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      background: var(--aide-compact-tag-bg);
      color: var(--aide-compact-tag-text);
    }
    .aide-compact-tag.success {
      background: var(--aide-compact-tag-green-bg);
      color: var(--aide-compact-tag-green-text);
    }
    .aide-compact-tag.warning {
      background: var(--aide-compact-tag-orange-bg);
      color: var(--aide-compact-tag-orange-text);
    }
    .aide-compact-tag.danger {
      background: var(--aide-compact-tag-red-bg);
      color: var(--aide-compact-tag-red-text);
    }
    .aide-compact-tag.info {
      background: var(--aide-compact-tag-blue-bg);
      color: var(--aide-compact-tag-blue-text);
    }
    .aide-compact-button {
      border-radius: 8px;
      border: 1px solid var(--aide-compact-border-strong);
      background: var(--aide-compact-button-bg);
      color: var(--aide-compact-text);
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .aide-compact-button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .aide-compact-alert {
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-alert-bg);
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
    }
    .aide-compact-pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
    }
    .aide-compact-pagination-controls {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .aide-compact-float {
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 12px;
      padding: 10px 12px;
      border-radius: 16px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-float-bg);
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
    }
    .aide-compact-float.is-collapsed {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
    .aide-compact-float-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
    }
    .aide-compact-float-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .aide-compact-float-text {
      font-size: 12px;
      color: var(--aide-compact-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .aide-compact-tabs {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 2px 0;
    }
    .aide-compact-tab {
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-muted-bg);
      color: var(--aide-compact-text);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .aide-compact-tab.is-active {
      background: var(--aide-compact-tab-active-bg);
      color: var(--aide-compact-tab-active-text);
      border-color: var(--aide-compact-tab-active-border);
      font-weight: 600;
    }
    .aide-compact-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
    }
    .aide-compact-row.is-clickable {
      cursor: pointer;
    }
    .aide-compact-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .aide-compact-button.is-mini {
      padding: 2px 8px;
      font-size: 11px;
    }
    .aide-compact-select {
      width: 100%;
      min-width: 160px;
      padding: 4px 8px;
      border-radius: 8px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-card-bg);
      color: var(--aide-compact-text);
      font-size: 12px;
    }
    .aide-compact-input {
      width: 100%;
      min-height: 34px;
      max-height: 120px;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-card-bg);
      color: var(--aide-compact-text);
      font-size: 12px;
      resize: vertical;
      box-sizing: border-box;
    }
    .aide-compact-float-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .aide-compact-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 20;
      box-sizing: border-box;
    }
    .aide-compact-overlay-panel {
      width: min(860px, 100%);
      max-height: 90%;
      background: var(--aide-compact-card-bg);
      border: 1px solid var(--aide-compact-border);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      box-sizing: border-box;
    }
    .aide-compact-overlay-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .aide-compact-overlay-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      background: var(--aide-compact-muted-bg);
      border-radius: 10px;
      padding: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      white-space: pre-wrap;
      color: var(--aide-compact-text);
    }
  `;
}
