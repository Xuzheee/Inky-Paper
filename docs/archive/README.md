# 历史资料

这里保存旧产品方案、独立复制时的源文件哈希清单及历次视觉验收说明。它们用于追溯，不再作为当前实现要求。

当前功能与边界以 [项目进度](../PROJECT_STATUS.md)、[使用说明](../每日计划与Coach使用说明.md) 和根目录 [AGENTS.md](../../AGENTS.md) 为准。`docs/specs/`、旧版本命名的说明及 `docs/design/` 是带日期的历史过程资料；其中旧按钮、自动 Coach、XP/等级等描述不能覆盖当前约定。

`original-source-manifest.json` 仅记录复制时的文件哈希，不依赖或连接原 Inky。`legacy-reference/original-pet.png` 保存原始宠物参考图；当前运行资产在 `public/`。

2026-09-15 整理时，未挂载的旧组件、旧 Rust 模块、旧 MCP、旧等级资产和一次性脚本已从工作目录移入本机隔离目录，不进入 Git。历史 `output/` 路径也已归档隔离，保留的验收证据集中在 [verification](../verification/README.md)。

## 2026-09-18 文档整理

22份过期入口资料归入 `legacy-docs/`：早期Paper版本说明、0.5.x人工验收清单、旧Agent协作/数据约定，以及原版Inky的2026年5月设计计划和发布记录。原文保留并标注历史用途，内部链接已随路径调整。

重复维护的长文改成当前短入口，旧内容保留为：

- [历版项目状态快照](PROJECT_STATUS-before-cleanup-20260918.md)
- [旧Hermes插件使用流程](每日计划与Coach使用说明-旧插件流程.md)
- [0.6.4人工验收清单](MANUAL_CHECKS-0.6.4.md)

根目录旧 `design-qa.md` 另归档为 [0.5.11视觉验收](design-qa-0.5.11.md)，共23份移动。15处原本已失效的历史附件链接改为带原路径的文字说明，避免继续显示损坏图片或无效入口。

完整移动映射与检查结果见 [清理清单](document-cleanup-20260918.json)。当前信息统一从 [文档导航](../README.md) 进入。归档不表示旧方案仍要实现；验收原始证据、许可证与正在使用的设计参考保留。
