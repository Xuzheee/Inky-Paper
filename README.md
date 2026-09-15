# Inky Paper

Inky Paper 是一个独立的 Windows 专注与工作记录应用。Hermes 在用户询问时帮助安排、拆分和复盘；Paper 用纸面任务清单和番茄钟承接执行，SQLite 保存共同状态，Markdown 方便阅读和写个人笔记。

当前应用版本 **0.5.11**，Inky Coach 插件版本 **0.1.3**。当前进度、验证范围和待检查项见 [项目进度](docs/PROJECT_STATUS.md)。

源码已接入私有仓库 [Xuzheee/Inky-Paper](https://github.com/Xuzheee/Inky-Paper)，默认分支 `main`。Git 管理代码与项目文档，个人工作记录继续保存在本机。

## 打开与使用

本机交付版双击 `启动 Inky Paper.cmd`，或打开 `app/Inky Paper.exe`。更新文件后，需要从托盘退出旧进程再打开，才能加载新版本。设置中可确认版本。源码仓库不包含可执行文件，首次克隆后按下方步骤构建。

1. 在 Paper 添加任务，或在 Hermes 询问 Coach，生成简短计划卡片。用户在聊天中选择、修改、排序，再点击“将所选卡片加入 Inky”。采用卡片不会开始计时。
2. 在纸面清单展开大任务，点击某一步的 **Do this**，将它放到上方浅绿便签。简单任务可以只有一个动作；相同的任务名和步骤不会重复显示。
3. 调整时长，点击 **start** 才开始番茄钟。“返回任务列表”保留当前计时，“结束番茄钟”先暂停，再进入结束页。
4. 按需填写“补充记录”，选择“还没完成”或“已完成”，点击 **保存并结束**。保存前只是本轮草稿；“已完成”只完成当前步骤，父任务单独完成。也可用勾选或鼠标短横划完成，内容留在原位。
5. 在“今日计划与记录”看实际推进，打开 Markdown 写个人复盘。需要建议或每日总结时再询问 Coach；同步记录不会自动调用模型。

`Alt + Shift + F` 显示或隐藏窗口，托盘菜单可退出。首页、结束页和休息页共用每次启动随机选定的英文标语。完整操作、按钮结果和连接排查见 [使用说明](docs/每日计划与Coach使用说明.md)。

保存和结束休息等操作反馈显示在独立的纸面小弹窗中，不占任务页空间、不抢焦点。点“知道了”、右上角关闭或在 Paper 按 Esc 可收起；也会在 8 秒后自动收起。

番茄钟使用已选定的横向纸条：手写任务在左、数字在右，底部保留暂停、鱼和随手记。正常窗口 400×210，暂停和记录时向下展开。10 秒未在窗口内操作会淡出纸面与辅助控件，留下计时、铅笔进度和返回 / 结束入口；透明态不残留底色，也不移动数字。移动鼠标或按键恢复纸面，暂停或编辑随手记期间保持显示。

## 数据边界

| 内容 | 位置与规则 |
| --- | --- |
| 正式任务、步骤、计时、事件 | `%APPDATA%\com.inky.paper\paper.sqlite3`；SQLite 是共同状态源 |
| 可读工作记录 | 同目录的 `工作记录/`；自动导出任务、每日安排、执行记录和按请求保存的总结 |
| 个人笔记 | `个人笔记.md`、`每日/YYYY-MM-DD.个人笔记.md`；可手改，不自动覆盖 |
| 本机连接 | `paper-agent-bridge.json`；Paper 启动时更新凭据，不上传到 Git |
| 源码与交付物 | Git 保存源码、文档、必要素材和许可证；本机数据、构建缓存、测试数据库和 exe 不入库 |

任务修改在 Paper 或 Hermes 的命名操作中完成。手改自动生成的 Markdown 不会导入任务，后续同步会另存手改备份；导出失败不撤销已经提交的事实。计时只表示时钟区间，不证明注意力或生产力，空白时间保持未知。

本项目独立于 `Inky-app`，使用应用标识 `com.inky.paper`、MCP 连接 `inky_paper` 和开发端口 `1422`。不读取或覆盖原应用的数据、连接和可执行文件。Agent 不能控制番茄钟或工作时段，也不能自动采用候选卡片。

## 开发、构建与验证

需要 Windows、Node.js / Corepack、Rust MSVC 工具链及 Tauri 所需的 Windows 构建组件和 WebView2。Python 用于 Hermes 插件及相关检查。

在项目根目录安装依赖：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --dir integrations/inky-paper-mcp-server install --frozen-lockfile
```

开发入口：

```powershell
corepack pnpm dev
corepack pnpm tauri dev
```

第一条只启动 `http://127.0.0.1:1422` 的前端预览；真实数据库、拖动、托盘、快捷键和桥接需在 Tauri 中检查。

构建并生成本机交付副本：

```powershell
corepack pnpm tauri build --no-bundle
New-Item -ItemType Directory -Path app -Force | Out-Null
Copy-Item -LiteralPath 'src-tauri/target/release/inky-paper.exe' -Destination 'app/Inky Paper.exe'
Get-FileHash -LiteralPath 'app/Inky Paper.exe' -Algorithm SHA256
```

复制前退出正在运行的旧交付版；已有交付文件应先保留一个回退副本。字体原文件和完整 OFL 许可在 `public/fonts`。

日常检查：

```powershell
corepack pnpm typecheck
corepack pnpm test:frontend
cargo test --manifest-path src-tauri/Cargo.toml
corepack pnpm test:hermes-plugin
python -B -m unittest discover -s integrations/inky-coach-hermes-plugin/tests -p "test_*.py"
node integrations/inky-coach-hermes-plugin/tests/verify-mcp.mjs
```

真实桌面写入验收只用独立调试数据。调试版设置 `INKY_PAPER_TEST_DATA_DIR`，并使用独立 WebView 用户目录；操作前核对连接实际指向测试目录。正式版忽略该测试变量，不能拿正式版作为隔离写入环境。`scripts/desktop/verify-session-pages.mjs` 用于结束和休息页的隔离桌面检查。`scripts/archive/` 是历史验收脚本，路径、端口与夹具可能过期，不直接运行到日常数据。

## 文档与目录

- [项目进度与验证范围](docs/PROJECT_STATUS.md)、[当前人工检查清单](docs/MANUAL_CHECKS.md)
- [每日计划与 Coach 使用说明](docs/每日计划与Coach使用说明.md)、[Hermes 插件安装与开发](integrations/inky-coach-hermes-plugin/README.md)
- [项目协作规则](AGENTS.md)：当前设计、数据边界和交付约定
- `src/paper/`、`src-tauri/src/`：当前前端与 Rust 后端；`public/`：随应用打包的素材与字体
- `integrations/`：Paper MCP 服务及 Hermes 插件；`scripts/desktop/` 和 `scripts/diagnostics/`：桌面验收与诊断辅助脚本
- `docs/verification/`：保留的版本验证报告和截图；`docs/archive/` 及历史设计文档只作演变记录，当前行为以使用说明和代码为准

`app/` 是本机交付目录，`output/` 是可重新生成的验收或打包输出。二者不作为源码维护入口。
