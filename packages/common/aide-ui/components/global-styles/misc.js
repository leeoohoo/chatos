export const GLOBAL_MISC_STYLES = `

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
`;