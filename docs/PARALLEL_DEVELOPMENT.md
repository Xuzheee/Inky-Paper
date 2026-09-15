# 两项任务并行开发

2026-09-15 将已完成的纸面专注界面和 0.6.1 工作台保存为共同起点 `745fce7`。每个工作目录都有完整源码，但各自的修改和提交互不覆盖。

| Codex 任务 | 分支 | 工作目录 |
| --- | --- | --- |
| 接入 Markdown 工作计划与 Coach | `codex/markdown-coach` | `C:/Users/31009/.codex/worktrees/f8f7/Inky-Paper` |
| 规划 Hermes Agent 工作台 | `codex/inky-workbench` | `C:/Users/31009/clauddd/Inky-Paper` |

第一项任务经 Codex 迁移后，任务 ID 为 `01a0a512-dc60-70a0-9323-37e6636774b1`，原 ID 为 `01a09a47-bdb7-7c92-86ed-cb44b7919eae`。第二项任务 ID 仍为 `01a0a498-8687-7bb1-8d34-1a7067919d5c`。

## 修改与提交

在对应任务里继续提出修改即可。开始前检查 `git branch --show-current` 与 `git status --short`，只写当前目录；迁移前聊天记录里的绝对路径已不适用于第一项任务。每边完成一个完整改动后分别提交，不在两个目录中切换到同一个分支。

纸面任务、番茄钟、结束页与 Markdown 记录由第一项任务继续处理；独立工作台、日程、ACP 和工作台入口由第二项处理。`src/paper/PaperApp.tsx`、`src-tauri/src/main.rs`、共享数据类型和版本文件可能两边都会修改，应按函数或区域局部修改，合并时一起检查。

各 worktree 自行安装依赖、生成 `dist` 和 `src-tauri/target`。这些目录不共享，也不要从另一 worktree 拷贝已修改源码。当前本机正式启动程序仍在原项目的 `app/Inky Paper.exe`。

## 同时运行开发窗口

分支只隔离源码；端口、应用标识、数据和浏览器配置还需要分别指定。以下命令都在对应 worktree 的独立终端执行，使用 debug 开发模式。两个配置只用于开发与 debug 验证，不用于正式 release。

纸面与专注任务：

```powershell
$env:INKY_PAPER_TEST_DATA_DIR = Join-Path (Get-Location) 'output/parallel-execution/paper-test'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path (Get-Location) 'output/parallel-execution/webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9252'
corepack pnpm tauri dev --config scripts/desktop/tauri-execution-dev.json
```

工作台任务：

```powershell
$env:INKY_PAPER_TEST_DATA_DIR = Join-Path (Get-Location) 'output/parallel-workbench/paper-test'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path (Get-Location) 'output/parallel-workbench/webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9254'
corepack pnpm tauri dev --config scripts/desktop/tauri-workbench-dev.json
```

两边开发服务分别使用 1423 / 1422 端口，应用标识分别为 `com.inky.paper.dev.execution` / `com.inky.paper.dev.workbench`。工作台通过首页「工作台」或托盘入口进入。做正式桌面验收时选择新的独立测试目录；已有验收脚本会设置自己的数据路径和调试端口。

## 合并与交付

两边都提交并检查通过后，由一次集成任务创建 `codex/inky-integration` 分支，合并 `codex/markdown-coach` 和 `codex/inky-workbench`。检查共享文件的冲突，运行相关检查与桌面流程，再统一更新 `main` 和正式 `app/Inky Paper.exe`。不能通过复制某一分支的可执行文件代表两个分支已经集成。

本轮只配置本机并行工作环境，未推送到远程仓库。
