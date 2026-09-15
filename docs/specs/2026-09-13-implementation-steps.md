# Inky Paper 分步实现

依据：本次新设计与用户确认。旧方案已停用。本次实现不访问或修改 Inky-app。

已确认：Coach 仅在用户询问时运行；保留 SQLite 维护任务与计时的一致性，自动保存可读 Markdown，个人笔记可编辑；新增专用 Hermes 插件，在对话中选择、修改卡片并加入 Inky。

| 步骤 | 结果 | 当前状态 |
| --- | --- | --- |
| 1. 按需 Coach | 旧设置也不能自动调用模型或发起 Coach 提醒，保留用户求助和到点通知 | 已完成 |
| 2. 计划与执行记录 | 多步骤、候选卡片、原子采用、每日安排、进度回写、Markdown | 已完成 |
| 3. Hermes 完整入口 | 对话卡片选择与修改；读取最新事实；按请求生成并保存每日总结 | 已完成并安装启用 |
| 4. 验收与交付 | 独立数据验证完整流程，构建并核对 app/Inky Paper.exe | 已完成，0.5.0 |

基线：2026-09-13 类型检查通过，前端 43 项通过，Rust 28 项通过、1 项 ignored。后续检查针对最终改动重跑。

分工：主代理负责 Paper 执行界面、Markdown 保存和整体交付；subagent 分别负责按需 Coach、计划数据接口、Hermes 插件和 MCP。关键数据关联与接口先对齐，子代理完成后统一复查。

验收重点：三选二只加入两项；提交重试不重复；执行后能回读同一任务与步骤的进展；旧卡片冲突不覆盖新内容；Markdown 保留个人笔记；总结与所读版本对应；没有用户请求时不调用 Coach。所有可变桌面和模型验证使用独立测试数据。

## 最终结果与证据

- 类型检查和 release 构建通过。前端 52 项通过；Rust 53 项通过、1 项历史负载 benchmark 默认忽略；插件前端 5 项、Python HTTP 代理 7 项通过。MCP stdio 验证 12 个工具，不包含采用或时钟操作。
- 真实 Hermes 界面三选二、修改为 20 分钟并上移采用；Paper 显示相同两项。第一张由真实 WorkStart 开始，暂停后完成步骤；第二张继续本段工作并开始新一轮，记录卡点。父任务仍待办，两轮日项关联正确，Markdown 自动出现产出与卡点。
- 真实 `gpt-5.6-sol / openai-codex` 仅访问隔离 Paper MCP，实际调用 `get_daily_record → save_daily_summary → get_daily_record`。总结引用手写笔记，准确区分步与任务状态，记录版本、笔记版本和截至时间一致。没有改任务或个人笔记。
- 最终源码重新构建独立 debug 标识后重启，回读两轮记录、个人笔记及当前总结，确认持久化和 Markdown 同步。真实桌面核心流程之外的冲突、未知响应重试与跨午夜矩阵由自动测试覆盖。
- 正式 Hermes 已安装 `C:\Users\31009\.hermes\plugins\inky-coach`，CLI 与桌面开关均已启用，后端路由通过无数据请求验证。配置差异仅为 `plugins`，原 MCP 配置不变；配置与旧 Paper 可执行文件备份在本轮 `before` 目录。Hermes 随后以正常参数重开，测试进程关闭。

证据集中在 `output/implementation-20260913/`：`desktop-verification.json`、`restart-verification.json`、`planning-model-verification.json`、`plugin-installation.json`、`hermes-plugin-acceptance.md`。真实截图在其 `hermes-test/` 和 `output/playwright/implementation-20260913/`。

最终 `app/Inky Paper.exe` 与 release 文件均为 **0.5.0**，SHA-256：`BF29619C6543CBC6022336E359E65CAE5BE15B7F0CE5CEA9AE9C30B193E70BD9`。交付时检测到旧 Paper 进程仍在运行，保留当前工作，由用户退出旧进程后重新打开新版；未在正式数据库做可变验收。

功能验收不等同于长期注意力或生产力改善证据。后续试用重点是减少重复输入、日记录是否好读以及卡片粒度是否合适。
