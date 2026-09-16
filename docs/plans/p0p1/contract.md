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
  P-02 兼容仅有标题的旧任务：用户显式选择时允许 `stepId/expectedStepRevision/dayItemId` 均为 null；只有该任务尚无步骤时，在同一事务补标题步骤（首轮默认 25 分钟）并准备。已有步骤则冲突，不重复生成。自动刷新不调用写入。
- `continue_plan_items` 输入 `taskId/stepId/expectedTaskRevision/expectedStepRevision/items:[{id,revision}]/date/requestId`。只处理目标日前未处理旧安排，复用目标日安排，返回 item。
- `cancel_plan_items` 输入同上但以 `scope:selected|unexecuted` 替代 date。后者校验全部未执行安排集合，返回 remainingActiveCount；使用 sessionLinks 判断执行来源。
- `workbench_save_step` 新增可选 `priority/due/dueDate/expectedResult`，缺失保持原值，null 清空可空字段；分类与日期语义不变。
- `get_daily_record.planChanges` 与 `planning.planChanges` 保留 before/after；生成 Markdown 包含来源日与目标日的变更。
- 新库与旧库完成升级后 `PRAGMA user_version=1`。旧库备份为 `<文件名>.pre-schema-1.sqlite`，已有备份不覆盖。

P-02 与旧测试的差异：原来准备来源被取消后，开始按钮会退回无关联安排执行。本计划要求交接明确，因此现在保留原选择并说明来源已变化；用户重新选择无安排步骤后才可开始。其他浏览、计时和旧会话快照语义保留。

## C-01 请求快照（M2）

沿用 `workbench_send` 与 `message_context` JSON，不复制数据库。请求增加 `schemaVersion:2`、`viewDate`、`intent:auto|plan|stuck|review`、可空 `selectedDayItemId`。`date` 是本次讨论日期，`today`/`utcOffsetMinutes` 由后端按发送时真实本地时间校准。正文中的临时约束以本次原话保存于 `temporaryConstraints:{text,scope:"request"}`，没有明确输入的时间/精力不解析为事实。

发送模型前后端从一个最新 Paper 快照生成 `sampledAt/resolvedIntent/latestFacts/versions/truncated` 并替换前端标题；校验选择的任务、步骤与安排对应关系。安排范围只包含所选日/所选对象和必要未安排项；卡住取选中步骤最近反馈；回顾复用该日记录及笔记版本；普通交流取简要选中事实。更广范围按需通过工具读取。历史缺失字段仍可显示。

常驻三入口仅预填且标记意图，手动改写后回到 auto，只有发送才启动模型。生成中的消息、卡片与历史绑定本次快照，不随界面切日期改变。

## C-02 调整协议

复用 PlanningState，在普通新步骤候选旁新增 `adjustments`（旧库默认空），不改现有 Batch 格式。命名操作为 `propose_plan_adjustment`、`get_plan_adjustment`、`adopt_plan_adjustment`。模型只获得前两项。采用为本地用户操作，选中多个组在既有 paper_execute 单笔事务中校验和提交。

提案输入：`batchId/groups:[{id,reason,actions:[]}]`，每批最多 20 组、每组最多 20 动作。每个组是不可拆的依赖单元；没有跨组隐式依赖。动作包含 `kind`：

- `continue`：taskId/stepId、expectedTaskRevision/expectedStepRevision、items:[{id,revision}]、date。复用 M1 继续语义。
- `reschedule`：相同任务/步骤版本，itemId/expectedItemRevision、date/startMinute/durationMinutes；保留原步骤和来源历史。
- `reservation`：相同任务/步骤版本，itemId/expectedItemRevision、durationMinutes（可空），保留日期及开始时刻；预留允许无开始时刻，提前落地 M4 的兼容读取规则，不把首轮时长当工时。
- `reorder`：date、items:[{id,revision}] 为该日全部有效安排的新顺序；校验完整集合与版本。
- `narrow`：taskId/stepId 和两版本，text/expectedResult/plannedSeconds、date（可空）、newStepId。只新增同一父任务下的小步骤，保留原步骤、原目标及会话，若需延期原步须同组显式附加 reschedule。

返回 `batch:{id,revision,groups:[{id,reason,actions,before,after,adoptedAt}],createdAt}`；before/after 由后端只读预演得到任务、步骤、安排的差异，保留标题用于可读预览，不信任模型提供的差异文案。采用输入 `batchId/expectedRevision/groupIds/requestId`。调整参数通过 `revise_plan_adjustment` 本地用户操作，校验原提案依赖仍有效后重建预览、revision+1，不写正式计划；新参数必须新 requestId。

采用前针对初始共同状态一次校验所有所选组（含对象/排序/进行中会话）；之后按保存顺序应用。任一失败整体回滚。不确定响应保留同一 payload 与 requestId 到本地草稿。独立组分次采用时，只更新同批采用自己产生的依赖版本，不接受外部更新的旧候选。采用过的组不得重复新增；新组与原任务/步骤/会话快照有明确关联。

安全收口：model bearer 仅允许读取、提案和用户请求的版本化总结；独立 user bearer 仅供本机插件点击采用，不传给模型。所有非 user 的直接任务写入、采用和时钟操作在共同后端也拒绝。ACP 子进程只加载本次 Paper MCP toolset，不加载文件/终端/浏览器/其他 MCP 工具；不修改用户全局 Hermes 安装或配置。

