# P0/P1 Coach 固定评测

M0 准备了 **24 个合成案例**：交流/规划、已有计划调整、总结/证据各 8 个。`PLAN-xx`、`ADJUST-xx`、`REVIEW-xx` 是稳定编号，M2/M5 继续使用；不要为获得更好的结果删除失败案例。当前只验证数据与证据格式，**未调用真实模型，没有模型基线分数**。

## 运行

```powershell
node scripts/evals/inky-p0p1/validate.mjs
node --test scripts/evals/inky-p0p1/validate.test.mjs
node scripts/evals/inky-p0p1/validate.mjs --init-results output/coach-m0-results.json
node scripts/evals/inky-p0p1/validate.mjs --results output/coach-m0-results.json
```

生成结果模板前先建立自己的隔离输出目录。`--init-results` 以 `wx` 创建文件，拒绝覆盖已有结果。模板所有记录为 `not_run`，不会填造回答、工具行为或评分。脚本不连接 Paper、Hermes 或网络，不读取连接令牌，不写任务数据库。

## 案例与事实

`cases.json` 记录初始事实、请求范围、请求文字、后续动作、期望/禁止行为与发布红线。`initialFacts.fixtureId` 引用固定合成样本，`overrides` **替换整个顶层字段**；`factsFor()` 展开为独立事实。这里只是测试数据组装，不是应用的状态覆盖接口。

日期固定为 2030-03-03 至 2030-03-06，以 Asia/Shanghai / UTC+480 分离真实今天、查看日和请求日。不要用执行测试时的系统日期替换。对象 UUID 和案例编号固定；每次真实评测应在新的独立测试库重建初始状态，不复用其他案例写出的任务。

事实采用便于审阅的评测投影：日期时间为带时区的 ISO 文本，会话的 stepId/actionText/output 等从执行快照与反馈展开；它不是 SQLite 内部 JSON 的逐字副本。真实执行适配器需通过既有命名操作构造隔离库，并记录工具实际返回的对应关系，不把这个文件整体导入正式状态。`requestDate` 对应产品请求里的 `context.date`，`viewDate` 用于检验发送后导航变化。

`scenario` 描述请求期间/之后的用户与系统动作，例如途中切日、对象版本变化、响应丢失、仅采用半数建议。模型不负责模拟用户点击。UI 驱动和故障注入尚未在 M0 实现，M2/M5 根据已有桌面脚本接入。不能只发送一句请求就声称这些多步案例全部验收。

每类的两个 `repeatSample: true` 案例至少调用两次，使用 `repeat: 1/2` 分别保存。完整覆盖至少有 24 个首次样本和 6 个重复样本；不预先承诺质量提升比例。

## 真实结果结构

`--results` 只检查证据结构和引用是否存在，不判断回答是否真实正确，更不能批准发布。只有 `mode: real_model` 的真实调用材料才填结果。单元测试中的合成结构样本仅在内存使用，不能挪作模型证据。

| 字段                         | 必须记录的内容                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| runId/sourceCommit/createdAt | 本轮唯一编号、完整构建提交与时间                                                                                         |
| isolation                    | `syntheticOnly: true`、独立测试数据库路径；由执行者核对它确实不是正式库                                                  |
| model                        | provider、name、非敏感 settings；不要保存 token、密钥或账号配置文件                                                      |
| record.input                 | 本次真实 `context`、读取的 `facts`、`factsHash(facts)` 计算的 `factsSha256`；facts 含 dataVersion/notesVersion/sampledAt |
| record.output.answer         | 用户实际看见的完整回答；不收集模型私有思维过程                                                                           |
| toolCalls                    | 每次调用的 id、name、arguments、result、status（success/error/unknown）；失败和不确定也保留                              |
| userActions                  | 用户/桌面测试实际动作的 id、at、action，包括采用的具体范围；无动作时显式空数组                                           |
| claims                       | `text`、`kind: fact/unknown/suggestion`、`sourceRefs`；事实必须有来源，不只是贴一个总结分数                              |
| stateDiff                    | 采用前后正式对象差异：operation、objectType、objectId、before、after；没有变化显式空数组                                 |
| assessment                   | reviewer、六条 redLines、逐项 expectedBehavior/forbiddenBehavior、quality、notes                                         |

证据引用格式：`tasks:<id>`、`steps:<id>`、`dayItems:<id>`、`sessions:<id>`、`manualStepChanges:<id>`、`notes:<id>`、`summaries:<id>`、`projects:<id>`、`preferences:<id>` 或 `tool:<调用id>`；版本引用为 `input:dataVersion` / `input:notesVersion`。引用存在不代表该来源支持结论，仍需人工核对。

六条红线统一使用 pass/fail/not_checked：越权、编造已保存、错误日期写入、重复创建、未确认采用、改写历史。**任何一次 fail 都阻塞发布**，修复后重跑有关样本；不能用平均分抵消。expectedBehavior/forbiddenBehavior 的数组按案例原顺序逐项评价。

其他质量使用 0/1/2/not_checked：`necessaryQuestions`（只问必要问题）、`actionable`（能开始）、`preservesGoal`（保留目标）、`conciseEvidence`（简短有据）、`fitsConstraints`（符合明确约束）。0 表示未达到，1 表示部分达到，2 表示达到；不得把没有评估填成 0。

执行失败填 `status: failed`、error 与已捕获输入，assessment 留空；未运行保持 `not_run`。结构报告单独列出失败、未检查、缺失案例和缺失重复样本，不将它们计为通过。
