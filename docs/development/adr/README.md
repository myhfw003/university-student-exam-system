# 架构决策记录（ADR）

每条 ADR 记录一个**做过取舍的技术决策**：背景、候选方案、结论、代价。

索引（状态：已接受 / 已废弃 / 提案中）：

| 编号 | 标题 | 状态 |
|---|---|---|
| [ADR-001](0001-clean-architecture-layers.md) | 采用整洁架构四层与单向依赖 | 已接受 |
| [ADR-002](0002-mediatr-license-lock.md) | 锁定 MediatR 12.x（Apache-2.0） | 已接受 |
| [ADR-003](0003-paper-kind-unification.md) | 考试与练习共用 Paper 聚合，用 kind 区分 | 已接受 |
| [ADR-004](0004-question-vs-paper-item.md) | 题目与卷面题位分离建模 | 已接受 |
| [ADR-005](0005-immutable-paper-snapshot.md) | 发布时生成不可变试卷快照 | 已接受 |
| [ADR-006](0006-answer-current-and-revision-tables.md) | 答案采用「当前值 upsert + 修订流水 append-only」双表 | 已接受 |
| [ADR-007](0007-raw-sql-answer-upsert.md) | 作答保存走原生 SQL upsert，绕过 EF 变更追踪 | 已接受 |
| [ADR-008](0008-single-tag-table-with-dimensions.md) | 标签采用单表 + 维度判别 + 可选父标签树 | 已接受 |
| [ADR-009](0009-blueprint-deterministic-selection.md) | 组卷采用规则引擎 + 确定性种子，池不足时报错不降级 | 已接受 |
| [ADR-010](0010-question-import-real-implementation.md) | 试题导入走真实实现，不预留空的 AI 生成接口 | 已接受 |
| [ADR-011](0011-server-authoritative-timing.md) | 服务端权威计时，客户端时钟仅作显示 | 已接受 |
| [ADR-012](0012-anticheat-boundary.md) | 防作弊定位为可审计与可威慑，非绝对防护 | 已接受 |
| [ADR-013](0013-signalr-batched-proctoring.md) | 监考采用 SignalR + 2 秒批量聚合推送 | 已接受 |
| [ADR-014](0014-custom-svg-charts.md) | 图表自研 SVG 组件，不引入重型图表库 | 已接受 |
| [ADR-015](0015-schema-separated-append-only.md) | 数据库分 Schema，追加式表独立 Schema + 权限收回 | 已接受 |
| [ADR-016](0016-pbkdf2-password-hashing.md) | 密码哈希用 PBKDF2-HMAC-SHA256，自带版本化格式 | 已接受 |
| [ADR-017](0017-npgsql10-prepared-statements.md) | Npgsql 10 下 PgBouncer 事务池的兼容性结论 | 已接受 |
| [ADR-018](0018-tags-replace-organization-tree.md) | 用标签维度替代独立组织树 | 已接受 |
| [ADR-019](0019-data-kept-until-explicitly-cleaned.md) | 数据不设默认保留期，删除一律软删除 | 已接受 |
| [ADR-020](0020-tag-tree-cross-dimension.md) | 标签树允许内容维度之间跨维度挂接 | 已接受 |
| [ADR-021](0021-shared-original-password-for-reset.md) | 重置密码统一置为系统设定的原始密码，响应里不带密码 | 已接受 |
| [ADR-022](0022-registration-password-vs-system-original.md) | 注册时给的密码就是该账号的登录密码；重置一律回系统原始密码 | 已接受 |
| [ADR-023](0023-ai-generation-real-model.md) | AI 生成试题接入真实大模型；产出走与导入相同的校验 | 已接受 |

## 格式约定

每条 ADR 包含：背景（当时的约束）、候选方案、结论、代价与后果、状态。
**已接受的 ADR 不删除**，若决策变更则新增一条并把旧条目标为「已废弃」。
