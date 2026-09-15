# 项目进度

更新日期：2026-09-15。应用 **0.5.8**；Hermes Inky Coach 插件 **0.1.3**。本文记录已实现能力、已有验证和后续检查，不把历史验收当作本轮重跑结果。

## 当前已实现

| 部分 | 当前行为 |
| --- | --- |
| 计划与 Coach | 用户询问才读取记录、建议拆分或保存总结；Hermes 展示可选择、编辑和排序的真实卡片，点击采用后加入日计划 |
| 纸面执行 | 大任务展开步骤；Do this 选入便签，start 才计时；简单任务去重；父任务与步骤均可手动完成，保留原位且完成状态独立 |
| 番茄钟与结束页 | 返回列表保留计时；结束入口先暂停；补充记录、完成选项作为会话草稿，单个“保存并结束”提交；支持滚动、纸面拖动和休息 |
| 手写视觉 | 结束页任务使用 Xiaolai 42px，选项使用 Yozai Regular 18px，随包提供字体与 OFL；铅笔涂抹选中动画，鼠标与键盘均可操作；共用英文随机标语 |
| 共同记录 | SQLite 命名事务、版本校验与重复请求保护；计时快照保留；自动导出 Markdown，个人笔记可手改；手动完成与撤销单独记录，不补造时长 |

Coach 不因记录更新或到点自动介入，卡片采用和时钟控制保留给用户。保存总结会校验读取时的数据与笔记版本；出现新记录后，历史总结保留并提示已变化，等待用户再次询问。

## 历史验证依据

| 日期 / 版本 | 已检查范围 | 证据 |
| --- | --- | --- |
| 2026-09-13 / 0.5.0 | 每日计划、执行与 Markdown 核心闭环；重启恢复；规划模型调用 | [桌面](verification/0.5.0/desktop-verification.json)、[重启](verification/0.5.0/restart-verification.json)、[规划模型](verification/0.5.0/planning-model-verification.json) |
| 2026-09-14 / 插件 0.1.1 | 独立 Hermes 桌面和 Paper 测试库：六张候选中选两张、编辑、排序、明确采用后写入；此项未运行真实模型 | [卡片验收](verification/hermes-0.1.1/ui-acceptance.json) |
| 2026-09-14 / 0.5.6–0.5.7 | 0.5.6 Rust 61 项通过、1 项基准忽略；0.5.7 前端 128 项通过。此处是历史基线 | [0.5.8 交付报告中的基线记录](verification/0.5.8/release-verification.json) |
| 2026-09-14 / 0.5.8 | 类型检查、构建和隔离 Tauri 桌面：实际字体、窗口拖动、键盘与减少动画、草稿保留、保存结果、父步骤分离、长内容滚动、休息和 Markdown | [桌面检查](verification/0.5.8/desktop-verification.json)、[实际字体](verification/0.5.8/rendered-fonts.json)、[字体文件](verification/0.5.8/font-verification.json)、[交付报告](verification/0.5.8/release-verification.json) |

0.5.8 当时未重跑前端与 Rust 全套测试，引用了上表基线；未重测完整退出，也未强制重启日常应用或向日常数据库写入测试内容。Hermes 插件 0.1.2–0.1.3 加入简短文案和手动记录规则，不能据此声称所有真实模型回答均已验收。

历史 0.5.8 交付 SHA-256（本轮重建后的校验另行记录）：

```text
11CD6EF20CF6CE7E9D6F235AB66B207EFEBF62EC8FD52B0B66D91E976F9C25DA
```

可查看 [结束页](verification/0.5.8/end-default.png)、[选中状态](verification/0.5.8/end-shading-selected.png)、[展开记录](verification/0.5.8/end-expanded.png)、[长任务滚动](verification/0.5.8/long-task-scroll.png)、[休息中](verification/0.5.8/rest-running.png)、[休息结束](verification/0.5.8/rest-waiting.png)。这些截图来自对应版本的隔离验收。

## 本轮项目整理

本轮统一说明入口，将未挂载的旧 Inky 代码、重复交付物、测试数据库、临时配置和构建缓存移出维护目录，保留当前运行源码、必要素材、许可及代表性验收证据。旧 PRD 和脚本归档供追溯。此次整理不增加功能，不产生新的界面质量结论。

永久删除操作被自动审批拒绝，因此使用项目内 `.cleanup-quarantine/` 做可逆隔离，并从 Git 排除。隔离不等于永久删除，也没有释放对应磁盘空间。

2026-09-15 整理后：类型检查、release 构建通过；当前前端 98 项通过（6 个测试文件），Rust 61 项通过及 1 项基准忽略，Hermes 插件前端 6 项、Python 7 项、MCP 12 个工具检查通过。旧代码的 30 项测试随旧模块隔离，前端测试命令明确限定 `src`。本轮未重跑真实桌面，不新增视觉验收结论。

已将重建的 0.5.8 交付到 `app/Inky Paper.exe`，文件为 67,342,336 字节，比之前减少约 3.82 MiB；前端 JS / CSS 与此前产物哈希一致。重建 SHA-256：

```text
8B16D4946B193F53A83112195F7D6B645882D52D99650484E0FFE8109E88F577
```

本轮检查记录见 [整理验证](verification/cleanup-20260915/verification.json)。共将 38 个目标、33,880 个文件（约 24.19 GiB）移入 `.cleanup-quarantine/20260915/`，包括旧源码、旧程序副本、测试产物和构建缓存；[完整清单](verification/cleanup-20260915/quarantined-files.json) 与 [统计](verification/cleanup-20260915/cleanup-summary.json) 已保存。当前程序与一个 0.5.7 回退副本保留在 `app/`。隔离目录永久删除仍未完成。

Git 已建立并推送至 [Xuzheee/Inky-Paper](https://github.com/Xuzheee/Inky-Paper)，可见性为 **PRIVATE**，默认分支 `main`，本地跟踪 `origin/main`。首次源码基线提交为 `2c76c15`；后续提交可在仓库历史中查看。源码约 89.78 MiB，最大单文件小于 GitHub 的单文件限制；入库检查未发现所检查格式的凭据或禁止上传的运行产物。

`.gitignore` 排除正式数据库、工作记录、本机连接、依赖、构建输出、exe 和隔离目录。当前记录并不会因 Git 提交而自动同步到 GitHub。

## 仍需检查与后续范围

当前人工检查以 [MANUAL_CHECKS.md](MANUAL_CHECKS.md) 为准，重点是用户实际桌面版本、日常 Hermes 的两个插件开关、短标题生成质量和完整闭环的操作手感。

工作时段总览、工作收尾、随手记及历史空状态等辅助页面，尚没有与本次结束页同等范围的最新视觉验收。后续可逐页检查比例、留白、导航和页脚，不把静态审阅视为已完成的界面验收。

当前交付是本地 Windows 应用和源码，尚未覆盖长期大数据量使用、其他平台、自动更新分发和实际专注 / 产出改善效果。是否继续这些方向由真实使用反馈决定。
