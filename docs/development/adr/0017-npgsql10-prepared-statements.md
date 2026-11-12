# ADR-017：Npgsql 10 下 PgBouncer 事务池的兼容性结论

**状态**：已接受　**日期**：2026-11-12

## 背景

设计文档原计划在 `UseNpgsql(..., o => o.UseServerPreparedStatements(false))`，
以规避 PgBouncer **事务池模式**与服务端预备语句不兼容的经典问题。

P0 实施时实测发现：**该 API 在 Npgsql 10 中已不存在**。

## 实测结论

```
$ dotnet add package OpenTelemetry...  # 探针
NpgsqlConnectionStringBuilder 属性扫描：
  MaxAutoPrepare        : Int32，默认值 0
  AutoPrepareMinUsages  : Int32，默认值 5

连接串关键字 "Server Prepared Statements=false"
  → ArgumentException: Couldn't set server prepared statements
```

EF 层 `NpgsqlDbContextOptionsBuilder.UseServerPreparedStatements` 同样不存在（编译期报错）。

**结论**：
1. Npgsql 10 移除了 EF 层的预备语句开关与 `Server Prepared Statements` 连接串关键字。
2. `Max Auto Prepare` 默认为 **0**，即**默认不生成服务端预备语句**。
3. 因此 Npgsql 10 的默认行为与 PgBouncer 事务池**天然兼容**，无需任何额外配置。

## 决策

- 删除 `UseServerPreparedStatements(false)` 调用。
- 在 `deploy/docker-compose.yml` 的 `pgbouncer` 服务中保留 `POOL_MODE: transaction`。
- **红线**：若将来因性能原因把 `Max Auto Prepare` 调大于 0（启用服务端预备语句），
  **必须**同时把 PgBouncer 改为 session 池或改回直连 PG，
  否则会出现 `prepared statement does not exist` 错误，且只在高并发下偶发，极难排查。

## 后果

- 设计文档 `08-deployment-operations.md` §1.2 与本 ADR 同步记录该结论与红线。
- 少了一个配置项，也少了一个「以为设了但其实没设」的陷阱。
