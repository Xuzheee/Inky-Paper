# P0/P1 公共约定

状态：M0 已定，后续按工作包局部扩展。原始计划见 [plan.md](plan.md)。本轮起点为工作台 `1dfeef6`，已快进到计划基线 `d13b19f`（0.6.4）。不改其他 worktree，不读取正式数据库。

## 数据与负责人

公共类型、Rust 命名事务、数据库打开/迁移、Markdown、`main.rs` 和版本文件由集成负责人（本任务主 Agent）单独写入。Paper 子任务只写 `src/paper/` 中领取的 UI 文件，工作台子任务只写领取的 `src/workbench/` 文件；`paperTypes.ts` 除外。当前子任务共享本轮工作目录但按文件分工，不操作另一个用户任务的 worktree，不自行切分支或提交。

现有两个长期 worktree 继续分别承担 Paper 与工作台方向。本轮子任务是本次迭代的局部分工，最终提交仍归本任务；不把未提交文件跨目录复制。接口先提交后派发 UI 工作，领取、测试、提交、验收状态记入台账。

| 对象 | 字段与兼容规则 |
| --- | --- |
| Task | 保留 `due` 截止备注、`category`、`priority`；增加可空 `dueDate`（严格 YYYY-MM-DD），与安排日独立。M4 增加可空 `projectId`，不把分类改成项目。 |
| Step | 复用 `expectedResult` 与 `plannedSeconds`；缺省编辑不得清空已有完成标准。首轮时长不作为整体工时。 |
| DayItem | 保留 date/order/startMinute/durationMinutes；增加可空 resolvedAt/resolution/continuedTo，处理遗留不删除旧安排。M4 允许只有预留分钟、未定开始时刻。 |
| PlanningState | 可空 `prepared` 保存全局准备的 taskId/stepId/dayItemId；`planChanges` 保存安排变动前后快照。旧数据默认空，不重写既往 Session/SessionLink。 |
| Session / SessionLink | 保留实际时段、步骤文本快照、安排来源日。执行未来安排时保留 planDate；实际记录按真实发生日统计。 |
| M4 上下文 | 单独版本化 projects/dayConstraints/preferences；日期限制只对指定日期生效，停用/删除后不再注入新请求。 |

新增字段默认空或空数组。Task/Step/DayItem 继续使用对象 revision；候选组和上下文对象也有独立 revision。每个写入复用 requestId 指纹缓存；不确定响应保留原 requestId 和原参数，编辑参数或确认新版本后创建新请求。

## 同一查询与日期

`src/shared/planning.ts` 是 Paper 和工作台唯一的队列、未安排、遗留、续做起点纯查询。输入同一 State 和明确的本地日期，输出引用原对象，不创建状态副本。两页面不能复制筛选规则。

- 今日队列：指定 date 且 removedAt 为空的安排，按 order/id 排序，已完成内容保留原位置；展示最新状态并明确不是历史快照。
- 待安排：未完成任务/步骤，没有任何有效安排；取消一个安排但仍有其他安排时不进入待安排。
- 遗留：过去有效且未处理的未完成步骤，按 taskId/stepId 分组。已有今天或未来安排时标注已重新安排并默认收起，不催促。
- 继续：保留原对象与旧安排，创建或复用目标日安排，标记选中旧安排已处理并记录关联。
- 改期：版本化修改指定安排，记录 before/after，不修改会话来源快照。
- 取消本次：仅移除指定安排。放回待安排：预览需要取消的全部未执行安排并确认；若仍有已执行的有效安排，只说明取消结果，不能声称完全未安排。
- 续做起点：按 taskId + stepId 查询该步骤最近一次真实会话的 nextCue/resumeCue，不维护三份文本。

真实今天、查看日期、本次请求日期各自独立。Coach 请求保留明确 date、today、utcOffsetMinutes、对象标识及版本；流式回复沿用请求快照。历史日期事实按记录/事件解读，安排修改记录展示来源及前后状态；不把后来的状态伪装为旧日原计划。

## 命名操作顺序

M1 先扩展 `workbench_save_step` 的可选 metadata 字段，新增 `continue_plan_items` 与 `cancel_plan_items`；二者校验受影响 item 的完整版本集合并原子提交。继续同日复用安排，不复制父任务。已有改期/重排操作继续复用并添加 planChanges 记录。

