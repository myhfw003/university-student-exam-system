# 备份与恢复演练记录（T-P9-05）

对应《08-deployment-operations.md》§7 与《07-security-compliance.md》§10 第 13 项。
**每个季度真跑一遍**，把结果记在这份文档里——备份不是纸面承诺。

## 备份方案

| 项 | 方案 |
|---|---|
| 连续归档 | 数据库侧 `archive_command=pgbackrest --stanza=db archive-push`，WAL 连续推送 → **RPO ≤ 5 分钟** |
| 全量 | 每日 02:00（基线全量在备份容器启动时做一次） |
| 差异 | 每日 03:00 |
| 过期清理 | 每周一 04:00 |
| 保留 | 全量 2 份、差异 7 份、WAL 归档 4 份 |
| 恢复 | `deploy/backup/restore.sh`（最新点或指定时间点） |
| 演练脚本 | `deploy/backup/restore-drill.sh`（恢复到临时实例并逐表校验行数） |

- 备份容器：compose 的 `backup` 服务（`deploy/backup/entrypoint.sh` 负责定时）。
- 数据库镜像：`deploy/backup/postgres.Dockerfile`——只多装 pgBackRest，**归档命令在数据库侧执行**，
  备份与归档必须用同一套工具、同一份配置。
- 配置：`deploy/backup/pgbackrest.conf`（stanza `db`）。

## 2026-11-15 演练记录（实测）

| 项 | 结果 |
|---|---|
| 环境 | PostgreSQL 17（容器 `postgres:17-alpine`），已应用全部迁移 |
| 规模 | 10 个业务 schema（iam / catalog / authoring / delivery / grading / learning / analytics / app / audit / outbox）+ 迁移历史表，共 **48 张表** |
| 备份 | `pg_dump -Fc` → **140 KB，耗时 1 秒** |
| 恢复 | `pg_restore` 到临时库 `exam_restore` → **耗时 1 秒** |
| 数据校验 | **48 张表逐表比对行数，全部一致**（脚本自动 diff，差异非空即失败退出） |
| 抽样 | 业务 schema 表数 47（另 1 张为 EF 迁移历史表）✓ |
| 结论 | **恢复机制可用**：备份 → 恢复 → 逐表校验，链路跑通 |

演练命令：

```bash
PG_CONTAINER=exam-postgres-1 PG_SUPERUSER=exam_owner PG_DATABASE=exam \
  ./deploy/backup/restore-drill.sh exam_restore
```

脚本会做五件事：全量备份 → 恢复到临时实例 → 逐表比对行数 → 抽样校验 → 清理临时库。
**任何一项不过就以非零码退出**，CI/值班可直接用退出码判定。

## 待办与说明

| 项 | 现状 | 计划 |
|---|---|---|
| pgBackRest 镜像构建 | Dockerfile 已就位；**本次演练环境无法构建**——构建沙箱的容器 DNS 解析不到 Alpine 软件源（宿主可访问，容器不可达），与配置本身无关 | 在有外网的构建环境构建镜像后，用 `restore.sh` 走一遍 pgBackRest 的恢复路径并补记 |
| RTO 实测 | 本次为**空库 + 少量数据**（140 KB）下的恢复耗时 1 秒，**不能代表生产 50 GB 的恢复时间** | 季度演练改用生产量级数据（或生产快照副本）实测，目标是恢复 ≤ 30 分钟 |
| RPO 实测 | WAL 连续归档已配置，**尚未在生产量级验证过「归档延迟 ≤ 5 分钟」** | 演练时检查 `pg_stat_archiver` 的 `last_archived_time` 距当前的延迟 |
| 恢复后的业务校验 | 本次只校验行数 | 恢复后补一次**答卷对账**（《ops-runbook.md》§5），确认数据不只是「行数对」，而是真的可用 |

