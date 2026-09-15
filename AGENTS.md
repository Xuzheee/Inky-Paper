# Inky Paper

面向用户使用简体中文。此目录是独立副本，禁止修改 `../Inky-app` 或使用它的数据与连接。遵循用户已确认的 Paper 方向、简洁任务页、独立专注页、透明宠物，无等级 / XP。

## 当前入口

- `src/paper/PaperApp.tsx` 与 `paper.css`：当前界面。`src/App.tsx` 保留主窗口与提示窗分流；未挂载的原版组件、旧 MCP 和旧等级资产已清理，来源清单与旧设计资料见 `docs/archive`。
- `src/paper/TaskSheet.tsx`、`PencilStrike.tsx` 与 `task-sheet.css`：浅绿便签与编号纸面任务清单。保留左侧品牌、“就从这一步开始”、编号/进度/折叠箭头/虚线样式。展开后独立 `Do this` 更新便签，正文不选择，`start` 才计时；便签重复标题只显示一次。父任务和步骤均可鼠标横划，步骤勾选可完成/撤销；原位保留，父任务与步骤完成分开。
- 划线从整行非独立控件区域起笔（含空白、编号、时长），短横划即可，不要求横穿大半文字。底部原始八句英文标语来自 `src/paper/mottos.ts`，每次启动随机一次；首页 `home-body` 独立滚动，底部宠物和标语常驻且不覆盖内容。不要替换为中文或使其随任务列表滚走。
- 品牌与设置随页面滚动，首页页眉在 `home-body` 内。番茄钟常显“返回任务列表”与“结束番茄钟”，静默淡出也保留入口；返回不改计时，结束入口先暂停再选择结果。
- 番茄钟已采用 `docs/design/focus-options-20260915/01-horizontal.png` 横向纸条。`focus-strip.css` 限定 `.focus-strip`：正常 400×210、暂停 400×304、随手记 / 菜单 400×398；左侧 Xiaolai 24px 手写任务与状态，右侧 DM Sans 52px 计时（三位分钟 42px），底部暂停 / 鱼 / 随手记。长任务至多两行，完整标题通过 title 保留。10 秒无窗口内操作后纸面淡出，导航与计时容器不得另铺底色或投影；透明时使用浅色笔画与细深色描边，计时 / 进度保持原坐标，不照搬静态原型中的数字重排。
- `SessionEnd.tsx` 与 `session-pages.css`：定稿结束页采用居中手写任务、上下留白、细虚线、轻量“补充记录”、完成状态和单个“保存并结束”。默认“还没完成”；状态与笔记先存当前会话草稿，保存后才提交。选“已完成”只完成当前步骤，保留父任务；选“还没完成”仅保存计时和记录。记录展开及长任务允许滚动。
- 结束页手写任务使用用户选择的 C（Xiaolai，小赖）42px；完成选项使用 B（Yozai Regular，悠哉常规）18px。两款原始 TTF 和完整 OFL 许可随包保存在 `public/fonts`，不依赖本机行楷。任务使用独立的微斜、带纸纹的铅笔下划线。`PencilShading.tsx` 用浅铅笔涂抹表示选中，点击后约 480ms 画入；原生单选语义及键盘操作保留，减少动画时直接显示结果。
- `useWindowDrag.ts` 在结束页 `main`、番茄钟横向纸条和独立操作提醒的纸面绑定：标题、任务、纸面空白均可拖动；按钮、单选标签、输入、可编辑区域和滚动条排除。鼠标位移串行合并提交，释放/取消/失焦后清理；不抢触控或滚轮滚动。
- `PaperFooter.tsx` 共用原鱼和八句英文随机标语，首页、结束页、休息中和休息结束共用同一次启动选中的值。结束页短内容窗口为 320×482；休息页为 320×442，使用纸面计时、细进度条，页脚跟随内容。休息返回列表保留计时，结束休息不自动开始下一段。
- `PaperNotice.tsx`、`notice.css` 与 `src-tauri/src/notice_window.rs`：四类操作反馈使用独立 300×156 原生纸面小窗，入口 `?paperNotice=1`，不占首页、不抢焦点。知道了 / X / Paper 内 Esc / 8 秒均可收起；连续提醒替换同一窗口，以标识和代数防止旧关闭操作影响新提醒。只维护临时展示状态，不改任务、计时、Markdown 或 Coach；表单错误和可操作的上下文提示留在原页面。
- `src-tauri/src/paper.rs`：SQLite 持久化、任务 / 步骤 / 执行会话 / 事件、命名事务、版本与幂等校验。
- `src-tauri/src/paper_planning.rs`：候选卡片、用户采用、多步骤、日计划、计时区间、版本化总结。仅本地用户可调用 `set_step_completed`；手动完成/撤销保存 `manualStepChanges`，不生成计时，日记录与 Markdown 包含未安排的手动工作。`src/paper/DayPlan.tsx` 展示安排、计时和手动记录。
- `src-tauri/src/paper_markdown.rs`：SQLite 提交后导出 `工作记录`，个人笔记单独保存且可手改；生成区手改另存备份，不导入任务。导出失败不撤销已提交事实，后续重试。
- `src-tauri/src/paper_bridge.rs`：本机 Bearer 连接和命名操作白名单；不允许 Agent 操作工作时段或专注时钟。
- `src-tauri/src/coach.rs` 与 `coach_runtime.rs`：工作时段、状态/进展、可选本地活动记录及按需 Hermes 提案。Coach 只在用户询问时调用，记录更新与到点不自动发起分析或总结。保留普通到点提示。活动原始标题不写入永久事件流或幂等请求缓存。
- `integrations/inky-paper-mcp-server/index.mjs`：12 个 Hermes MCP 工具。卡片采用不暴露给模型，由 `integrations/inky-coach-hermes-plugin` 的对话控件在用户点击后提交。
- 应用标识 `com.inky.paper`，开发端口 1422，快捷键 Alt + Shift + F。

不要新增全量快照覆盖接口。步骤完成与父任务完成必须分开。开始计时后保留步骤快照，外部重排不能修改既往执行记录。计时不代表注意力或精力，空白时间保持未知。

构建：`corepack pnpm tauri build --no-bundle`。测试：`cargo test --manifest-path src-tauri/Cargo.toml`，`corepack pnpm typecheck`。真实桌面只在独立测试数据上验收；调试变量 `INKY_PAPER_TEST_DATA_DIR`，正式版忽略此变量。

交付时把最终 release 可执行文件同步到 `app/Inky Paper.exe` 并验证。不要覆盖原版可执行文件、原 MCP 连接或原数据库。
