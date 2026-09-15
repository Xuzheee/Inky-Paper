# Inky Coach：Hermes 专用卡片插件

当前版本 **0.1.3**。本目录是独立插件源码，不修改 Hermes 核心；安装与启用状态由目标 Hermes 实例决定。

用户询问 → Coach 通过 Paper MCP 保存候选 → 聊天渲染 `::inky-plan{batchId="…"}` → 用户选择、修改、排序 → 点击加入 Inky。卡片读取与采用走本机插件 API，不调用模型；五秒状态刷新只读数据。保存成功后才显示“已加入”。

卡片为双列，窄窗口自动单列。点卡片选择，铅笔打开编辑区，底部标签可取消选择。0.1.2 加入短动作规则和简单任务单卡片约定；0.1.3 补充每日总结对手动完成、撤销的区分，不将操作次数累计为成果或计时。已缓存旧技能的会话可重新读取 `inky-coach:coach`。

## 组成与同步

| 文件 | 职责 |
| --- | --- |
| `desktop/plugin.js` | 使用 Hermes 自带 React 与 SDK 渲染卡片，保存未提交草稿、选择和原请求 |
| `dashboard/plugin_api.py` | 仅代理 `get_plan_batch` / `adopt_plan_cards`；后端读取 Paper 连接令牌，前端与聊天不接触令牌 |
| `skills/coach/SKILL.md` | 注册为 `inky-coach:coach`；只在用户询问时安排、建议或总结 |
| `../inky-paper-mcp-server/index.mjs` | 提供模型使用的 12 个 `inky_paper_*` 工具，不向模型开放卡片采用或时钟控制 |

Paper 保存正式计划和执行事实。采用会检查批次、任务和步骤版本；冲突时保留草稿，显示当前内容，用户核对后才能重新提交。断连或响应不确定时保留完全相同的请求重试，避免重复计划。外部调整不能改写已开始执行的步骤快照。

## 安装与更新

需要支持 `transcript.directives`、运行时插件加载及插件 API 的 Hermes 桌面版本。后文记录的是已验证版本的能力，不能推定所有 Hermes 版本兼容。

1. 确认目标 Hermes 用户目录：默认通常为用户目录下的 `.hermes`，独立 profile 使用其实际目录。更新前在目标目录外保留当前 `plugins/inky-coach/` 和相关配置的回退副本。
2. 将发布 ZIP 解压至目标 `plugins/inky-coach/`，目录下应直接有 `plugin.yaml`。源码安装只复制 `plugin.yaml`、`__init__.py`、`dashboard/`、`desktop/`、`skills/`、`README.md`，不复制测试与缓存。
3. 在该 Hermes 环境运行 `hermes plugins enable inky-coach --no-allow-tool-override`，然后重启本机后端加载 API。
4. 在 Hermes 的 **Settings → Plugins** 中点击 **Rescan / 重新扫描**，开启 **Desktop plugins → Inky Coach**。**Agent plugins → inky-coach** 是另一开关，两者都要开启。更新后重新扫描可重新渲染原会话卡片，不需重复采用计划。
5. 配置 `mcp_servers.inky_paper` 指向此项目 MCP 入口，并打开独立 Inky Paper。只修改 Paper 相关条目，保留已有其他连接。

MCP 配置示例，把路径替换为实际仓库位置：

```yaml
mcp_servers:
  inky_paper:
    command: node
    args:
      - 'C:/path/to/Inky-Paper/integrations/inky-paper-mcp-server/index.mjs'
```

默认读取 `%APPDATA%\com.inky.paper\paper-agent-bridge.json`。独立测试时可用 `INKY_PAPER_CONNECTION_FILE` 明确覆盖 MCP 和插件后端的连接路径，二者必须指向同一个测试实例。不要把测试配置复制到日常 profile。

首次询问：

> 请读取 `inky-coach:coach` skill，先读取 Inky Paper 最新计划和记录，帮我把今天想完成的事项拆成简短可选卡片。只在我询问时行动，不替我采用卡片。

回退时关闭桌面插件开关，运行 `hermes plugins disable inky-coach`，恢复已保存的本插件目录和对应配置；不要用旧整份配置覆盖无关的新修改。

## 构建与检查

在 Inky-Paper 项目根目录运行：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --dir integrations/inky-paper-mcp-server install --frozen-lockfile
./integrations/inky-coach-hermes-plugin/build-package.ps1
```

包和 SHA-256 文件输出到 `output/packages/`，版本号读取 manifest。脚本只生成包，不安装或启用；`-OutputDirectory` 可指定项目内另一目录。

静态与模拟检查：

```powershell
node --check integrations/inky-coach-hermes-plugin/desktop/plugin.js
corepack pnpm test:hermes-plugin
python -B -m unittest discover -s integrations/inky-coach-hermes-plugin/tests -p "test_*.py"
node integrations/inky-coach-hermes-plugin/tests/verify-mcp.mjs
```

Python 测试需在具备 `fastapi` 的环境中运行；使用已安装 Hermes 的 Python 环境亦可。这些检查不替代实际 Hermes 卡片验收。真实桌面写入须使用独立 `HERMES_HOME`、桌面用户数据和 Paper 调试数据，先核对实际连接，再操作。

## 已有验证与排查

2026-09-14，插件 0.1.1 在独立 Hermes 桌面和 Paper 测试库中验证：六张候选显示、选两张、编辑动作与时长、取消标签、调整顺序、明确采用后准确写入，未选卡片保持候选。该卡片测试未运行真实模型。[保留的验收报告](../../docs/verification/hermes-0.1.1/ui-acceptance.json) 描述具体检查；当前整理轮次是否重跑测试见 [项目进度](../../docs/PROJECT_STATUS.md)。

此前核查的 Hermes 实现中，`transcript-directives.ts` 提供扩展区域，`contrib/runtime-loader.ts` 加载插件，`ctx.rest` 访问后端，`_mount_plugin_api_routes` 将 `dashboard/manifest.json` 声明的 FastAPI 路由挂载于 `/api/plugins/inky-coach`。升级 Hermes 后需重新检查这些兼容点。

| 现象 | 优先检查 |
| --- | --- |
| 只显示 `::inky-plan{…}` 原文 | 桌面插件是否启用、是否重新扫描；模型说“已保存”不会启用渲染器 |
| 卡片区域显示连接错误 | Paper 是否运行，以及 MCP 与插件后端是否使用同一 Paper 连接 |
| 提示版本冲突 | 核对已变化的任务 / 步骤，保留草稿后再提交 |
| 候选标题仍很长 | 让当前会话重新读取 `inky-coach:coach`；旧任务不会自动改写 |
