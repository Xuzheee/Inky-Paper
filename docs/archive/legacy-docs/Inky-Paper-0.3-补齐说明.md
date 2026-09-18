> 历史归档：仅供追溯，不作为当前使用说明或实现要求。见 [当前文档导航](../../README.md)。

# Inky Paper 0.3

这次修复集中在捕获 → 专注 → 记录结果 → 继续的连接处，保持当前 Paper 方向和页面结构。

1. **专注中记录。** 随手记直接在页边展开，保存后回到这一轮，计时不被自动打断。记录保留任务、步骤和轮次归属。
2. **找回起点。** 回到任务页就能看到上次留下的话；它不会自动覆盖 Hermes 的下一步。
3. **顺畅结束。** 补一句可展开 / 收起；可以完成这一步、结束本轮、再专注一段或先休息。步骤完成不等于整件完成。
4. **收好任务。** 已完成默认折叠，支持撤销；随手记可整理成任务，重复提交不会生成第二件。
5. **纸页完成度。** 字体本地加载，统一层级和留白；沿用 Figma 纸页、胶带、折角与铅笔划线。迷你仍只有透明宠物。

[查看修订后的原型](https://www.figma.com/proto/Uhb9FJXS6MC2bxeFjIdpjs?node-id=108-32&starting-point-node-id=108%3A32&scaling=actual-size)

[查看新增的页边记录设计](https://www.figma.com/design/Uhb9FJXS6MC2bxeFjIdpjs?node-id=123-52)

## 对照证据

独立专注页：左 Figma，右桌面（历史附件已不在仓库：`../../../output/refinement-20260908/compare-focus.png`）

休息页：左 Figma，右桌面（历史附件已不在仓库：`../../../output/refinement-20260908/compare-rest.png`）

反馈展开后的桌面实测（历史附件已不在仓库：`../../../output/refinement-20260908/11-after-expanded-feedback.png`）

完整问题、修复过程、真实数据回读和验收边界见项目根目录 `design-qa.md`。

## 使用这次更新

退出正在运行的 Inky Paper，再双击项目中的「启动 Inky Paper.cmd」。当前任务和待确认的这一轮都保留，旧版 Inky 不受影响。

旧的 0.2 可执行文件留有备份；没有修改正式数据库路径、Hermes 连接配置或原应用。
