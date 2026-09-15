# 结束页排版与保存流程验收

2026-09-15，`codex/markdown-coach` 在 0.6.1 基础上修改。仅在当前 worktree 构建交付；桌面正式版等待两分支合并验收。

## 实际变化

- 手写任务区域固定 126px，保留 Xiaolai 字体及独立铅笔下划线。按字体加载后的实际排版从 42px 缩至 18px；更长内容显示省略号，可打开全文并滚动阅读，Esc 收起。
- 选项下显示保存去向。选择只更新草稿；保存未完成回任务列表，保存已完成划掉当前步骤并到完成页，再选择回列表或休息。父任务独立完成，保存不自动开钟。
- 结束页窗口固定 320×528，展开记录仍保持大小。纸面滚动条 4px；结束页、休息页和首页收紧页脚底部留白，休息窗口 320×430。

## 验证范围

类型检查与 release 构建通过，前端 104 项通过，Rust 67 项通过、1 项历史负载基准忽略。

真实 Tauri / WebView2，150% 系统缩放，应用标识 `com.inky.paper.dev.execution`，CDP 9252。写入前验证连接路径属于本 worktree 下 `output/end-layout-delivery/paper-test`，并要求空测试任务；未读写正式数据库。

原生验收覆盖：短任务 42px、长中文自适应、300 字中英文/换行文本 18px 与全文阅读、实际字体加载、窗口拖动、输入和滚轮不误拖、键盘选择、铅笔动画与减少动画、草稿跨导航/重启保留、两种保存结果、步骤与父任务分开、休息计时、相同记录导出 Markdown。折叠页无滚动条，展开后滚动条宽 4px；记录展开不改变窗口尺寸。

图片来自实际应用：

- [短任务](end-default.png)、[长任务](end-long-task.png)、[极长任务](end-extreme-task.png)、[全文阅读](end-full-task.png)
- [展开记录](end-expanded.png)、[完成后](step-completed.png)、[休息页](rest-running.png)

[桌面验证](desktop-verification.json) 包含实际几何尺寸、通过项和页面错误结果；[字体证据](rendered-fonts.json) 来自 WebView2 实际字体查询；[本分支交付校验](release-verification.json) 记录 release 与 `app/Inky Paper.exe` 的版本及 SHA-256。

未重跑 Hermes 真实模型，也未重新验收全部工作台页面；本轮不改变同步协议或后端任务语义。

测试进程已退出。收尾删除临时测试目录被自动审批以 `blocked by policy` 拦截，未绕过重试；目录保留在被 Git 忽略的 `output/` 下，不进入提交。

## 重跑

在当前工作目录执行，最后两条传入同一个新的目录名：

```powershell
corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-execution-dev.json
./scripts/desktop/launch-focus-acceptance.ps1 -RunName end-pages-new
node scripts/desktop/verify-session-pages.mjs end-pages-new
```
