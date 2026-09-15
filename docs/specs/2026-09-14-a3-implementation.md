# A3 便签与任务清单：0.5.2 交付

用户已确认 A3 原型。本版将浅绿便签、独立选用按钮和任务原位划线接入实际 Paper 应用。

## 实际行为

- 便签内容居中、顶部胶带、轻阴影；时长与 start 同行。适配原有 320 × 520 窗口，短标题实测约 243 × 133 CSS 像素，宽占可用纸面约 78%；长文字自然换行。
- 点大任务展开详情；点步骤正文不切换。独立“选用”把步骤放进便签，再点 start 进入番茄钟。没有多步的任务可直接选用。
- “整个任务完成了”或鼠标横划标题都使用同一个版本化任务更新。完成后打勾划线、留在原序，旁边可撤销，不跳到庆祝页。手势仅识别鼠标左键跨标题的平稳横线；短移、竖移、取消、触摸不完成，计时或保存中禁用。
- 单步骤与多步骤完成都有划线反馈。完成父任务不会自动完成其余步骤；既往番茄钟快照保持原状。Coach 短标题规则已在上一阶段同步到插件 0.1.2，不自动改写既有任务。

## 验证

`corepack pnpm test:frontend`：80 条通过；TypeScript 构建检查通过。`cargo test --manifest-path src-tauri/Cargo.toml`：53 条通过，1 个显式历史负载基准未运行。独立审阅发现单步骤完成标识缺失，已修复并补验证。

真实 debug WebView 使用独立应用标识、`paper-test-final` 数据目录和专用 WebView 缓存。8 项实际交互检查通过：便签几何、正文与选用分离、简单任务选择、start 与当前步骤匹配、计时期间禁用替换、步骤与父任务分开、按钮/鼠标划线/撤销原序持久化、日记录和 Markdown 同步。没有操作生产任务或调用模型生成计划。

- 验证记录：`output/a3-implementation-20260914/desktop-verification.json`
- 实际截图：`output/playwright/a3-20260914/a3-crossed-in-place.png`
- 运行脚本：`output/a3-implementation-20260914/verify-desktop.mjs`，需使用空的隔离数据目录
- 人工清单：`docs/人工验收清单-0.5.2.md`

## 可执行文件

发布构建 `corepack pnpm tauri build --no-bundle` 完成，已同步到 `app/Inky Paper.exe`。源文件、交付文件 SHA-256 一致，版本 0.5.2；桌面快捷方式指向交付文件。

SHA-256：`2EB8F9D2B19879033EC6FCE259416E20DCF159B4ADECB9B39F7B61675928496E`。

0.5.1 原文件已备份到 `output/a3-implementation-20260914/before/Inky Paper-0.5.1.exe`。正式应用未被强制关闭，已打开的旧窗口需从托盘退出并重开才会加载新版。隔离测试进程已关闭。

临时文件清理被自动审批拦截（工具返回 `blocked by policy`，未给具体原因）；首次验收遗留文件保留在本次 output 下。发布及当前数据不受影响。完整交付证据见 `output/a3-implementation-20260914/release-verification.json`。
