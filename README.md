# chatos

面向多模型的 CLI + Electron 桌面聊天工具，带子代理市场、任务追踪与可视化报告（fork 自 model-cli-js）。

English guide: `README.en.md` · 中文详版：`README.zh.md`

## 主要特性
- 子代理市场（默认 Python / Spring Boot / React）
- 主代理负责编排，子代理拥有完整工具权限
- 任务追踪（`mcp_task_manager_*`）
- 启动自动生成 `config-report.html` / `session-report.html`
- UI Prompt MCP（浮动岛表单/选项）
- Shell MCP 会话支持长命令
- 自动总结与历史裁剪
- Electron 桌面端打包与内置 AIDE 引擎

## 快速开始
```bash
npm install
node src/cli.js chat
```


## 桌面端
- 打包：`npm run desktop:dist`（产物在 `dist_desktop/`）
- 本地运行 UI：`npm run ui`
- 也可通过桌面端安装终端命令，实现在无 Node 环境下运行 CLI（详见 `README.en.md` / `README.zh.md`）。

## 聊天内常用指令
`/sub marketplace` · `/sub install <id>` · `/sub agents` · `/sub run <agent_id> <task> [--skills ...]` · `/prompt` · `/summary` · `/tool [id]` · `/reset`

## 工具权限
- 主代理：`get_current_time`、`mcp_project_files_*`、`mcp_subagent_router_*`、`mcp_task_manager_*`
- 子代理：全部已注册工具（含 shell、session 等）

## 配置与报告
- `config-report.html`：模型、MCP、Prompt、子代理清单
- `session-report.html`：聊天记录、任务与工具历史
- 管理数据库：`<stateDir>/chatos.db.sqlite`
- 子代理安装状态：`<stateDir>/subagents.json`

## License
PolyForm Noncommercial 1.0.0（仅限非商业用途）。详见 `LICENSE`。
