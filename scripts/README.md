# 项目脚本

从项目根目录运行命令。自动化测试入口见 [项目说明](../README.md)。

- `prepare-paper-pets.py`：从保存的蜡笔原图重建透明宠物资源；属于素材工具，日常构建不需要运行。
- `desktop/`：结束页、休息页与独立提醒窗口的原生验收，使用独立 debug 标识和独立数据目录。
- `diagnostics/`：只读进程诊断。显式传入目标 PID；历史默认 PID 不可复用。
- `archive/`：旧版本一次性验收源码，留作取证参考，依赖已经删除的历史测试环境或旧文案，不属于当前验证入口。尤其不要用旧正式版空库检查脚本验证已有工作记录的应用。

## 原生页面验收

```powershell
corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-test.json
./scripts/desktop/launch-acceptance.ps1
node scripts/desktop/verify-session-pages.mjs
```

输出在 `output/desktop-acceptance/`。脚本在写入前核对连接文件属于该隔离目录，并要求任务为空；不接受正式连接。新一轮验收前，先关闭上一次验收进程，再归档或清理这个目录。完成后从测试窗口托盘退出；也可核对 PID 的可执行路径后停止对应 debug 进程。不要结束正式 Paper 或 Hermes。

页面脚本验证字体实际加载、拖动、选项动画与键盘、草稿、保存、长文本自适应与全文阅读、细滚动条、页脚留白、休息和 Markdown。它不代表对全部页面或真实模型的完整验收；证据见 [验证归档](../docs/verification/README.md)。

并行开发中的纸面分支改用自己的标识及 9252 端口，并传入一个全新的目录名：

```powershell
corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-execution-dev.json
./scripts/desktop/launch-focus-acceptance.ps1 -RunName end-pages-check
node scripts/desktop/verify-session-pages.mjs end-pages-check
```

## 独立操作提醒验收

```powershell
corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-test.json
./scripts/desktop/launch-notice-acceptance.ps1
node scripts/desktop/verify-notice-window.mjs
```

需要 Python 和项目中的 Playwright 依赖。使用端口 9251，隔离数据在 `output/notice-window-20260915/`，截图在 `output/playwright/notice-window-20260915/`。同样要求新的空测试目录；操作前核对桥接路径。脚本检查真实 Win32 可见性、焦点、保存和休息后的提醒、各关闭入口、连续提醒的过期保护、重载与业务数据不变。它只生成测试任务，不调用 Hermes 模型。完成后核对 PID 路径并退出隔离 debug 进程。

## 番茄钟透明态验收

```powershell
corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-test.json
./scripts/desktop/launch-focus-acceptance.ps1
node scripts/desktop/verify-focus-transparency.mjs
```

端口 9252，默认独立空数据目录 `output/focus-strip-acceptance/`，截图在 `output/playwright/focus-strip/`。脚本检查 400×210 横向纸条、原生拖动、10 秒淡出、坐标稳定、深浅背景、暂停 / 记录、键盘、导航、保存、长标题和迷你宠物。测试背景仅应用于 WebView 的 body，检查后恢复，不修改系统桌面。结束后核对 PID 路径并退出隔离进程。

重跑时可用新目录名：先 `./scripts/desktop/launch-focus-acceptance.ps1 -RunName focus-check-2`，再 `node scripts/desktop/verify-focus-transparency.mjs focus-check-2`，两处名字需相同。

`node scripts/desktop/compare-focus-design.mjs` 使用已安装的 Edge 无头渲染原型与截图的比较页，保留原图文件，输出 `comparison.png` / `comparison.html`。组合图不能代替真实 Tauri 交互验收。
