# 0.6.2 工作台每日记录与 Markdown

工作台使用现有 `get_daily_record` 同步当天计划与执行事实，增加独立原文读取命令。SQLite 和 Markdown 的原有保存机制继续使用，没有整份状态覆盖接口，也没有自动 Coach 请求。

## 检查结果

- 类型检查和最终 debug / release 前端编译通过；前端 107 项通过，Rust 68 项通过，1 项历史负载基准忽略。
- 测试使用 `com.inky.paper.dev.workbench` 标识，以及 `output/workbench-records-062/paper-test` 独立数据库。临时计时和测试笔记只写入隔离目录。
- 真实 Tauri 测试覆盖：历史计划显示当前完成状态但不误算到当天；原 Paper 窗口的完成与撤销实时同步；未安排日程的实际计时、完成反馈与随手记也显示在当天；Markdown 原文与磁盘一致；外部个人复盘自动刷新，HTML 字符按原文显示；无文件的日期显示空状态；全部任务文件明确展示当前全局状态；1060px 窄布局无横向溢出。
- 补充检查核对了工作时段使用的 `achieved / advanced / blocked` 进展值，确认工作时段记录可单独显示而不生成计时。

## 使用与范围

「每日记录」显示已记录事实；「Markdown」是只读原文页面，编辑个人复盘可点击「打开原文件」。原文只读不意味着文件不会由现有 Paper 同步机制更新。全部任务文件显示最新状态，不充当历史快照。

原文读取限制为每份 2MB，过大或编码不符时提示打开原文件，不将截断文字展示为完整文件。空日期不会因原文读取而创建日记录。本轮没有重新调用 Hermes 模型或操作系统默认 Markdown 编辑器。

## 证据

- [真实桌面检查](desktop-verification.json)
- [每日记录](daily-record.png)、[日程摘要](calendar-records.png)、[Markdown 原文](markdown.png)、[窄窗口](narrow-record.png)
- [交付版本与哈希](release-verification.json)

复现命令（选择新的 RunName）：

```powershell
corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-workbench-dev.json
./scripts/desktop/launch-workbench-acceptance.ps1 -RunName workbench-records-new
node scripts/desktop/verify-workbench-records.mjs workbench-records-new
```
