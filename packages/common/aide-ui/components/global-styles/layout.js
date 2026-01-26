export const GLOBAL_LAYOUT_STYLES = `

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

`;