准备交接继续走 `workbench_prepare_step` / Paper 用户选择路径，底层统一调用新增 `prepare_step` 命名事务（taskId/stepId、两对象版本、可空 dayItemId），校验后原子保存下一步和 `prepared` 来源。未结束会话时拒绝换便签，并提供返回本轮入口。`select_step` 本身是计划选择操作，旧测试允许计划更新而当前会话快照不变，保留此数据语义；不能把未来计划编辑也当作计时控制禁止。

M2 在现有候选批次旁增加可选择的版本化调整组（继续/移动/重排/预留/新增小步骤），结构化保存日期、对象版本、改动及理由。预览只读；选中组一笔事务采用，任何前置条件失败整体回滚。缩小动作默认新增步骤保留原目标。采用仅允许可信本地用户路径，不向模型暴露。

当前源码差异：MCP 的 create_task/update_task 仍可直接写计划；桥接的 bearer 权限未区分模型与用户插件采用。M2 必须在工具注册和后端权限两处收口，给用户点击代理独立的受限采用凭据；不靠提示词解决。与旧插件的兼容变更一同测试。普通到点提示和按需 Coach 保持原状。

M3 扩展笔记整理命名事务（保留/关联/转换），保留 noteId、原文和来源，转换重试复用目标。M4 上下文使用独立命名保存操作。M5 总结继续用 dataVersion + notesVersion + sourceAsOf，证据引用只允许所读范围中真实对象。

## 迁移、备份与回退

M0 生成合成旧格式 JSON 和独立 SQLite 副本，禁止从用户库复制。M1 在 `paper::open` 添加 schema 版本检查：已存在旧库先通过 SQLite 一致性快照备份，备份成功后才升级标记；读取新字段兼容空值。失败不写升级标记；未知的更高版本拒绝打开。后续阶段的 schema 升级遵守相同路径。

已知旧版 0.6.4 不识别新版本标记，不能声称旧 exe 可安全继续写新库。回退必须先关闭应用，保存升级后的整套数据副本，再恢复升级前库和对应 exe；升级后新增数据只从保留副本人工迁移，不自动丢弃。测试覆盖备份可打开、内容一致、重复打开不重备份、备份失败不升级与高版本拒绝。

每阶段先自动测试，再独立 Tauri/WebView2 与必要真实模型检查。没有真实证据写“已实现待验收”。最终交付只由本集成任务构建；若用户正在工作，先保留经过校验的新包和备份，正常保存结束当前工作后再切换运行实例，不能中断正式计时。

## D-01 已落地接口

M0 提交 `e1196ce`。迁移模块由 Paper 子任务独立编写，主任务接线；公共纯查询由 Coach 子任务编写，主任务核验。公开字段仍由主任务统一维护。

- `planningViews(state,today)` 返回 `rows/today/unplanned/leftovers`，遗留组 `{task,step,items,rescheduled}`；`latestStepCue` 返回 `{text,sessionId}|null`。
- `prepare_step` 输入 `taskId/stepId/expectedRevision/expectedStepRevision/dayItemId/requestId`。安排可空；返回 task、step、item、prepared。不开始时钟。
- `continue_plan_items` 输入 `taskId/stepId/expectedTaskRevision/expectedStepRevision/items:[{id,revision}]/date/requestId`。只处理目标日前未处理旧安排，复用目标日安排，返回 item。
- `cancel_plan_items` 输入同上但以 `scope:selected|unexecuted` 替代 date。后者校验全部未执行安排集合，返回 remainingActiveCount；使用 sessionLinks 判断执行来源。
- `workbench_save_step` 新增可选 `priority/due/dueDate/expectedResult`，缺失保持原值，null 清空可空字段；分类与日期语义不变。
- `get_daily_record.planChanges` 与 `planning.planChanges` 保留 before/after；生成 Markdown 包含来源日与目标日的变更。
- 新库与旧库完成升级后 `PRAGMA user_version=1`。旧库备份为 `<文件名>.pre-schema-1.sqlite`，已有备份不覆盖。
