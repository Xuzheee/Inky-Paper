# M3 共同数据支持

新增用户专用 `acknowledge_task_completion` 与 `organize_note`，复用 Paper 的单笔事务、请求缓存和事件导出。笔记的原文、来源会话/任务保留；转换复用同一 noteId 的目标。旧笔记 revision 缺省 1。保留后续的父任务确认按真实完成事实持久化，编辑标题不重复提示。

公共 `taskCompletionPrompt` / `latestStepCue` 供两端使用；Coach 选择范围也读取同一步骤最近真实会话的起点。新增只读草稿 scope 与连接诊断，未实际请求的模型/工具保持未知；不展示服务方原始错误文本。

13 项命名事务测试、10 项共享查询测试、14 项工作台后端测试通过。cargo check 通过。包含完整步骤集合/版本冲突、原请求重复、转换入口兼容、来源保留、Agent 拒绝与诊断不调用模型。UI 和原生流程待各工作包及 M3 验收。
