# Inky Paper

独立的 Windows 专注与工作记录应用：工作台用于计划、日程和按需 Coach 对话，Paper 用于执行、计时和轻量收尾。

本机当前交付 **0.7.0-beta.1 试用版**。已完成 M0—M4 分阶段验收；M5 的部分功能已实现，完整 Coach 案例评测及剩余桌面验收后移。试用版已本地交付，尚未推送或发布到 GitHub；远端历史发布是0.6.4。

## 打开与使用

双击 `启动 Inky Paper.cmd` 或 `app/Inky Paper.exe`。桌面使用 **Inky Paper** 快捷方式，另一个 **Inky** 是独立旧应用。首页底部点击「工作台」即可进入计划窗口，也可运行 `启动 Inky 工作台.cmd`。

1. 在工作台安排今天的步骤，或向 Coach 提问；建议需要点击采用才修改计划。
2. 选择「设为下一步并回到 Inky」，或在 Paper 点击 **Do this**；准备步骤不会开始计时。
3. 点击 **start** 执行，结束时可跳过反馈；完成步骤不自动完成父任务。
4. 在工作台查看每日记录与 Markdown，下次继续原步骤。

`Alt + Shift + F` 显示/隐藏，托盘菜单完全退出。更新后退出旧进程再打开新版。Coach 需要本机 Hermes 与 Node.js，只在发送问题时调用。

## 常用文档

- [文档导航](docs/README.md)：按使用、开发、验证分类。
- [Paper 使用说明](docs/每日计划与Coach使用说明.md) / [工作台使用说明](docs/工作台使用说明.md)。
- [当前状态](docs/PROJECT_STATUS.md) / [试用版交付记录](docs/verification/0.7.0-beta.1/README.md)。
- [后续待办](docs/plans/p0p1/M5_PENDING.md) / [数据升级与恢复](docs/plans/p0p1/data-recovery.md)。

## 数据边界

任务、步骤、安排和执行事实保存在 `%APPDATA%\com.inky.paper\paper.sqlite3`，同目录 `工作记录/` 导出可读 Markdown。个人笔记可手改，不自动覆盖；手改生成区不反向修改任务。计时不证明注意力或生产力，空白时间保持未知。

模型只读取事实、提出候选或按请求保存总结，不能直接采用、控制时钟或完成任务。Paper 独立于 `Inky-app`，不共享它的数据与连接。源码入 Git；数据库、连接凭据、WebView配置、构建输出与exe不入库。

## 开发与构建

需要 Windows、Node.js/Corepack、Rust MSVC、Tauri Windows构建组件和WebView2。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --dir integrations/inky-paper-mcp-server install --frozen-lockfile
corepack pnpm tauri dev
```

单独 `corepack pnpm dev` 只预览前端，不能代替原生桌面验证。

```powershell
corepack pnpm typecheck
corepack pnpm test:frontend
cargo test --manifest-path src-tauri/Cargo.toml
corepack pnpm tauri build --no-bundle
```

构建输出为 `src-tauri/target/release/inky-paper.exe`。交付前正常退出旧程序、备份原exe，再同步到 `app/Inky Paper.exe` 并核对SHA-256；数据回退另见恢复说明。

开发者写入验收只用独立debug数据和WebView目录。正式版忽略 `INKY_PAPER_TEST_DATA_DIR`，不能当测试库。规则见 [AGENTS.md](AGENTS.md)，双分支目录与端口见 [并行开发](docs/PARALLEL_DEVELOPMENT.md)，脚本见 [scripts/README.md](scripts/README.md)。

旧版本设计和验证属于历史记录，不能当作当前功能或本轮验收。
