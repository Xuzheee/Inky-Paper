# 便签字体与番茄钟缩放

2026-09-15，`codex/markdown-coach`，0.6.1 基础上的分支改动。尚未合并更新桌面正式版。

首页绿色便签使用随包 Xiaolai（小赖）20px 手写体、常规字重。便签布局、时间与 start 保留，下方任务清单不换字体。

番茄钟按原 400×210 构图整体缩至 90%，原生窗口目标约 360×189；暂停 360×274，随手记/菜单 360×359。CSS zoom 同步缩小文字、图标、按钮和间距。结束页、休息页及迷你宠物保留各自尺寸。系统显示缩放会带来约 1px 舍入，本机 150% 下普通窗口实际为 360×190。

## 验证

类型检查、104 项前端测试、1 项 Rust 窗口布局专项与 release 构建通过。

原生 Tauri / WebView2 使用 `com.inky.paper.dev.execution`、CDP 9252 和本 worktree 下独立空测试目录 `output/compact-focus-final/paper-test`。脚本写入前核对连接文件的绝对路径；未读写正式数据库。

实际字体查询确认便签使用打包的 Xiaolai。短/长便签、90% 构图、拖动、运行10秒透明、深浅及混合背景、暂停/继续、随手记、键盘唤醒、减少动画、返回列表后仍计时、结束保存、长标题/三位分钟和迷你宠物返回均通过。纸面/透明态坐标一致，正常/暂停/随手记无滚动溢出。未重跑 Hermes 模型或工作台全部流程。

实际截图：[首页](home-short.png)、[长便签](home-long.png)、[番茄钟](paper.png)、[透明态](transparent.png)、[暂停](paused.png)、[随手记](note.png)、[长任务](long-task.png)。

[原生验证记录](verification.json) · [实际字体](sticky-fonts.json) · [分支交付文件校验](release-verification.json)

## 重跑

在当前 worktree 执行，使用新的独立目录名：

```powershell
corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-execution-dev.json
./scripts/desktop/launch-focus-acceptance.ps1 -RunName compact-focus-check
node scripts/desktop/verify-focus-transparency.mjs compact-focus-check
```