## M3 公共约定

- `workbench_storage_scope` 是只读 Tauri 命令，返回当前数据目录稳定 SHA-256 `scopeId`，不返回路径。工作台新增对象草稿和未知结果请求按 scopeId 隔离；未读到 scope 前不发送写操作。
- `planning.taskCompletionAcknowledgements` 默认空，元素 `{taskId,completionKey,acknowledgedAt}`。`acknowledge_task_completion` 仅用户可调用，输入 taskId/expectedTaskRevision/steps:[{id,revision}]/requestId，完整非空步骤集合必须全完成，父任务未完成且无当前会话。只记录“保留后续”；显式完成父任务仍走 update_task。
- completionKey 是规范 JSON `[taskId, sortedSteps.map(step => [stepId, sortedManualChangeIds, sortedFinishedCompletionSessionIds])]`。新增步骤或撤销再完成允许再提示，仅改标题不重复提示。前端公共查询与后端计算一致，不接受前端提交的 key。
- 笔记保留原 id/text/source/sessionId/taskId/action。新增 revision 默认 1；organization 为 kept/linked/converted，可空表示待整理；linkedTaskId 独立于来源 taskId。`organize_note` 仅用户调用，输入 noteId/expectedRevision/mode/targetTaskId?/expectedTaskRevision?/requestId；keep 保留、link 校验目标版本、convert 创建或复用 originNoteId 的目标。转换参数 title/taskId/nextAction 可传，title 缺省原文前 300 字，原文不截断。转换已有目标时复用，绝不删除笔记；已转换笔记不允许改掉转换关系。现有 create_task(originNoteId) 同步记录整理状态与版本。

公共模块实现可以委派到独立新文件，主任务接线公共类型与事务。每包完成再领取下一项。

## M4 日约束（W-03）

`planning.context` 默认空 ContextState，先含 `days: DayConstraint[]`。每项 `{date,revision,availableMinutes:number|null,unavailable:[{startMinute,endMinute}],updatedAt,source}`。日期严格 YYYY-MM-DD，可投入 0–1440 分钟，未填为 null；不可用区间为同日整数分钟 `[0,1440]` 且 start < end。用户可清空预算和区间但保留对象版本。

`save_day_constraints` 仅 user，输入 date/expectedRevision（首次0）/availableMinutes/unavailable/requestId。整体校验后一次提交，保留修改事件，不影响任何时钟。当天统计只用有效且父任务/步骤未完成的安排：明确预留分钟相加；未估计数量独立，不能计为0；日历占用合并明确时间段；独立输出重叠 item 对及不可用冲突。完成的安排保留可查，不计入剩余投入。

公共后端 `day_capacity(state,date)` 输出 `{date,availableMinutes,reservedMinutes,unestimatedCount,calendarOccupiedMinutes,overlapPairs:[{first,second}],unavailableConflicts:[{itemId,startMinute,endMinute}],overBudget,fullyEstimated}`；首轮 plannedSeconds 不参与计算，未知预算 overBudget 为 null。上下文只注入本次日期约束及统计，界面可请求只读 `get_day_capacity`，禁止自动调用模型。M3/M4 依计划允许在接口稳定后并行。

## M4 项目（W-04）

Task 新增可空 projectId，不改变 category。ContextState 增加 projects 默认空；Project `{id,title,goal,criteria,referenceLinks:string[],archived,revision,updatedAt,source}`。文本可为空的 goal/criteria 用空字符串，链接最多10条，只允许 http/https URL，不自动访问。

`save_project` 仅用户操作，输入 projectId/expectedRevision（首次0）/title/goal/criteria/referenceLinks/archived/requestId；同一版本事务保存。归档仅更新项目，不改变任务/安排/执行快照。`set_task_project` 用户输入 taskId/expectedTaskRevision/projectId:null|string/expectedProjectRevision（非空项目必须）/requestId；关联校验目标未归档，清空不改分类。已有任务的归档项目关联保留。相关 Coach 范围只取选择任务、当天安排和实际纳入请求的未安排任务的项目，不默认注入所有项目；没有抓取的链接明确标注未读取。全局任务导出包含项目标识及可读名称，历史执行仍用会话原快照。

## M4 用户确认的偏好（C-04）

ContextState.preferences 默认空，Preference `{id,text,scope:global|day|project,date:null|string,projectId:null|string,enabled,revision,confirmedAt,updatedAt,source}`；同时有 preferencesRevision 默认0，每次实际变更递增。`save_preference` 用户专用输入 preferenceId/expectedRevision（首次0）/text（1–1000字）/scope/date/projectId/enabled/requestId；scope day 必须日期，project 必须有效未归档项目，其余字段须 null，显式保存即确认。`delete_preference` 输入 preferenceId/expectedRevision/requestId，仅从可用偏好集合删除，返回 deletedId，历史事件与对话不冒称已清除。

每次请求注入当前适用且 enabled 的偏好：global、当天匹配、相关未归档项目匹配；已停用/删除/其他日期不注入。当前用户原话优先于已保存偏好，最新偏好快照优先于聊天中的旧版本；文本不会自动变为长期偏好。只复用 Hermes 的模型/账户，不另建通用记忆提供方。UI 明示删除只影响后续 Inky 请求，不删除已有对话/历史。

兼容例外：归档项目的既有偏好仍可明确停用；不能新建、启用或改关联到归档项目。
