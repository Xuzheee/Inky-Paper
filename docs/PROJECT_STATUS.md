# 项目进度

更新日期：2026-09-15。应用 **0.5.10**；Hermes Inky Coach 插件 **0.1.3**。本文记录已实现能力、已有验证和后续检查，不把历史验收当作本轮重跑结果。

## 当前已实现

| 部分 | 当前行为 |
| --- | --- |
| 计划与 Coach | 用户询问才读取记录、建议拆分或保存总结；Hermes 展示可选择、编辑和排序的真实卡片，点击采用后加入日计划 |
| 纸面执行 | 大任务展开步骤；Do this 选入便签，start 才计时；简单任务去重；父任务与步骤均可手动完成，保留原位且完成状态独立 |
| 番茄钟与结束页 | 返回列表保留计时；结束入口先暂停；补充记录、完成选项作为会话草稿，单个“保存并结束”提交；支持滚动、纸面拖动和休息 |
| 手写视觉 | 结束页任务使用 Xiaolai 42px，选项使用 Yozai Regular 18px，随包提供字体与 OFL；铅笔涂抹选中动画，鼠标与键盘均可操作；共用英文随机标语 |
| 操作提醒 | 保存、结束休息、下一步变化等反馈使用独立 300×156 纸面小窗，靠近主窗口且不抢焦点；知道了 / 关闭 / Esc / 8 秒收起，连续提醒更新同一窗口 |
| 共同记录 | SQLite 命名事务、版本校验与重复请求保护；计时快照保留；自动导出 Markdown，个人笔记可手改；手动完成与撤销单独记录，不补造时长 |

Coach 不因记录更新或到点自动介入，卡片采用和时钟控制保留给用户。保存总结会校验读取时的数据与笔记版本；出现新记录后，历史总结保留并提示已变化，等待用户再次询问。

## 0.5.10 番茄钟透明显示修复

原因是后加的统一样式在透明态分别给导航和计时容器铺上 96% 不透明底色，覆盖了原来的纸面淡出设计。本次删除这两层底色和计时容器投影，将深浅背景的可读性处理放回文字 / 铅笔笔画；计时和进度在淡出前后坐标不变，返回与结束入口保持可用。

类型检查、前端 102 项（7 个文件）和 release 构建通过。隔离 Tauri / WebView2 检查通过：真实等待进入透明态、没有容器底色与溢出、计时继续、鼠标 / 键盘恢复、键盘焦点保留、暂停继续、随手记编辑、减少动画、返回列表保留计时、结束保存不完成父任务。真实渲染检查覆盖纸面、透明、深色、浅色和混合背景。仅修改 CSS，没有后端业务行为变更，因此未重跑 Rust 全套。证据见 [桌面检查](verification/0.5.10/desktop-verification.json)、[纸面](verification/0.5.10/paper.png)、[透明](verification/0.5.10/transparent.png)、[深色](verification/0.5.10/dark.png)、[浅色](verification/0.5.10/light.png)。

0.5.10 已交付至 `app/Inky Paper.exe`，版本和 SHA-256 与 release 一致，桌面快捷方式仍指向该路径。日常进程未被中断，从托盘退出再打开才会加载修复；[交付校验](verification/0.5.10/release-verification.json)。独立测试进程已停止，报告之外的测试资料继续留在被 Git 排除的 `output/`，不再重试此前被拒绝的删除操作。

另生成了 [三版番茄钟设计原型](design/focus-options-20260915/README.md)，目前等待用户选择。原型不是已实现界面，0.5.10 只包含现有番茄钟的透明显示修复。

## 0.5.9 独立提醒窗口

将原先占据首页空间的四类操作反馈移到独立原生小窗。提醒只保存临时展示状态，显示与关闭不更改任务、计时或 Coach 记录。表单错误和需要用户操作的上下文提示仍留在所在页面。

本次前端 102 项通过（7 个文件），Rust 65 项通过、1 项历史负载基准忽略，类型检查通过。独立调试数据中的真实 Tauri / WebView2 验收通过：保存未完成、结束休息、主窗口与弹窗 Esc、知道了与关闭按钮、不抢焦点、连续提醒替换与过期保护、8 秒自动关闭、窗口重载恢复，以及提醒操作不改任务和计时。

证据见 [桌面检查](verification/0.5.9/desktop-verification.json)、[实际弹窗](verification/0.5.9/saved-notice.png) 和 [任务页](verification/0.5.9/task-page.png)。未重新运行 Hermes 模型或完整结束页视觉验收，也未向日常数据库写入测试任务。

release 构建完成并交付到 `app/Inky Paper.exe`，版本 0.5.9，文件 67,661,312 字节，SHA-256 与构建产物相同。桌面快捷方式指向此文件；运行中的旧版未被中断，须从托盘退出再打开。旧 0.5.8 已保存在 `app/backups/`。详见 [交付校验](verification/0.5.9/release-verification.json)。

隔离测试进程已停止。本轮 `output/notice-window-20260915/` 和 `output/playwright/notice-window-20260915/` 的临时数据删除被自动审批以 `blocked by policy` 拒绝，暂时保留并继续由 Git 排除；正式验证报告与截图已存入上面的版本目录。

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

## 0.5.8 项目整理记录

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
