# ADR-001：采用整洁架构四层与单向依赖

**状态**：已接受　**日期**：2026-11-12

## 背景

考试系统的规则变更频繁（监考规则、组卷规则、评分规则都会改），而这些规则最终都要落到
数据库写入上。如果业务规则和 EF 实体、控制器混在一起，改一条规则就要在十几个文件里找影响面，
而且无法在不启动数据库的情况下验证规则。

## 候选方案

| 方案 | 结论 |
|---|---|
| 单层（控制器直接写 EF） | ❌ 规则与存储耦合，改规则必然动到界面层 |
| 三层（Controller → Service → Repository） | ❌ 「Service」容易长成万能袋，依赖方向仍然双向 |
| **整洁架构四层（Domain / Application / Infrastructure / Host）** | ✅ 依赖单向向内，规则可独立验证 |
| 事件溯源 | ❌ 本系统不需要重放历史，写放大了但换不来收益 |

## 决策

四层，依赖只允许由外向内：

- `Exam.Domain` —— 实体、值对象、领域规则与领域异常。**零 NuGet 依赖**，不出现任何 EF 特性。
- `Exam.Application` —— 用例（Command / Query）、契约、端口（接口）。**不得引用 EF Core**。
- `Exam.Infrastructure` —— EF 实现、仓储、外部系统适配、指标采集。
- `Exam.Web` / `Exam.Worker` —— 宿主：装配依赖、暴露 HTTP 与后台作业。

端口（`IExamMetrics`、`IAttemptRepository`、`IPermissionProvider` 等）定义在应用层，
实现放在基础设施层；应用层只认接口，不认实现。

## 代价与后果

- 多一层间接：写一个功能要跨 3 个项目，改起来比单层啰嗦。
- 收益是规则可测：领域层与应用层不需要数据库即可跑测试（`Exam.Domain.UnitTests` 与
  `Exam.Application.UnitTests` 不启动任何容器）。
- 规则由 `Exam.ArchitectureTests` 强制：应用层出现 EF 引用、领域层出现 NuGet 依赖、
  领域层出现 `Manager/Helper/Util` 之类通用词，构建即失败。

## 验证

```bash
dotnet test backend/tests/Exam.ArchitectureTests
```
