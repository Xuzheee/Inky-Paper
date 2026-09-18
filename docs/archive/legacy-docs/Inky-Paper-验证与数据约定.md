> 历史归档：仅供追溯，不作为当前使用说明或实现要求。见 [当前文档导航](../../README.md)。

# Inky Paper 0.2：验证与数据约定

验证日期：2026-09-08。交付范围为真实 Windows 桌面应用与 Hermes 双向本机同步，界面沿用已有 Figma Paper 分支。没有修改原应用。

## 当前已验证

- Rust 8 项测试通过：版本冲突、重复请求、非法补丁原子回滚、暂停时间排除、到点仅记录一次、数据库重新打开、步骤与父任务分离，以及没有下一步时创建稳定执行步骤。
- 前端类型检查和生产构建通过。正式 exe 自带页面、字体与宠物，使用 `http://tauri.localhost/`，不依赖开发服务器。
- 真实 Tauri/WebView2 桌面 + MCP 的 13 项检查通过：Agent 新增 / 界面修改 / Agent 读回，草稿冲突，暂停留句与续接，页面重载，外部改计划保留执行快照，透明迷你宠物，产出 / 卡点 / 下一步读回，明确休息，划线完成步骤，随手记，事件游标与连接边界。
- 单独运行真实 60 秒休息计时，到点进入待确认、累计秒数封顶、保存到点记录、完成后回任务页。
- Hermes registry 实际新增 / 修改 / 读取独立测试任务，并读回界面反馈。Hermes 的 `gpt-5.6-sol` 真实对话通过工具查询执行记录与任务。
- 已安装 Hermes 代码通过正式配置发现 6 个工具，成功读取正式新版的空任务列表。
- 正式应用在 `com.inky.paper` 数据目录启动，确认没有测试任务或旧版任务。Alt + Shift + F 显示 / 隐藏通过，正式版迷你态返回通过。
- 原目录 731 个源文件与复制前 SHA-256 清单一致。Hermes 配置仅新增 `inky_paper`，原 `inky` 连接保留，并在原配置同目录做了备份。

证据保存在 `output/`：`original-isolation-verification.json`、`release-verification.json`、`hermes-registry-verification.json`、`hermes-model-verification.json`、`hermes-production-verification.json`、`playwright/verification.json`、`playwright/timer-verification.json` 和各页面截图。写入验收使用独立 `output/smoke-data`，交付前移除测试数据库与临时连接凭据。

## 数据归属

任务是共享实体。UI 与 Hermes 都通过同一 SQLite 事务入口更新字段，没有第二份计划，也不暴露全量快照替换接口。

| 对象 | 记录 |
| --- | --- |
| 任务 | ID、标题、显示用截止时间、完成状态、来源、版本、创建 / 修改 / 完成时间 |
| 下一步 | 独立 ID、文字、完成状态、来源；完成下一步不完成父任务 |
| 执行会话 | ID、任务 ID / 标题、当时的步骤快照与任务版本、focus/rest、运行 / 暂停 / 待确认 / 结束状态、计划秒数、累计计时、起止与恢复时间、暂停次数 |
| 可选反馈 | 产出、卡点、下次起点、恢复提示；未填写是 null，不是失败 |
| 行为事件 | 递增游标、唯一 ID、UTC 毫秒时间、本地时区偏移、来源、事件类型、对应实体数据 |
| 随手记 | ID、文字、时间、来源；不自动生成任务 |

`read_history` 的 `clockElapsedSeconds` 是读取时包含当前运行区间的时钟累计；`elapsedSeconds` 是已停下累计的区间。暂停期间不累加，到计划时长封顶，等待用户结束本轮。程序重启仍按原时间戳恢复。时钟数据不代表经过验证的注意力，设备睡眠或离开期间不推断为有效专注；未记录时间保持未知。精力、任务认知负荷、复杂推荐在 Hermes 对话中处理，本版不自动推断。

## 同步行为

6 个 MCP 工具：`inky_paper_list_tasks`、`inky_paper_get_task`、`inky_paper_create_task`、`inky_paper_update_task`、`inky_paper_read_history`、`inky_paper_read_events`。

每次修改提供独立 UUID `requestId`；网络不确定时以原 ID 和原参数重试。任务修改需要最新 `expectedRevision`。冲突先读取再核对，不能把旧计划直接盖上去。界面编辑草稿暂存在本应用 WebView 的本地空间，未成功提交时保留。字段保存成功以 SQLite 提交结果为准。

任务重排时产生新的步骤 ID。当前会话继续保留开始时的步骤快照；结束旧步骤时不会勾掉刚由 Hermes 安排的新步骤。Agent 不能通过连接操纵时钟，用户在界面明确开始、暂停、恢复、结束和休息。

窗口隐藏和迷你态不关闭同步服务；完整退出停止服务。重新启动会刷新连接令牌，MCP 每次调用重新读取连接文件。默认目录 `%APPDATA%/com.inky.paper`，连接文件 `paper-agent-bridge.json`，数据文件 `paper.sqlite3`。桥接只监听本机随机端口，要求 Bearer，拒绝浏览器 Origin 与未知操作。

## 本轮边界

未配置 Obsidian 自动归档、健康数据接入、能量预测、通知日历或自动后台重排。已有 Hermes 会话需新开会话以加载连接。长时间使用的数据规模与打包安装器仍可在后续迭代完善；当前交付是可直接运行的 exe 与完整源码。


## 2026-09-08 任务创建反馈修复

用户反馈的离线来自旧版 `mcp__inky__inky_create_task`；失败会话实际未调用 `inky_paper`。当场验证新版桥接和正式 Hermes 配置均可用。新工具标题和描述明确标注“新版 Inky Paper”，并在新连接配置中固定独立连接文件路径。原版连接不变。

补充任务 `category`（work / study / life / idea）和 `priority`（high / medium / low），旧数据默认 work / medium；新 MCP 可读写，编辑页折叠展示。新增兼容与字段往返测试，Rust 共 9 项通过，生产构建通过。已通过真实 Hermes 工具创建用户要求的任务“修改知识库应用”，工作、中优先级、2026-09-08 晚上，并读回确认唯一；桌面截图 `output/playwright/knowledge-task-created.png`。
