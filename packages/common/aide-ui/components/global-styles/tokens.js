export const GLOBAL_STYLE_TOKENS = `
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
`;