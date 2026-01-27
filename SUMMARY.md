chatos 是一个基于 Node.js 的多模型终端聊天客户端与桌面应用，作为 model-cli-js 的增强版，主代理负责编排，子代理通过 MCP 工具与子代理市场执行任务，支持任务追踪、Shell 会话、UI 交互提示、运行中纠正、自动总结与配置/会话报告。
项目由 CLI 入口（src/cli.js -> cli/src/index.js）、AIDE 引擎与 MCP/子代理实现（packages/aide）、Electron 主进程与管理服务（electron）以及 React/Ant Design 前端（apps/ui）构成。
技术栈包含 Node.js ESM（>=22）、Electron、React/Antd、Ink CLI、@modelcontextprotocol/sdk，数据侧使用 SQLite（better-sqlite3/sql.js）与 YAML 配置。
