# ADR-007：作答保存走原生 SQL upsert，绕过 EF 变更追踪

**状态**：已接受　**日期**：2026-11-12

## 背景

答案保存是全系统最高频的写路径：单场 1000 人，每人每 10 秒保存一批（每批最多 50 题），
峰值约 1000 次请求/秒、5 万行/秒。EF Core 的变更跟踪在这个量级上会产生大量
`ChangeTracker` 操作与固定开销，且 upsert 语义无法用 EF 的 `SaveChanges` 干净表达。

## 候选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| EF `AddOrUpdate` + SaveChanges | 写法简单 | 变更跟踪开销大；`SaveChanges` 的事务与语句数不可控 |
| **原生 SQL `INSERT ... ON CONFLICT DO UPDATE`** | 语句数固定、语义精确 | 绕开 EF，映射要自己维护 |
| 批量 `COPY` | 最快 | 与「部分题目被拒」的语义冲突 |

## 决策

`AnswerRepository.UpsertRangeAsync` 走原生 SQL 的 `INSERT ... ON CONFLICT (attempt_id, question_id)
DO UPDATE`，一条语句处理整批，事务边界仍由 UnitOfWork 控制。

原生命令的参数全部走 `DbParameter` 绑定，不做字符串拼接。架构测试 `SqlInjectionGuardTests`
守着这条线：基础设施层出现 `FromSqlRaw` / `ExecuteSqlRaw` 且首参是插值字符串或含 ` + `，
构建即失败。

## 代价与后果

- 答案表的列名与类型要在仓储里手工对齐，改列要同步改这里（由架构测试与集成测试兜底）。
- 收益：峰值写入路径的语句数与耗时可控，且不与「被拒的单题不落库」的语义冲突
  （被拒的题目在进仓储之前就被过滤掉了）。
