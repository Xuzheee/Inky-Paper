# 0.6.1 首页工作台入口

首页底部显示「随手记 · 足迹 · 工作台」，点击工作台打开已有独立窗口。采用现有导航样式，宠物和英文标语保留。

## 验证

- `corepack pnpm typecheck` 通过，最终 debug / release 构建中的 TypeScript 检查通过。
- `corepack pnpm test:frontend`：104 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：最终窗口命令修改后 67 项通过，1 项历史负载基准忽略。
- `corepack pnpm tauri build --no-bundle`：最终 0.6.1 release 构建通过。
- 使用独立 debug 应用标识与 `output/workbench-entry-061/paper-test` 数据库，真实 Tauri / WebView2 验证三个入口并列、首次点击创建并加载工作台、再次点击复用同一窗口，打开前后任务 / 计划 / 计时状态相同，无页面异常和横向溢出。测试进程已通过应用退出命令关闭。

首次点击检查发现同步 IPC 创建 WebView2 会卡住，改为异步命令后复测通过；托盘与单实例回调也使用同一异步入口。本轮未重新执行完整 ACP 对话测试，相关既有证据保留在 0.6.0 目录。

## 证据

- [最终导航截图](home-entry.png)
- [真实桌面检查](desktop-verification.json)
- [交付版本与 SHA-256](release-verification.json)

正式数据未用于验收，原有日常进程未被中断。已运行的旧进程需要从托盘退出并重新打开才能加载本次更新。
