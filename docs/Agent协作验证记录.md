# Agent 协作验证记录

验证日期：2026-09-07。范围是主任务双向修改，不涉及 PKC 或 Obsidian。

| 检查 | 结果 |
| --- | --- |
| 前端类型检查、生产构建 | 通过 |
| 前端测试 | 30 项通过，包含保存期间继续编辑、离线重试、冲突处理、专注与完成同时发生的处理 |
| Rust 后端测试 | 56 项通过，包含已有数据迁移与持久化回归、重复创建、过期更新和快照合并 |
| MCP Server 构建 | 通过；4 个标准 MCP 工具可发现和调用 |
| 真实 Tauri / WebView2 桌面往返 | 通过；接口新增 → 界面编辑标题、优先级、日期 → 接口读回 → 外部再修改 → 界面更新 |
| 冲突与重复请求 | 通过；编辑草稿保留、过期写入被拒绝、重复创建不重置手动编辑 |
| 原有桌面行为 | 通过；实际 Alt+F 隐藏后仍能更新任务，恢复可见；专注启动、暂停、结束可用，专注期间 Agent 不能直接完成该任务 |
| 本机 Hermes MCP 客户端 | 通过；创建、读取、修改、查询均实际执行 |
| Hermes 实际模型对话 | 通过；使用现有 openai-codex / gpt-5.6-sol，创建一条测试任务，读取后将优先级从 medium 改为 high，持久化结果一致 |
| 独立运行版 | release 可执行文件已构建、启动；通过保存到 Hermes 的配置读取正式 Inky 数据目录成功 |

所有写入测试使用独立测试目录。正式数据目录的验收只读取，不写入测试任务。测试时未加载 Hermes 的记忆或项目上下文文件。

证据：`output/agent-desktop-verification.json`、`output/hermes-mcp-verification.json`、`output/hermes-model-verification.json`、`output/hermes-release-verification.json`。桌面往返脚本为 `scripts/verify-agent-desktop.cjs`。测试窗口已退出。自动审批审核拒绝了递归清理及随后缩小范围的具名测试文件清理，仅返回“blocked by policy”；临时数据库、测试环境和调试截图暂留在 `output/`，正式运行版不使用它们。

本次同时增加的 10 题固定只读模型评估位于 `integrations/inky-mcp-server/evaluation/`，使用虚构测试数据；尚未进行完整的 10 题模型评分。其他 Agent 客户端也未逐一验证。

Hermes 配置只增加 `mcp_servers.inky`，原有设置保持不变；同目录备份为 `config.yaml.before-inky-20260907-164003.bak`。已有 Hermes 会话需要重新加载工具，建议开启新会话。
