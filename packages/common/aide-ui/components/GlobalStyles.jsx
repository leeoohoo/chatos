import React from 'react';

export function GlobalStyles({ extraCss = '' } = {}) {
  const extra = typeof extraCss === 'string' ? extraCss : '';
  return (
    <style>{`
      :root {
        --ds-accent: #00d4ff;
        --ds-accent-2: #7c3aed;
        --ds-accent-app: #00ffa8;

        --ds-page-bg: radial-gradient(1200px circle at 20% -20%, rgba(0, 212, 255, 0.18), transparent 58%),
          radial-gradient(900px circle at 100% 0%, rgba(124, 58, 237, 0.12), transparent 62%),
          linear-gradient(180deg, #f8fbff 0%, #f3f6ff 55%, #f5f7fb 100%);

        --ds-header-bg: rgba(255, 255, 255, 0.72);
        --ds-header-border: rgba(15, 23, 42, 0.08);
        --ds-header-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
        --ds-panel-bg: rgba(255, 255, 255, 0.86);
        --ds-panel-border: rgba(15, 23, 42, 0.08);
        --ds-panel-shadow: 0 12px 30px rgba(15, 23, 42, 0.07);
        --ds-subtle-bg: rgba(255, 255, 255, 0.62);
        --ds-selected-bg: linear-gradient(90deg, rgba(0, 212, 255, 0.14), rgba(124, 58, 237, 0.08));
        --ds-splitter-bg: #d9d9d9;

        --ds-floating-bg: rgba(255, 255, 255, 0.82);
        --ds-floating-border: rgba(15, 23, 42, 0.1);
        --ds-floating-shadow: 0 14px 40px rgba(15, 23, 42, 0.12);
        --ds-focus-ring: rgba(0, 212, 255, 0.32);

        --ds-nav-bg: rgba(255, 255, 255, 0.55);
        --ds-nav-border: rgba(15, 23, 42, 0.1);
        --ds-nav-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
        --ds-nav-hover-bg: rgba(15, 23, 42, 0.06);

        --ds-change-bg-error: #fff1f0;
        --ds-change-bg-warning: #fffbe6;
        --ds-change-bg-success: #f6ffed;

        --ds-code-bg: #f7f9fb;
        --ds-code-border: #eef2f7;
        --ds-code-inline-bg: #f1f3f5;
        --ds-code-inline-border: #e9ecef;
        --ds-code-line-number: #9aa4b2;
        --ds-blockquote-border: #d0d7de;
        --ds-blockquote-text: #57606a;

        --ds-code-text: #1f2328;
        --ds-code-comment: #6a737d;
        --ds-code-keyword: #d73a49;
        --ds-code-string: #032f62;
        --ds-code-number: #005cc5;
        --ds-code-built-in: #6f42c1;
        --ds-code-attr: #005cc5;
        --ds-code-title: #6f42c1;
        --ds-code-meta: #6f42c1;
      }

      :root[data-theme='dark'] {
        --ds-accent: #00d4ff;
        --ds-accent-2: #a855f7;
        --ds-accent-app: #00ffa8;

        --ds-page-bg: radial-gradient(1100px circle at 20% 0%, rgba(0, 212, 255, 0.16), transparent 56%),
          radial-gradient(900px circle at 100% 10%, rgba(168, 85, 247, 0.14), transparent 62%),
          linear-gradient(180deg, #070910 0%, #0f1115 55%, #070910 100%);

        --ds-header-bg: rgba(10, 12, 18, 0.66);
        --ds-header-border: rgba(255, 255, 255, 0.12);
        --ds-header-shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
        --ds-panel-bg: rgba(17, 19, 28, 0.82);
        --ds-panel-border: rgba(255, 255, 255, 0.14);
        --ds-panel-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
        --ds-subtle-bg: rgba(255, 255, 255, 0.04);
        --ds-selected-bg: linear-gradient(90deg, rgba(0, 212, 255, 0.18), rgba(168, 85, 247, 0.14));
        --ds-splitter-bg: #30363d;

        --ds-floating-bg: rgba(10, 12, 18, 0.78);
        --ds-floating-border: rgba(255, 255, 255, 0.14);
        --ds-floating-shadow: 0 16px 50px rgba(0, 0, 0, 0.7);
        --ds-focus-ring: rgba(0, 212, 255, 0.5);

        --ds-nav-bg: rgba(10, 12, 18, 0.6);
        --ds-nav-border: rgba(255, 255, 255, 0.12);
        --ds-nav-shadow: 0 16px 50px rgba(0, 0, 0, 0.6);
        --ds-nav-hover-bg: rgba(255, 255, 255, 0.08);

        --ds-change-bg-error: rgba(248, 81, 73, 0.18);
        --ds-change-bg-warning: rgba(250, 173, 20, 0.18);
        --ds-change-bg-success: rgba(46, 160, 67, 0.2);

        --ds-code-bg: #0d1117;
        --ds-code-border: #30363d;
        --ds-code-inline-bg: #161b22;
        --ds-code-inline-border: #30363d;
        --ds-code-line-number: #8b949e;
        --ds-blockquote-border: #30363d;
        --ds-blockquote-text: #8b949e;

        --ds-code-text: #c9d1d9;
        --ds-code-comment: #8b949e;
        --ds-code-keyword: #ff7b72;
        --ds-code-string: #a5d6ff;
        --ds-code-number: #79c0ff;
        --ds-code-built-in: #d2a8ff;
        --ds-code-attr: #ffa657;
        --ds-code-title: #d2a8ff;
        --ds-code-meta: #a5d6ff;

        color-scheme: dark;
      }

      :root[data-theme='light'] {
        color-scheme: light;
      }

      html,
      body {
        background: var(--ds-page-bg);
        background-attachment: fixed;
        -webkit-font-smoothing: antialiased;
        text-rendering: geometricPrecision;
      }

      .ds-app-header {
        position: relative;
        overflow: hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: var(--ds-header-shadow);
      }
      .ds-app-header::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(700px circle at 18% 0%, rgba(0, 212, 255, 0.18), transparent 60%),
          radial-gradient(620px circle at 92% 10%, rgba(124, 58, 237, 0.14), transparent 62%);
        opacity: 0.55;
      }
      .ds-app-header[data-mode='chat']::before {
        background: radial-gradient(760px circle at 18% 0%, rgba(0, 212, 255, 0.22), transparent 62%),
          radial-gradient(520px circle at 92% 10%, rgba(0, 212, 255, 0.1), transparent 60%);
      }
      .ds-app-header[data-mode='cli']::before {
        background: radial-gradient(760px circle at 18% 0%, rgba(124, 58, 237, 0.18), transparent 62%),
          radial-gradient(520px circle at 92% 10%, rgba(124, 58, 237, 0.1), transparent 60%);
      }
      .ds-app-header[data-mode='apps']::before {
        background: radial-gradient(760px circle at 18% 0%, rgba(0, 255, 168, 0.18), transparent 62%),
          radial-gradient(520px circle at 92% 10%, rgba(0, 212, 255, 0.1), transparent 60%);
      }
      .ds-app-header > * {
        position: relative;
      }

      .ds-app-title {
        background: linear-gradient(90deg, var(--ds-accent), var(--ds-accent-2));
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        letter-spacing: 0.6px;
      }

      .ds-nav-merged {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(0, 212, 255, 0.4), rgba(124, 58, 237, 0.28)) border-box;
        border: 1px solid transparent;
        box-shadow: var(--ds-nav-shadow);
        overflow: hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color: rgba(15, 23, 42, 0.84);
      }
      :root[data-theme='dark'] .ds-nav-merged {
        color: rgba(255, 255, 255, 0.9);
      }
      .ds-nav-merged[data-mode='chat'] {
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(0, 212, 255, 0.55), rgba(0, 212, 255, 0.22)) border-box;
      }
      .ds-nav-merged[data-mode='cli'] {
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(124, 58, 237, 0.5), rgba(124, 58, 237, 0.22)) border-box;
      }
      .ds-nav-merged[data-mode='apps'] {
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(0, 255, 168, 0.5), rgba(0, 212, 255, 0.22)) border-box;
      }

      .ds-nav-divider {
        width: 1px;
        height: 18px;
        background: rgba(15, 23, 42, 0.16);
        margin-inline: 4px;
      }
      :root[data-theme='dark'] .ds-nav-divider {
        background: rgba(255, 255, 255, 0.16);
      }

      .ds-seg.ant-segmented {
        background: transparent !important;
        padding: 0 !important;
        border-radius: 999px;
      }
      .ds-seg .ant-segmented-group {
        gap: 2px;
      }
      .ds-seg .ant-segmented-item {
        border-radius: 999px !important;
        transition: background 160ms ease, color 160ms ease;
      }
      .ds-seg .ant-segmented-item-label {
        padding: 0 12px !important;
        height: 34px;
        line-height: 34px;
        font-weight: 650;
        letter-spacing: 0.2px;
      }
      .ds-seg .ant-segmented-item:hover:not(.ant-segmented-item-selected) {
        background: var(--ds-nav-hover-bg) !important;
      }
      .ds-seg .ant-segmented-thumb {
        border-radius: 999px !important;
        border: 1px solid rgba(15, 23, 42, 0.14);
        background: rgba(15, 23, 42, 0.06);
        box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.06) inset;
      }
      :root[data-theme='dark'] .ds-seg .ant-segmented-thumb {
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
      }

      .ds-nav-merged[data-mode='chat'] .ds-seg .ant-segmented-thumb {
        border-color: rgba(0, 212, 255, 0.22);
        background: linear-gradient(90deg, rgba(0, 212, 255, 0.22), rgba(0, 212, 255, 0.08)) !important;
        box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.18) inset, 0 14px 36px rgba(0, 212, 255, 0.14);
      }
      .ds-nav-merged[data-mode='cli'] .ds-seg .ant-segmented-thumb {
        border-color: rgba(124, 58, 237, 0.22);
        background: linear-gradient(90deg, rgba(124, 58, 237, 0.22), rgba(124, 58, 237, 0.08)) !important;
        box-shadow: 0 0 0 1px rgba(124, 58, 237, 0.18) inset, 0 14px 36px rgba(124, 58, 237, 0.14);
      }
      .ds-nav-merged[data-mode='apps'] .ds-seg .ant-segmented-thumb {
        border-color: rgba(0, 255, 168, 0.22);
        background: linear-gradient(90deg, rgba(0, 255, 168, 0.24), rgba(0, 255, 168, 0.08)) !important;
        box-shadow: 0 0 0 1px rgba(0, 255, 168, 0.18) inset, 0 14px 36px rgba(0, 255, 168, 0.14);
      }

      .ds-nav.ds-nav-main.ant-menu-horizontal {
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(0, 212, 255, 0.4), rgba(124, 58, 237, 0.28)) border-box !important;
        border: 1px solid transparent !important;
        box-shadow: var(--ds-nav-shadow);
        border-radius: 999px;
        padding: 4px;
        overflow: hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }

      .ds-nav.ant-menu-horizontal > .ant-menu-item,
      .ds-nav.ant-menu-horizontal > .ant-menu-submenu {
        border-radius: 999px;
        margin: 0 2px;
        padding-inline: 14px;
        transition: background 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item,
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu {
        height: 34px;
        line-height: 34px;
        padding-inline: 12px;
      }

      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group {
        pointer-events: none;
        cursor: default;
        opacity: 1 !important;
        font-weight: 650;
        letter-spacing: 0.4px;
        padding-inline: 10px;
        background: transparent !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group:hover {
        background: transparent !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group.ds-menu-group-chat {
        color: var(--ds-accent) !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group.ds-menu-group-cli {
        color: var(--ds-accent-2) !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group.ds-menu-group-app {
        color: var(--ds-accent-app) !important;
      }

      .ds-nav.ant-menu-horizontal .ant-menu-item-divider {
        width: 1px;
        height: 18px;
        background: rgba(15, 23, 42, 0.16);
        margin-inline: 6px;
        margin-block: 8px;
      }
      :root[data-theme='dark'] .ds-nav.ant-menu-horizontal .ant-menu-item-divider {
        background: rgba(255, 255, 255, 0.16);
      }

      .ds-nav.ant-menu-horizontal > .ant-menu-item::after,
      .ds-nav.ant-menu-horizontal > .ant-menu-submenu::after {
        border-bottom: none !important;
      }

      .ds-nav.ant-menu-horizontal > .ant-menu-item:hover,
      .ds-nav.ant-menu-horizontal > .ant-menu-submenu:hover {
        background: var(--ds-nav-hover-bg) !important;
      }

      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-chat:hover {
        background: rgba(0, 212, 255, 0.1) !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-cli:hover {
        background: rgba(124, 58, 237, 0.1) !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-app:hover {
        background: rgba(0, 255, 168, 0.12) !important;
      }

      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-chat.ant-menu-item-selected,
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-chat.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(0, 212, 255, 0.18), rgba(0, 212, 255, 0.06)) !important;
        box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.22) inset, 0 14px 36px rgba(0, 212, 255, 0.12);
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-cli.ant-menu-item-selected,
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-cli.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(124, 58, 237, 0.18), rgba(124, 58, 237, 0.06)) !important;
        box-shadow: 0 0 0 1px rgba(124, 58, 237, 0.22) inset, 0 14px 36px rgba(124, 58, 237, 0.12);
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-app.ant-menu-item-selected,
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-app.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(0, 255, 168, 0.2), rgba(0, 255, 168, 0.06)) !important;
        box-shadow: 0 0 0 1px rgba(0, 255, 168, 0.22) inset, 0 14px 36px rgba(0, 255, 168, 0.12);
      }
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-chat.ant-menu-item-selected,
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-chat.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(0, 212, 255, 0.24), rgba(0, 212, 255, 0.12)) !important;
        box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.26) inset, 0 18px 46px rgba(0, 212, 255, 0.14);
      }
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-cli.ant-menu-item-selected,
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-cli.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(168, 85, 247, 0.24), rgba(168, 85, 247, 0.12)) !important;
        box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.26) inset, 0 18px 46px rgba(168, 85, 247, 0.14);
      }
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-app.ant-menu-item-selected,
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-app.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(0, 255, 168, 0.26), rgba(0, 255, 168, 0.12)) !important;
        box-shadow: 0 0 0 1px rgba(0, 255, 168, 0.26) inset, 0 18px 46px rgba(0, 255, 168, 0.14);
      }

      .ds-icon-button.ant-btn {
        border: 1px solid var(--ds-nav-border);
        background: var(--ds-nav-bg);
        box-shadow: var(--ds-nav-shadow);
        transition: transform 160ms ease, box-shadow 160ms ease;
      }
      .ds-icon-button.ant-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 0 0 3px var(--ds-focus-ring), var(--ds-nav-shadow);
      }

      .ant-card {
        background: var(--ds-panel-bg);
        border-color: var(--ds-panel-border);
        box-shadow: var(--ds-panel-shadow);
      }

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
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 8px;
      }
      .ds-tool-summary[data-variant='subagent'] {
        grid-template-columns: minmax(110px, 150px) minmax(130px, 190px) minmax(200px, 1fr);
        align-items: start;
      }
      .ds-tool-summary[data-variant='subagent'] .ds-tool-summary-item[data-key='agent'],
      .ds-tool-summary[data-variant='subagent'] .ds-tool-summary-item[data-key='skills'] {
        padding: 6px 8px;
      }
      @media (max-width: 860px) {
        .ds-tool-summary[data-variant='subagent'] {
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        }
      }
      .ds-tool-summary-item {
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--ds-panel-border);
        background: var(--ds-subtle-bg);
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

      *::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      *::-webkit-scrollbar-thumb {
        background: rgba(15, 23, 42, 0.22);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: content-box;
      }
      :root[data-theme='dark'] *::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.16);
        border: 2px solid transparent;
        background-clip: content-box;
      }
      *::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 212, 255, 0.28);
      }
      *::-webkit-scrollbar-corner {
        background: transparent;
      }

      /* highlight.js (minimal, themeable) */
      .hljs {
        color: var(--ds-code-text);
      }
      .hljs-comment,
      .hljs-quote {
        color: var(--ds-code-comment);
      }
      .hljs-keyword,
      .hljs-selector-tag,
      .hljs-subst {
        color: var(--ds-code-keyword);
      }
      .hljs-string,
      .hljs-doctag {
        color: var(--ds-code-string);
      }
      .hljs-title,
      .hljs-section,
      .hljs-selector-id {
        color: var(--ds-code-title);
      }
      .hljs-number,
      .hljs-literal,
      .hljs-symbol,
      .hljs-bullet {
        color: var(--ds-code-number);
      }
      .hljs-built_in,
      .hljs-builtin-name {
        color: var(--ds-code-built-in);
      }
      .hljs-attr,
      .hljs-attribute,
      .hljs-variable,
      .hljs-template-variable,
      .hljs-type,
      .hljs-selector-class {
        color: var(--ds-code-attr);
      }
      .hljs-meta,
      .hljs-meta-string {
        color: var(--ds-code-meta);
      }
      .hljs-emphasis {
        font-style: italic;
      }
      .hljs-strong {
        font-weight: 600;
      }
      .hljs-link {
        text-decoration: underline;
      }

      .ds-workspace-tree .ant-tree-node-content-wrapper,
      .ds-workspace-tree .ant-tree-title {
        white-space: nowrap;
      }

      .ds-floating-island {
        position: fixed;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        /* Ensure draggable items can be dropped onto the island even when antd Drawer/Modal masks are visible. */
        z-index: 1200;
        width: calc(100vw - 24px);
        max-width: 2000px;
        pointer-events: none;
      }
      .ds-floating-island-inner {
        pointer-events: auto;
        background: var(--ds-floating-bg);
        border: 1px solid var(--ds-floating-border);
        border-radius: 22px;
        box-shadow: var(--ds-floating-shadow);
        padding: 16px 18px;
        backdrop-filter: blur(10px);
        width: 100%;
        transition: padding 180ms ease, border-radius 180ms ease;
      }
      .ds-floating-island-inner.is-drag-over {
        border-color: var(--ds-focus-ring);
        box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.2), var(--ds-floating-shadow);
      }
      .ds-floating-island-inner.is-collapsed {
        padding: 10px 14px;
        border-radius: 999px;
      }
      .ds-floating-island-handle {
        cursor: pointer;
        user-select: none;
        width: 100%;
      }
      .ds-floating-island-handle:focus-visible {
        outline: 2px solid var(--ds-focus-ring);
        outline-offset: 2px;
        border-radius: 999px;
      }
      .ds-floating-island-inner .ant-space-vertical,
      .ds-floating-island-inner .ant-space-vertical > .ant-space-item {
        width: 100%;
      }
      .ds-floating-island .ant-select-selector,
      .ds-floating-island .ant-input-affix-wrapper,
      .ds-floating-island .ant-input {
        border-radius: 16px !important;
      }
      .ds-floating-island .ant-input-textarea,
      .ds-floating-island .ant-input-textarea textarea.ant-input,
      .ds-floating-island .ds-dispatch-input,
      .ds-floating-island .ds-dispatch-input textarea.ant-input {
        width: 100% !important;
      }
      .ds-floating-island textarea.ant-input {
        resize: none;
      }
${extra}
    `}</style>
  );
}
