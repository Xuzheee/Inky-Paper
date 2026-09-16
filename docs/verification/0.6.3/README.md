# 0.6.3 工作台日期、范围与执行入口

日期：2026-09-16。在 `codex/inky-workbench` 实现，先合并纸面分支 `4a1137c`，保留便签字体与 90% 番茄钟缩放，再经集成分支统一交付。

## 结果

- 每次消息保存日期、任务与步骤范围，候选卡片采用发送时日期或明确指定日期；切换查看日期、刷新、重启不改变它。手动改期和不确定请求重试保留原参数；旧建议无日期时必须选择。
- Coach 顶部显示讨论范围。第二、三列任务使用各自日期；回复中切日会区分本次回复与下次发送，进入记录或取消选择会清除旧任务范围。
- 任务详情与已采用卡片可以直接选好下一步回到 Inky，便签与时长同步，start 仍由用户点击；活动番茄钟期间拒绝替换步骤，普通返回入口保持计时。

## 本轮检查

`corepack pnpm typecheck` 通过。前端 112 项通过，包含请求日期、手动改期、旧卡日期、相同请求重试、流式回复中切日、明确指定日期恢复和已采用卡片不重复核对。Rust 70 项通过、1 项历史负载基准忽略，新增旧历史兼容/重启范围保存与计时保护检查。

使用真实 debug Tauri/WebView2、开发标识 `com.inky.paper.dev.workbench`、CDP 9254，以及独立 `output/workbench-context-063/` 数据与 WebView 目录。真实 Hermes ACP 读取测试任务并通过 Paper MCP 生成候选；采用由 UI 点击。只使用隔离测试数据。

原生流程覆盖第二天任务范围、回复中切回今天、建议只加入明天、候选与任务详情两个返回入口、返回后正确便签/时长/零计时、手动 start、运行中拒绝替换、普通返回保持计时、刷新与完整进程重启。脚本收尾首次使用了无效测试枚举 `unfinished`，后端正确拒绝；改为受支持的 `stopped` 后从收尾继续，未重跑真实模型请求。最终 UI 修正后重新构建 debug 并完整重启，确认已采用卡片不再显示多余的采用核对。没有页面异常。

证据：[原生结果](desktop-verification.json)、[发送范围](request-date.png)、[返回 Inky](back-to-inky.png)、[最终重启界面](restart-history.png)、[release 校验](release-verification.json)。

重跑：`scripts/desktop/verify-workbench-context.mjs <全新隔离目录名>`，完整退出并以同一隔离数据重启后运行 `verify-workbench-context-restart.mjs <目录名>`。构建、启动方法同 `scripts/desktop/launch-workbench-acceptance.ps1`；不得指定正式数据目录。

本轮未扩展为全部工作台视觉、第三方日历或全部番茄钟页面的验收；字体缩放的完整历史证据见 [原分支报告](../compact-focus-20260915/README.md)。

隔离测试进程已正常退出。自动审批以 `blocked by policy` 拒绝删除本轮测试目录，因此该目录保留在 Git 排除的 `output/`，没有再次尝试删除；报告和截图位于本目录。正式运行进程保持原状，用户正常退出再打开即可加载新版。
