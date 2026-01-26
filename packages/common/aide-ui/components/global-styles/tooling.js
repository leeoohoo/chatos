export const GLOBAL_TOOLING_STYLES = `
      .ds-tool-badge {
        --tool-accent: #7c3aed;
        --tool-accent-weak: rgba(124, 58, 237, 0.16);
        --tool-accent-strong: rgba(124, 58, 237, 0.35);
        --tool-status: rgba(148, 163, 184, 0.9);
        --tool-status-weak: rgba(148, 163, 184, 0.35);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--tool-accent-strong);
        background: linear-gradient(90deg, var(--tool-accent-weak), rgba(255, 255, 255, 0));
        color: rgba(15, 23, 42, 0.86);
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
        transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
      }
      :root[data-theme='dark'] .ds-tool-badge {
        color: rgba(255, 255, 255, 0.9);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
        background: linear-gradient(90deg, var(--tool-accent-weak), rgba(10, 12, 18, 0));
      }
      .ds-tool-badge:hover {
        transform: translateY(-1px);
        box-shadow: 0 10px 26px rgba(15, 23, 42, 0.14);
      }
      :root[data-theme='dark'] .ds-tool-badge:hover {
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.7);
      }
      .ds-tool-badge:focus-visible {
        outline: 2px solid var(--ds-focus-ring);
        outline-offset: 2px;
      }
      .ds-tool-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--tool-status);
        box-shadow: 0 0 0 3px var(--tool-status-weak);
      }
      .ds-tool-icon {
        display: inline-flex;
        align-items: center;
        font-size: 12px;
        color: var(--tool-accent);
      }
      .ds-tool-badge-text {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
        min-width: 0;
      }
      .ds-tool-badge-label {
        font-weight: 600;
        letter-spacing: 0.2px;
        line-height: 16px;
      }
      .ds-tool-badge-subtitle {
        font-size: 10px;
        color: rgba(71, 85, 105, 0.75);
        line-height: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 160px;
      }
      :root[data-theme='dark'] .ds-tool-badge-subtitle {
        color: rgba(148, 163, 184, 0.82);
      }

      .ds-tool-badge[data-kind='shell'],
      .ds-tool-popover-kind-shell {
        --tool-accent: #38bdf8;
        --tool-accent-weak: rgba(56, 189, 248, 0.18);
        --tool-accent-strong: rgba(56, 189, 248, 0.42);
      }
      .ds-tool-badge[data-kind='filesystem'],
      .ds-tool-popover-kind-filesystem {
        --tool-accent: #22c55e;
        --tool-accent-weak: rgba(34, 197, 94, 0.16);
        --tool-accent-strong: rgba(34, 197, 94, 0.4);
      }
      .ds-tool-badge[data-kind='lsp'],
      .ds-tool-popover-kind-lsp {
        --tool-accent: #a855f7;
        --tool-accent-weak: rgba(168, 85, 247, 0.18);
        --tool-accent-strong: rgba(168, 85, 247, 0.4);
      }
      .ds-tool-badge[data-kind='task'],
      .ds-tool-popover-kind-task {
        --tool-accent: #f59e0b;
        --tool-accent-weak: rgba(245, 158, 11, 0.2);
        --tool-accent-strong: rgba(245, 158, 11, 0.45);
      }
      .ds-tool-badge[data-kind='subagent'],
      .ds-tool-popover-kind-subagent {
        --tool-accent: #6366f1;
        --tool-accent-weak: rgba(99, 102, 241, 0.18);
        --tool-accent-strong: rgba(99, 102, 241, 0.45);
      }
      .ds-tool-badge[data-kind='prompt'],
      .ds-tool-popover-kind-prompt {
        --tool-accent: #ec4899;
        --tool-accent-weak: rgba(236, 72, 153, 0.2);
        --tool-accent-strong: rgba(236, 72, 153, 0.45);
      }
      .ds-tool-badge[data-kind='journal'],
      .ds-tool-popover-kind-journal {
        --tool-accent: #14b8a6;
        --tool-accent-weak: rgba(20, 184, 166, 0.18);
        --tool-accent-strong: rgba(20, 184, 166, 0.42);
      }
      .ds-tool-badge[data-kind='browser'],
      .ds-tool-popover-kind-browser {
        --tool-accent: #10b981;
        --tool-accent-weak: rgba(16, 185, 129, 0.18);
        --tool-accent-strong: rgba(16, 185, 129, 0.42);
      }
      .ds-tool-badge[data-kind='code_maintainer'],
      .ds-tool-popover-kind-code_maintainer {
        --tool-accent: #6366f1;
        --tool-accent-weak: rgba(99, 102, 241, 0.18);
        --tool-accent-strong: rgba(99, 102, 241, 0.45);
      }

      .ds-tool-badge[data-status='ok'] {
        --tool-status: #22c55e;
        --tool-status-weak: rgba(34, 197, 94, 0.35);
      }
      .ds-tool-badge[data-status='pending'] {
        --tool-status: #f59e0b;
        --tool-status-weak: rgba(245, 158, 11, 0.35);
      }
      .ds-tool-badge[data-status='error'] {
        --tool-status: #ef4444;
        --tool-status-weak: rgba(239, 68, 68, 0.35);
      }
      .ds-tool-badge[data-status='canceled'] {
        --tool-status: #f97316;
        --tool-status-weak: rgba(249, 115, 22, 0.35);
      }
      .ds-tool-badge[data-status='timeout'] {
        --tool-status: #e11d48;
        --tool-status-weak: rgba(225, 29, 72, 0.35);
      }
      .ds-tool-badge[data-status='partial'] {
        --tool-status: #0ea5e9;
        --tool-status-weak: rgba(14, 165, 233, 0.35);
      }

      .ds-tool-popover {
        --tool-accent: #7c3aed;
        --tool-accent-weak: rgba(124, 58, 237, 0.16);
        --tool-accent-strong: rgba(124, 58, 237, 0.35);
      }
      .ds-tool-popover.ant-popover .ant-popover-inner {
        padding: 0;
        background: var(--ds-panel-bg);
        border: 1px solid var(--ds-panel-border);
        border-radius: 12px;
        box-shadow: var(--ds-panel-shadow);
      }
      .ds-tool-popover.ant-popover .ant-popover-inner-content {
        padding: 0;
      }
      .ds-tool-popover.ant-popover .ant-popover-title {
        margin: 0;
        padding: 10px 12px;
        border-bottom: 1px solid var(--ds-panel-border);
        background: var(--ds-subtle-bg);
      }
      .ds-tool-popover-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .ds-tool-popover-title {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .ds-tool-popover-icon {
        display: inline-flex;
        align-items: center;
        font-size: 14px;
        color: var(--tool-accent);
      }
      .ds-tool-popover-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .ds-tool-popover-name {
        font-weight: 600;
        font-size: 13px;
        color: rgba(15, 23, 42, 0.85);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      :root[data-theme='dark'] .ds-tool-popover-name {
        color: rgba(255, 255, 255, 0.92);
      }
      .ds-tool-popover-subtitle {
        font-size: 11px;
        color: rgba(71, 85, 105, 0.8);
      }
      :root[data-theme='dark'] .ds-tool-popover-subtitle {
        color: rgba(148, 163, 184, 0.9);
      }
      .ds-tool-popover-meta {
        display: inline-flex;
        gap: 6px;
        flex-shrink: 0;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .ds-tool-popover-chips {
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .ds-tool-popover-actions {
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .ds-tool-action-btn.ant-btn {
        padding-inline: 4px;
        border-radius: 6px;
        color: rgba(71, 85, 105, 0.75);
      }
      .ds-tool-action-btn.ant-btn:hover {
        color: rgba(15, 23, 42, 0.85);
        background: rgba(15, 23, 42, 0.06);
      }
      :root[data-theme='dark'] .ds-tool-action-btn.ant-btn {
        color: rgba(148, 163, 184, 0.9);
      }
      :root[data-theme='dark'] .ds-tool-action-btn.ant-btn:hover {
        color: rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.08);
      }
      .ds-tool-chip {
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--tool-accent-strong);
        background: var(--tool-accent-weak);
        font-size: 11px;
        color: rgba(15, 23, 42, 0.7);
      }
      :root[data-theme='dark'] .ds-tool-chip {
        color: rgba(255, 255, 255, 0.82);
      }
      .ds-tool-chip[data-status='ok'] {
        border-color: rgba(34, 197, 94, 0.45);
        background: rgba(34, 197, 94, 0.16);
        color: rgba(22, 101, 52, 0.85);
      }
      .ds-tool-chip[data-status='pending'] {
        border-color: rgba(245, 158, 11, 0.5);
        background: rgba(245, 158, 11, 0.18);
        color: rgba(180, 83, 9, 0.9);
      }
      .ds-tool-chip[data-status='error'] {
        border-color: rgba(239, 68, 68, 0.5);
        background: rgba(239, 68, 68, 0.18);
        color: rgba(153, 27, 27, 0.9);
      }
      .ds-tool-chip[data-status='canceled'] {
        border-color: rgba(249, 115, 22, 0.5);
        background: rgba(249, 115, 22, 0.18);
        color: rgba(154, 52, 18, 0.9);
      }
      .ds-tool-chip[data-status='timeout'] {
        border-color: rgba(225, 29, 72, 0.5);
        background: rgba(225, 29, 72, 0.18);
        color: rgba(136, 19, 55, 0.9);
      }
      .ds-tool-chip[data-status='partial'] {
        border-color: rgba(14, 165, 233, 0.5);
        background: rgba(14, 165, 233, 0.18);
        color: rgba(12, 74, 110, 0.9);
      }
      :root[data-theme='dark'] .ds-tool-chip[data-status='ok'],
      :root[data-theme='dark'] .ds-tool-chip[data-status='pending'],
      :root[data-theme='dark'] .ds-tool-chip[data-status='error'],
      :root[data-theme='dark'] .ds-tool-chip[data-status='canceled'],
      :root[data-theme='dark'] .ds-tool-chip[data-status='timeout'],
      :root[data-theme='dark'] .ds-tool-chip[data-status='partial'] {
        color: rgba(255, 255, 255, 0.86);
      }

      .ds-tool-popover-body {
        display: flex;
        flex-direction: column;
        padding: 0;
      }
      .ds-tool-section {
        padding: 10px 12px;
      }
      .ds-tool-section + .ds-tool-section {
        border-top: 1px solid var(--ds-panel-border);
      }
      .ds-tool-section-title {
        font-size: 11px;
        font-weight: 600;
        color: rgba(71, 85, 105, 0.85);
        margin-bottom: 6px;
      }
      :root[data-theme='dark'] .ds-tool-section-title {
        color: rgba(148, 163, 184, 0.9);
      }
      .ds-tool-summary {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ds-tool-summary-item {
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--ds-panel-border);
        background: var(--ds-subtle-bg);
        width: 100%;
      }
      .ds-tool-summary-item[data-tone='ok'] {
        border-color: rgba(34, 197, 94, 0.35);
        background: rgba(34, 197, 94, 0.12);
      }
      .ds-tool-summary-item[data-tone='error'] {
        border-color: rgba(239, 68, 68, 0.4);
        background: rgba(239, 68, 68, 0.12);
      }
      .ds-tool-summary-item[data-tone='warn'] {
        border-color: rgba(245, 158, 11, 0.4);
        background: rgba(245, 158, 11, 0.12);
      }
      .ds-tool-summary-label {
        font-size: 10px;
        color: rgba(71, 85, 105, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      :root[data-theme='dark'] .ds-tool-summary-label {
        color: rgba(148, 163, 184, 0.75);
      }
      .ds-tool-summary-value {
        margin-top: 4px;
        font-size: 12px;
        font-weight: 600;
        color: rgba(15, 23, 42, 0.9);
        word-break: break-word;
      }
      :root[data-theme='dark'] .ds-tool-summary-value {
        color: rgba(255, 255, 255, 0.9);
      }
      .ds-tool-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ds-tool-list-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--ds-panel-border);
        background: var(--ds-subtle-bg);
      }
      .ds-tool-list-item[data-tone='ok'] {
        border-color: rgba(34, 197, 94, 0.35);
        background: rgba(34, 197, 94, 0.12);
      }
      .ds-tool-list-item[data-tone='error'] {
        border-color: rgba(239, 68, 68, 0.4);
        background: rgba(239, 68, 68, 0.12);
      }
      .ds-tool-list-item[data-tone='warn'] {
        border-color: rgba(245, 158, 11, 0.4);
        background: rgba(245, 158, 11, 0.12);
      }
      .ds-tool-list-icon {
        display: inline-flex;
        align-items: center;
        margin-top: 2px;
        font-size: 13px;
        color: var(--tool-accent);
      }
      .ds-tool-list-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }
      .ds-tool-list-title {
        font-weight: 600;
        font-size: 12px;
        color: rgba(15, 23, 42, 0.9);
        word-break: break-word;
      }
      :root[data-theme='dark'] .ds-tool-list-title {
        color: rgba(255, 255, 255, 0.9);
      }
      .ds-tool-list-subtitle {
        font-size: 11px;
        color: rgba(71, 85, 105, 0.75);
        word-break: break-word;
      }
      :root[data-theme='dark'] .ds-tool-list-subtitle {
        color: rgba(148, 163, 184, 0.82);
      }
      .ds-tool-list-meta {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
      }
      .ds-tool-list-meta-text {
        font-size: 11px;
        color: rgba(71, 85, 105, 0.75);
      }
      :root[data-theme='dark'] .ds-tool-list-meta-text {
        color: rgba(148, 163, 184, 0.82);
      }
      .ds-tool-block {
        margin: 0;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--ds-code-border);
        background: var(--ds-code-bg);
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: SFMono-Regular, Consolas, Menlo, monospace;
      }
      .ds-tool-block[data-tone='stderr'] {
        border-color: rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.08);
        color: rgba(153, 27, 27, 0.92);
      }
      :root[data-theme='dark'] .ds-tool-block[data-tone='stderr'] {
        color: rgba(255, 226, 226, 0.92);
      }
      .ds-tool-block[data-tone='warn'] {
        border-color: rgba(245, 158, 11, 0.35);
        background: rgba(245, 158, 11, 0.12);
      }
      .ds-tool-output-grid {
        display: grid;
        gap: 10px;
      }
      .ds-tool-output-panel {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ds-tool-output-title {
        font-size: 11px;
        font-weight: 600;
        color: rgba(71, 85, 105, 0.8);
        margin-bottom: 6px;
      }
      :root[data-theme='dark'] .ds-tool-output-title {
        color: rgba(148, 163, 184, 0.85);
      }
      .ds-tool-meta-collapse {
        padding: 10px 12px;
        border-top: 1px solid var(--ds-panel-border);
      }
      .ds-tool-meta-collapse .ant-collapse-header {
        padding: 0 !important;
        font-size: 11px;
        font-weight: 600;
        color: rgba(71, 85, 105, 0.85);
      }
      :root[data-theme='dark'] .ds-tool-meta-collapse .ant-collapse-header {
        color: rgba(148, 163, 184, 0.9);
      }
      .ds-tool-meta-collapse .ant-collapse-content {
        margin-top: 6px;
      }
      .ds-tool-meta-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ds-subagent-process {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ds-subagent-process .ant-collapse-item {
        border: 1px solid var(--ds-panel-border);
        border-radius: 12px;
        background: var(--ds-subtle-bg);
        overflow: hidden;
      }
      .ds-subagent-process .ant-collapse-item.is-error {
        border-color: rgba(239, 68, 68, 0.45);
        background: var(--ds-change-bg-error);
      }
      .ds-subagent-process .ant-collapse-item.is-truncated {
        border-color: rgba(245, 158, 11, 0.45);
        background: var(--ds-change-bg-warning);
      }
      .ds-subagent-process .ant-collapse-header {
        padding: 8px 10px !important;
        align-items: center;
      }
      .ds-subagent-process .ant-collapse-content {
        border-top: 1px solid var(--ds-panel-border);
        background: transparent;
      }
      .ds-subagent-process .ant-collapse-content > .ant-collapse-content-box {
        padding: 8px 10px 12px;
      }
      .ds-subagent-step-header {
        font-size: 12px;
        color: rgba(15, 23, 42, 0.9);
      }
      :root[data-theme='dark'] .ds-subagent-step-header {
        color: rgba(255, 255, 255, 0.9);
      }
      .ds-subagent-step-index {
        font-weight: 600;
        color: rgba(71, 85, 105, 0.8);
      }
      :root[data-theme='dark'] .ds-subagent-step-index {
        color: rgba(148, 163, 184, 0.85);
      }
      .ds-subagent-step-icon {
        color: var(--tool-accent);
      }
      .ds-subagent-step-title {
        font-weight: 600;
      }
      .ds-subagent-step-summary {
        font-size: 11px;
        color: rgba(71, 85, 105, 0.75);
        max-width: 320px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      :root[data-theme='dark'] .ds-subagent-step-summary {
        color: rgba(148, 163, 184, 0.82);
      }
      .ds-subagent-step-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-top: 4px;
      }
      .ds-subagent-step-block {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .ds-subagent-step-label {
        font-size: 11px;
        font-weight: 600;
        color: rgba(71, 85, 105, 0.8);
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      :root[data-theme='dark'] .ds-subagent-step-label {
        color: rgba(148, 163, 184, 0.85);
      }
      .ds-tool-drawer .ant-drawer-content {
        background: var(--ds-panel-bg);
      }
      .ds-tool-drawer .ant-drawer-header {
        background: var(--ds-subtle-bg);
        border-bottom: 1px solid var(--ds-panel-border);
      }
      .ds-tool-drawer .ant-drawer-body {
        padding: 12px 16px;
      }
      .ds-tool-drawer-wide .ant-drawer-body {
        padding: 16px 20px;
      }
      .ds-tool-drawer-full .ant-drawer-content-wrapper {
        width: 100vw !important;
      }
      .ds-tool-drawer-full .ant-drawer-content,
      .ds-tool-drawer-full .ant-drawer-header {
        border-radius: 0;
      }
`;
