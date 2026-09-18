# P0/P1 本轮证据

需求与依赖：[推进台账](../../plans/p0p1/ledger.md)。这里只记录本轮执行，不把历史版本结果当作本轮新需求验收。

| 阶段 | 证据 | 状态 |
| --- | --- | --- |
| M0 | [公共约定](../../plans/p0p1/contract.md)、[基线检查](M0/baseline.json)、[Coach 基线](M0/coach-baseline.md)、[旧格式夹具](M0/legacy-fixture.json) | 基线与夹具通过；模型评分待 M2/M5 |
| M1 | [共同数据、字段、今日队列与准备来源](M1/README.md) | 已完成分阶段验收 |
| M2 | [交流范围、调整候选、权限与真实模型](M2/README.md) | 已完成分阶段验收 |
| M3 | [草稿、原请求重试、收尾与笔记整理](M3/README.md) | 已完成分阶段验收 |
| M4 | [预算、项目、偏好及模型对照](M4/README.md) | 已完成分阶段验收 |
| M5 | [已写总结功能](M5/C03-implementation.md)、[试用交付](../0.7.0-beta.1/README.md)、[剩余待办](../../plans/p0p1/M5_PENDING.md) | 试用已交付；总结真实验收及完整案例评测后移 |

测试 SQLite、WebView 配置、连接文件、令牌与真实个人资料不纳入 Git。模型样本只保留合成测试输入、可见回答和必要工具事实，原凭据不入证据。
