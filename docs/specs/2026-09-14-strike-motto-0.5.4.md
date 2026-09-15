# Inky Paper 0.5.4：划线范围与英文标语恢复

用户反馈手划很难触发、可划范围小，且原来的底部英文激励语消失。

## 修复

原实现只监听文字 span，要求横穿其宽度的 55%，起止点还必须位于文字中段。现在监听整行非独立控件区域：编号、时长、文字及上下空白都可起笔。短标题约 14px 起、长标题最多 36px 水平位移门槛，不再要求扫过大半段文字。允许轻微弧度，保留帧绘制与保存期间笔迹；轻点、竖向/跨行拖动、取消、滚动、版本变化和忙碌状态不能完成。Do this、勾选框、编辑和折叠箭头仍执行各自操作。

原来的八句英文曾在此前改动中被替换为三句中文，footer 又位于全部任务和导航后。已从本项目 `output/repair-20260911/baseline/PaperApp.tsx:109` 恢复原始八句至 `src/paper/mottos.ts`。每次应用启动随机一次，切页与数据刷新不重抽，恢复 `lang="en"`。首页内容由 `home-body` 独立滚动，footer 保留独立空间，不遮任务；Do this 的回顶目标随之更新为 home-body。

## 验证与交付

- 前端 104 条、后端 61 条通过，1 个历史负载基准保持跳过；TypeScript 检查与发布构建通过。
- 独立 debug WebView 的 6 组验证通过：原始标语/切页稳定/底部可见；42px 从行内空白与时长起笔；小拖/竖拖/按钮排除；换行长标题短划；父任务编号区域起笔与撤销；日记录/Markdown 同步。
- 实测步骤行约 249×54 CSS 像素，原文字区域仅约 60×22；英文 footer 位于内容滚动区下方，两者无交叠。
- 截图：`output/playwright/strike-motto-20260914/home-english-motto.png`、`wide-row-strike-and-footer.png`。测试证据 `output/strike-motto-20260914/desktop-verification.json`。
- 0.5.4 已同步到 `app/Inky Paper.exe`，桌面快捷方式目标正确，源/交付 SHA-256 一致：`B894B870C1FFAF9CC23637385F64E565188D041E0A8A47615483F6FEBD2D2880`。交付记录 `output/strike-motto-20260914/release-verification.json`。

原 0.5.3 可执行文件备份在本次 output 的 before 目录。正式应用未被强制关闭，当前旧窗口需从托盘退出后重开；隔离测试进程已结束。人工检查见 `docs/人工验收清单-0.5.4.md`。
