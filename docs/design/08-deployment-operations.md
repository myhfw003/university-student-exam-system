# 08 · 部署、运维与容量设计

> 关联：`01-requirements.md` §3.1（性能）、`04-data-model.md`（迁移）

---

## 1. 部署拓扑

单区域生产拓扑，容器化编排（单机 Docker Compose 起步，可平滑迁移到 K8s）。

```
                        ┌──────────────────────┐
   浏览器 ────HTTPS────► │  nginx (反代 + TLS)   │ :80 :443
                        └──────┬───────────────┘
                               │  /api/  /hubs/  /student/  /admin/
             ┌─────────────────┼─────────────────┐
             ▼                 ▼                 ▼
     ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
     │  api-1 (.NET) │ │  api-2 (.NET) │ │  api-N (.NET) │   ← 无状态，水平扩展
     └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
             │                 │                 │
     ┌───────┴─────────────────┴─────────────────┴───────┐
     ▼                     ▼                       ▼
┌─────────┐        ┌──────────────┐        ┌──────────────┐
│  Redis 7 │        │ PostgreSQL 17 │        │ MinIO (S3)   │
│ 黑名单/缓存 │        │  + PgBouncer  │        │ 题目附件      │
│ 限流/Backplane│      │              │        │              │
└─────────┘        └──────┬───────┘        └──────────────┘
                          │
                   ┌──────▼───────┐
                   │  pgBackRest  │  备份仓库
                   └──────────────┘

        ┌──────────────┐        ┌─────────────────┐
        │  worker (.NET) │        │ Prometheus      │ ← 拉取 /metrics
        │ 对账/统计/分区   │        │ Grafana/Alertmanager │
        └──────────────┘        └─────────────────┘
```

### 1.0 宿主机端口暴露策略

**只有 API 与 nginx 对宿主机发布端口。** PostgreSQL、Redis、MinIO、PgBouncer 只在 compose
内部网络可达：

- 安全：数据库与缓存不暴露到宿主机网卡，减少误配置与横向移动的风险。
- 运维：宿主机上往往已有同端口的服务（5432 / 6379 / 9000），不发布端口可避免冲突。
- 排查：需要直连时用 `docker compose exec postgres psql -U exam_owner -d exam`。

**PgBouncer 为可选 profile**：

```bash
docker compose --profile pgbouncer up -d     # 启用事务池（1000 并发生产环境建议）
docker compose up -d                          # 不启用，API 直连 PG
```

启用与否通过 `.env` 的 `DB_HOST` / `DB_PORT` 切换（`pgbouncer:6432` 或 `postgres:5432`）。

### 1.1 组件清单

| 组件 | 镜像 | 副本 | 说明 |
|---|---|---|---|
| `nginx` | `nginx:1.27-alpine` | 1 | TLS 终结、静态资源、`/api` 与 `/hubs` 反代 |
| `api` | 自建（`mcr.microsoft.com/dotnet/aspnet:10.0`） | 2 起 | REST + SignalR，无状态 |
| `worker` | 自建（同上，Worker 角色） | 1 | 后台作业；多副本需分布式锁 |
| `postgres` | `postgres:17-alpine` | 1（主） | 业务库 |
| `pgbouncer` | `edgedb/pgbouncer` | 1 | 事务池化 |
| `redis` | `redis:7-alpine` | 1 | 见 `02-architecture.md` §10 |
| `minio` | `minio/minio` | 1 | 题目附件 |
| `prometheus` | `prom/prometheus:v2.54` | 1 | 指标 |
| `grafana` | `grafana/grafana` | 1 | 看板 |
| `alertmanager` | `prom/alertmanager` | 1 | 告警路由 |

### 1.2 为什么用 PgBouncer

1000 并发下，PG 的连接数是硬约束：

- .NET `Npgsql` 默认每进程最大连接 100；2 个 API 实例就是 200 条连接。
- PostgreSQL 默认 `max_connections = 100`，且每个连接是一个进程，会显著消耗内存。
- **PgBouncer 事务池化**把应用连接复用为少量后端连接：应用侧看到 200 条逻辑连接，PG 侧实际只有 `default_pool_size`（默认 25）条后端连接。

**注意事项（必须遵守）**：

1. **Npgsql 10 实测结论**：Npgsql 10 已移除 EF 层的 `UseServerPreparedStatements` 开关，也移除了 `Server Prepared Statements` 连接串关键字（传入会抛 `ArgumentException`）。Npgsql 10 的 `Max Auto Prepare` 默认为 `0`，即**默认不生成服务端预备语句**，因此与 PgBouncer 事务池天然兼容。
   - **红线**：若将来把 `Max Auto Prepare` 调大于 0（启用服务端预备语句），**必须**同时把 PgBouncer 改为 session 池，或换用直连 PG。否则会出现「prepared statement does not exist」错误。
2. 启用 PgBouncer 后，连接串必须指向 PgBouncer 端口，不是 PG 端口。
   compose 默认值是**直连 PG**（`postgres:5432`），因为 PgBouncer 是可选 profile；
   启用 profile 后需在 `.env` 中把 `DB_HOST` / `DB_PORT` 显式改为 `pgbouncer` / `6432`。
   默认值若指向未启动的 PgBouncer，新环境按 `.env.example` 部署必然连不上库。
3. 迁移作业（`dotnet ef database update`）**绕过 PgBouncer**，直连 PG。
4. 长事务不可用：本系统的写事务都在毫秒级，无长事务，符合事务池要求。
5. **连接池按实例数算**：直连 PG 时 `max_connections=200`，2 个 API 实例各 80 条连接
   （Worker 20 条、迁移与运维直连若干），留有余量；启用 PgBouncer 后客户端池可以放大到 200，
   因为事务池会把客户端连接复用为 `default_pool_size` 条后端连接。连接串里的
   `Maximum Pool Size` / `Minimum Pool Size` 由 `DB_MAX_POOL_SIZE` / `DB_MIN_POOL_SIZE` 注入。

---

## 2. 容量模型

### 2.1 负载估算（单场 1000 人）

| 指标 | 计算 | 数值 |
|---|---|---|
| 平均保存 QPS | 1000 人 ÷ 8 秒/题 | 125 QPS |
| 峰值保存 QPS | 交卷前 1 分钟集中保存 | ~1000 QPS |
| 开考瞬间请求 | 1000 人同时 `POST /attempts` | 1000 请求 / 30 秒窗口 ≈ 33 QPS，但有突发 |
| 会话创建吞吐要求 | — | ≥ 300 次/秒（应对更激进的集中进入） |
| 心跳 QPS | 1000 人 ÷ 15 秒 | 67 QPS |
| 监考推送 | 1000 人 × 每 2 秒一批 | 0.5 批/秒（约 100 KB/批） |
| 试卷快照读取 | 1000 人进考场时读同一份快照 | Redis 命中后近乎零 DB 压力 |

### 2.2 资源估算

| 资源 | 单场 1000 人 | 依据 |
|---|---|---|
| API CPU | 2 核 × 2 实例可承载 1000 并发 | 答案保存为 I/O 密集，CPU 主要在 JSON 序列化 |
| API 内存 | 每实例 512 MB ~ 1 GB | 主要为 EF 变更追踪缓冲与 SignalR 连接 |
| PG 连接 | PgBouncer 后端 25 + 迁移/运维直连 10 | |
| Redis 内存 | 1 GB 足够 | 黑名单 + 缓存 + 限流 + 活跃状态 |
| 磁盘 | 数据 50 GB + 附件 20 GB + 备份 3 份 | |

### 2.3 性能设计要点（对应 1000 并发的关键决策）

| 决策 | 理由 |
|---|---|
| 答案保存走**原生 SQL 批量 upsert**，不走 EF 变更追踪 | 1000 QPS 下 EF 的变更追踪与 `SaveChanges` 开销不可接受 |
| 单批上限 50 条，批量 upsert 一条 SQL | 减少往返 |
| 试卷快照进 Redis，题目正文不查库 | 避免 1000 人同时读题库 |
| 卷面派生是**纯函数**，无状态 | 不需要存储，可重复计算 |
| 监考推送**批量聚合**（2 秒一批） | 避免 1000 条独立消息 |
| 统计走读模型，实时算分只在交卷时 | 成绩分析不在热路径 |
| 心跳与保存合并请求 | 减少请求数 |
| 作答接口**不依赖 Redis** | Redis 故障不影响作答（P-07） |
| 限流状态降级放行 | 同上 |

---

## 3. 配置与密钥

### 3.1 环境变量清单

```bash
# 应用
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://+:8080
ConnectionStrings__Database=Host=postgres;Port=5432;Database=exam;Username=exam_app;Password=<secret>;Maximum Pool Size=80;Minimum Pool Size=10;Timeout=15;Command Timeout=30;Keepalive=30
# 启用 PgBouncer profile 时改为 Host=pgbouncer;Port=6432
# 连接池大小按「实例数 × 池大小 ≤ max_connections」算；启用 PgBouncer 后可放大（事务池复用后端连接）
ConnectionStrings__Migration=Host=postgres;Port=5432;Database=exam;Username=exam_owner;Password=<secret>
ConnectionStrings__Redis=redis:6379,password=<secret>,abortConnect=false
Jwt__Issuer=https://exam.example.edu
Jwt__Audience=exam-web
Jwt__SigningPrivateKeyPemBase64=<base64 单行 PEM>
Jwt__SigningPrivateKeyPemFile=/run/secrets/jwt-private.pem   # 与上面二选一，文件优先
Jwt__SigningPublicKeyPem=<secret>
Jwt__AccessTokenMinutes=15
Jwt__RefreshTokenDays=7
ObjectStorage__Endpoint=http://minio:9000
ObjectStorage__AccessKey=<secret>
ObjectStorage__SecretKey=<secret>
ObjectStorage__Bucket=exam-attachments
AllowedHosts=exam.example.edu
CORS__AllowedOrigins=https://exam.example.edu
```

**规则**：`appsettings.json` 只存非敏感默认值与键名；所有密钥经环境变量注入。

**私钥注入形式**：多行 PEM 经环境变量传递时换行会被转义成字面 `\n`，导致
`RSA.ImportFromPem` 解析失败。因此优先使用 **Base64 单行**（`Jwt__SigningPrivateKeyPemBase64`）
或**挂载文件**（`Jwt__SigningPrivateKeyPemFile`），内联多行 PEM 仅用于本地调试。
详见 `docs/development/ops-runbook.md` 第 3 节。

### 3.2 分环境配置

| 环境 | `appsettings` | 数据来源 |
|---|---|---|
| Development | `appsettings.Development.json`（本地默认值，无密钥） | `dotnet user-secrets` |
| Test | `appsettings.Test.json` | 测试容器随机生成 |
| Production | `appsettings.Production.json`（无密钥） | 环境变量 |

---

## 4. 数据库迁移与初始化

### 4.0 构建环境的 DNS 前提（重要）

Docker 容器使用自己的网络命名空间与 DNS 配置，**未必能访问宿主配置的上游解析器**。
实测症状：

```
$ docker run --rm mcr.microsoft.com/dotnet/sdk:10.0 getent hosts api.nuget.org
（无输出）

$ curl https://api.nuget.org
curl: (6) Could not resolve host: api.nuget.org
```

后果：`docker build` 在 NuGet 还原阶段失败（`exit code 1`），容器内 `apk add` 等同样失败。

**本机实测的精确诊断**（Docker 29.8.0 / BuildKit v0.37.1）：

| 运行方式 | 容器内 `/etc/resolv.conf` | 结果 |
|---|---|---|
| `docker run`（默认 bridge） | 继承宿主：`223.5.5.5` / `172.16.90.1` | 解析失败 |
| `docker run --network=host` | 继承宿主：`223.5.5.5` / `172.16.90.1` | **解析成功** |
| **BuildKit RUN 步骤** | `100.100.100.100` + IPv6 `fd7a:115c:a1e0::53` | 解析失败 |

关键点：**BuildKit 不采纳 `docker build --network=host`**——RUN 步骤仍使用自己的网络命名空间，
并注入云厂商内部解析器 `100.100.100.100`（该地址在本环境不可达）。
而 `docker run --network=host` 使用宿主网络栈，能正常解析。

因此两种可行路径：

| 方式 | 命令 | 代价 |
|---|---|---|
| 经典构建器（走宿主解析器） | `DOCKER_BUILDKIT=0 docker build --network=host .` | 经典构建器已废弃，Docker 未来版本会移除；无缓存加速 |
| 给 BuildKit 配可达 DNS | 改 `/etc/docker/daemon.json` 的 `dns` 字段后**重启 Docker 守护进程** | 会连带重启该主机上所有容器 |

NuGet 侧的报错形如：

```
error NU1301: Unable to load the service index for source https://api.nuget.org/v3/index.json.
  Resource temporarily unavailable (api.nuget.org:443)
```

本仓库的 `deploy/build.sh` 提供 `BUILD_NETWORK=host` 与 `BUILD_LEGACY=1` 两个开关：

```bash
BUILD_LEGACY=1 BUILD_NETWORK=host bash deploy/build.sh
```

> 在标准 CI 或开发机上（容器 DNS 正常）不需要任何额外开关，直接 `docker compose build` 即可。
> 本节记录的是特定宿主环境的约束，不是本项目的固有要求。

### 4.1 流程

```
1. CI 构建 api / worker 镜像
2. 部署流水线执行一次性迁移容器：
     docker compose run --rm migrate
   （等价于 `dotnet Exam.Worker.dll --migrate`：用 exam_owner 账号直连 PG 调用
     DbContext.Database.Migrate()，绕过 PgBouncer）
3. 迁移成功后启动 api 实例
4. 首次部署：运行种子作业（幂等）
     docker compose run --rm -e Seed__AdminUsername=admin -e Seed__AdminPassword='...' worker --seed
```

**为什么不用 `dotnet ef` CLI 做容器内迁移**：
EF 的 Design 包只在「生成迁移」时需要；运行时直接调用 `Migrate()` 即可。
把迁移做成 Worker 的一个模式，可省掉镜像里的 SDK 与 `dotnet-ef` 工具链（镜像小一个数量级），
也避免容器内再走一次 NuGet 还原。`dotnet ef` 仍在本机开发时用于生成迁移脚本。

- 应用容器**不自动迁移**（多实例同时迁移会锁冲突）。
- 迁移失败时流水线中止，**不启动新版本**。
- 迁移脚本入库（`backend/src/Exam.Infrastructure/Persistence/Migrations/`），CI 校验"空库一次跑通"。

### 4.2 种子作业

`Exam.Worker --seed` 一次性任务，写入权限、角色、组织维度标签树、题目标签、示例题目、示例账号。用 `seed_marker` 表记录已执行的种子版本，重复执行安全。

---

## 5. 可观测性

### 5.1 指标（Prometheus）

指标分两拨：API 进程报的（业务链路）与 Worker 进程报的（后台作业与数据库水位）。
**同一个指标名只在一个进程里出现**——两个进程各报一次，告警里的比例就凭空翻倍。

#### API 进程（`/metrics`）

| 指标 | 类型 | 标签 | 用途 |
|---|---|---|---|
| `http_requests_total` | Counter | method, route, status | 请求量 |
| `http_request_duration_seconds` | Histogram | method, route | 延迟分位 |
| `attempt_answers_saved_total` | Counter | result | 保存批次（saved / duplicate / rejected） |
| `attempt_answers_saved_duration_seconds` | Histogram | — | 落库延迟（关键 SLO） |
| `attempt_answer_items_rejected_total` | Counter | — | 单题被拒数 |
| `attempt_focus_events_total` | Counter | type | 焦点事件分布 |
| `exam_sessions_published_total` | Counter | — | 场次发布次数 |
| `signalr_connections` | Gauge | — | SignalR 连接数 |
| `clock_offset_ms` | Gauge | instance | 时钟偏移（P-06） |
| `redis_up` | Gauge | — | Redis 可用性（1 可用 / 0 不可用） |
| `redis_command_duration_seconds` | Histogram | op | Redis 命令延迟 |

#### Worker 进程（`:9090/metrics`）

| 指标 | 类型 | 标签 | 用途 |
|---|---|---|---|
| `attempt_active_sessions` | Gauge | examSessionId | 活跃作答会话数 |
| `outbox_pending_messages` | Gauge | — | Outbox 积压 |
| `background_job_duration_seconds` | Histogram | job | 后台作业耗时 |
| `background_job_failures_total` | Counter | job | 后台作业失败次数 |
| `answer_reconciliation_findings_total` | Counter | — | 答卷对账发现的差异数 |
| `db_pool_active_connections` | Gauge | — | 数据库服务端连接数 |
| `db_pool_max_connections` | Gauge | — | 数据库服务端连接上限 |
| `db_pool_available_connections` | Gauge | — | 数据库服务端剩余连接 |

#### 外部来源

| 指标 | 来源 | 用途 |
|---|---|---|
| `node_filesystem_avail_bytes` / `node_filesystem_size_bytes` | node_exporter | 宿主机磁盘水位 |
| `pgbackup_last_run_success` | 备份任务写 textfile，node_exporter 采集 | 最近一次备份是否成功 |
| `pgbackup_last_success_timestamp_seconds` | 同上 | 最近一次成功备份的时刻 |
| `pgbackup_last_run_timestamp_seconds` | 同上 | 最近一次备份任务的执行时刻 |

**口径说明**（都是踩过坑才定下来的）：

- `attempt_answers_saved_total` 是**批次**口径：`saved` 整批落库、`duplicate` 重放整批忽略、
  `rejected` 整批被拒（场次取消、超时、已交卷）。分子分母同为批次，错误率才有意义。
- 单题被拒（题不在卷面、载荷不合法）另计 `attempt_answer_items_rejected_total`：**一题一次**，
  不混进批次口径——一题一次混进批次口径，错误率的分母就被悄悄改小了。
- `attempt_answers_saved_duration_seconds` 只观测真正落库的批次。被拒批次的 0 秒混进直方图，
  p95 会被拉低，掩盖真实延迟。
- `attempt_active_sessions` 由 Worker 从 `delivery.attempt` 采样，判据是**心跳新鲜度**
  （在场的 `in_progress` 会话且心跳未超时），不靠进程内加减：进程内加减在多实例与重启后必然失真，
  而心跳一停就能立刻看出掉线。场次不在进行中时序列被撤掉——留着 0 值序列，
  考完之后告警还会拿 0 去比考中的峰值。
- `db_pool_*` 是 **PostgreSQL 服务端**连接数，不是 Npgsql 客户端池：Npgsql 没有公开客户端池的统计接口，
  但真正会把数据库压垮的是服务端连接数，而 `pg_stat_activity` 与 `max_connections` 应用账号都读得到。
- `clock_offset_ms` 是应用时钟与数据库时钟的**绝对偏差**（毫秒）；`instance` 标签由 Prometheus 采集时
  自动附加，哪个实例偏了就看哪个。
- `http_requests_total` 的 `route` 标签取路由模板（`api/v1/attempts/{id}`），不取原始路径——
  原始路径由客户端控制，拿它当标签等于把标签基数交给攻击者。

**采集路径**：API 进程的 `/metrics`（prometheus-net 注册表）与 Worker 的 `:9090/metrics`
（独立注册表，只读端口）。两处都由 Prometheus 直接抓——配置见 `deploy/monitoring/prometheus.yml`，
告警规则见 `deploy/monitoring/prometheus-rules.yml`，路由见 `deploy/monitoring/alertmanager.yml`，
看板见 `deploy/monitoring/grafana/dashboard-exam.json`。

**指标要先建好**：即使还没发生过保存答案，`/metrics` 也要列出指标名——
告警表达式不能因为「指标不存在」而失效。

**规则引用的指标必须真的存在**：`scripts/check-metric-names.py` 在 CI 里核对
「规则与看板引用的指标名」与「应用导出的指标名」，对不上即失败。
引一个不存在的指标，规则永远不触发，而且没有任何报错。

### 5.2 日志

- Serilog 输出 JSON 到 stdout，由 Docker 日志驱动收集。
- 每条日志含 `Timestamp`、`Level`、`TraceId`、`SpanId`、`RequestId`、`UserId`、`AttemptId`（如适用）、`EventName`、`Properties`。
- 访问日志与业务日志分离采样：成功请求不采样，`/api/v1/attempts/*/answers` 单独用 `Information` 级别记录批次摘要（不含答案内容）。

### 5.3 链路追踪

OpenTelemetry + OTLP 导出。每条请求生成 Trace，Span 划分：HTTP → MediatR 管道 → EF 查询 → Redis → PostgreSQL。跨服务（api → worker 通过 Outbox）通过 Outbox 消息里的 `trace_id` 关联。

### 5.4 告警规则

规则的唯一事实来源是 `deploy/monitoring/prometheus-rules.yml`，下表是它的人读版。
值班时按**规则名**检索（Prometheus、Alertmanager、Grafana 里都用这个名字）。

| 告警 | 规则名 | 条件 | 级别 | 处置 |
|---|---|---|---|---|
| 答卷保存错误率升高 | `ExamAnswerSaveErrorRateHigh` | 5 分钟内整批被拒占比 > 1% | P1 | 查 DB 连接池、限流、PG 负载 |
| 答卷保存 p95 超标 | `ExamAnswerSaveP95High` | 5 分钟 p95 > 500 ms | P2 | 同上 |
| **答卷丢失疑似** | `ExamAnswerLostSuspected` | 对账作业发现序列号差异 > 0 | **P1** | 立即人工核查，暂停相关场次 |
| 可用会话数骤降 | `ExamActiveSessionsDropped` | 单场次活跃会话数相对 15 分钟峰值下降 > 30% | P1 | 查网关/负载均衡/前端报错 |
| 切屏事件激增 | `ExamFocusEventsSpiking` | 平均每秒 > 50 次，持续 10 分钟 | P2 | 查监考处置与客户端异常 |
| 时钟偏移 | `ExamClockOffsetHigh` | `clock_offset_ms > 50` 持续 5 分钟 | P2 | 检查 NTP |
| 数据库连接耗尽 | `ExamDatabaseConnectionsExhausted` | 可用连接 < 上限的 10% | P1 | 查连接泄漏与慢查询 |
| Outbox 积压 | `ExamOutboxBacklog` | 待派发 > 1000 持续 5 分钟 | P2 | 查 worker 状态 |
| 后台作业失败 | `ExamBackgroundJobFailed` | 30 分钟内有作业失败 | P2 | 查 Worker 日志 |
| 后台作业变慢 | `ExamBackgroundJobSlow` | 作业 p95 > 300 秒 | P2 | 查 Worker 日志与数据库负载 |
| Redis 不可用 | `ExamRedisUnavailable` | `redis_up == 0` 持续 1 分钟 | P1 | 查 Redis；作答路径应仍可用 |
| Redis 命令变慢 | `ExamRedisCommandSlow` | p95 > 50 ms | P2 | 查 Redis 负载与网络 |
| 磁盘使用 > 80% | `ExamDiskUsageHigh` | 5 分钟 | P2 | 清理/扩容 |
| 备份失败 | `ExamBackupFailed` | 最近一次备份失败，或备份任务从未执行 | P1 | 立即重跑 |
| 备份过期 | `ExamBackupStale` | 26 小时没有成功备份 | P1 | 查备份任务、归档目录与 WAL 归档链路 |
| HTTP 5xx 比例 | `ExamHttpErrorRateHigh` | 5 分钟内 > 0.1% | P1 | 查最近的发布与数据库负载 |

**每条规则都有单元测试**：`deploy/monitoring/prometheus-rules.test.yml` 用 promtool
造出越界的指标序列，断言告警按预期 firing，正常时断言不 firing。
改规则必须同步改用例，CI 里 `promtool test rules` 不过即失败。

**规则引用的指标必须真的存在**：`scripts/check-metric-names.py` 在 CI 里核对
「规则与看板引用的指标名」与「应用导出的指标名」，对不上即失败。

### 5.5 健康检查

| 端点 | 用途 | 依赖 |
|---|---|---|
| `/health/live` | 存活探针 | 无 |
| `/health/ready` | 就绪探针 | PG、Redis、对象存储 |
| `/health/startup` | 启动探针 | 迁移与种子完成标记 |

**注意**：`/health/ready` 包含 Redis。Redis 故障时实例应**保持就绪**（作答路径不依赖 Redis），因此 Redis 检查只报告状态、不影响就绪判定；PG 不可用则判定为不就绪。

---

## 6. 压测设计

### 6.1 工具与场景

k6（脚本 `backend/tests/Exam.LoadTests/`），四类场景：

| 场景 | 目标 | 负载模型 |
|---|---|---|
| `login` | 认证链路 | 1000 VU，30 秒 |
| `start-exam` | 开考突发 | 1000 VU 同时 `POST /attempts`，30 秒窗口 |
| `answer-submit` | 持续作答 | 1000 VU，每 8 秒保存一批答案，持续 10 分钟 |
| `submit-burst` | 交卷突发 | 1000 VU 在最后 60 秒集中交卷 |

### 6.2 阈值（CI 强制）

```
LOSS_RATE_MAX        = 0.0      # 答卷丢失率必须为 0
HTTP_ERROR_RATE_MAX  = 0.001    # < 0.1%
P95_LATENCY_MS_MAX   = 500      # 答案保存 p95
P99_LATENCY_MS_MAX   = 1500
MIN_REQUESTS         = 30000
```

### 6.3 零丢答验证（关键）

压测不能只看 HTTP 成功率，必须做**端到端对账**：

```
1. 压测端为每个虚拟用户生成唯一 clientSeq 序列并记录到本地文件
2. 压测结束后从数据库读回 attempt_answer 与 answer_revision
3. 断言：每个虚拟用户提交的最后一个 clientSeq 均已落库，且 revision 数 ≥ 提交批次数
4. 输出差异清单（若有）
```

对账逻辑同时作为生产环境的每日作业（`AnswerReconciliationJob`）。

### 6.4 压测环境

- 独立 compose 栈（PostgreSQL 17 + Redis + MinIO + 2 个 API 实例 + nginx）。
- 数据量接近生产：至少 10 万道题、100 万条历史作答、1000 名考生账号。
- 机器规格与生产同构；否则结果不可比。

---

## 7. 备份与恢复

| 项 | 方案 |
|---|---|
| 全量备份 | 每日 pgBackRest 全量 |
| 增量 | WAL 归档连续，RPO ≤ 5 分钟 |
| 保留 | 日备 14 天，周备 8 周，月备 12 个月 |
| 加密 | pgBackRest 仓库加密，密钥独立保管 |
| 对象存储 | MinIO 桶版本化 + 异地同步 |
| 恢复演练 | 每月自动恢复到临时实例并校验行数与校验和 |
| 恢复手册 | `docs/development/ops-runbook.md` |

**恢复目标**：RTO ≤ 30 分钟。

---

## 8. 发布流程

### 8.1 流水线

```
push / PR
  → CI：dotnet build（警告即错误）→ 单元测试 → 架构测试 → 覆盖率门禁
  → CI：pnpm install → tsc --noEmit → eslint → vitest → 构建两个 SPA
  → CI：依赖漏洞扫描 + secret 扫描
  → 构建镜像并打 tag（git sha）
  → 部署到 staging：执行迁移 → 部署 → 冒烟测试 → 压测基线
  → 人工批准 → 生产：滚动部署（迁移先行）→ 健康检查 → 冒烟
```

### 8.2 零停机发布

- API 滚动发布：逐实例替换，SignalR 支持客户端重连。
- **数据库迁移必须向后兼容**：先发布兼容新旧 schema 的代码，再执行破坏性迁移（删列分两步，见 `04-data-model.md` §12）。
- **考试进行中的场次不允许重启正在承载该场次的实例**：发布窗口避开考试时段，或使用蓝绿部署保留旧实例承载现有场次。

### 8.3 回滚

- 应用回滚：镜像 tag 回退（数据库迁移保持向前兼容即可）。
- 数据库回滚：破坏性迁移不可自动回滚，需补偿脚本；因此破坏性变更一律分两步发布。

---

## 9. 运维手册要点

### 9.1 常见故障处置

| 症状 | 排查 | 处置 |
|---|---|---|
| 学生反馈答案没保存 | 查 `attempt_answer` 是否有该 clientSeq | 查限流日志；若被限流，放宽该端点阈值并通知前端重试 |
| 交卷接口 5xx 增多 | 查 PG 连接池与慢查询 | 临时扩容 API 副本；必要时对作答端点限流降载 |
| 监考大屏不更新 | 查 SignalR 连接数与聚合任务 | 重启 broadcaster；监考不影响作答 |
| 切屏计数异常增多 | 查客户端上报频率与去重逻辑 | 若是前端 bug 导致重复上报，临时提高去重窗口 |
| 时钟偏移告警 | 查 NTP 同步状态 | 暂停该实例的流量并修复，避免影响计时公平性 |
| 对账发现丢答 | 查 `answer_revision` 与客户端序列 | 按 `attempt_id` 从 `answer_revision` 重建 `attempt_answer`；生成事故报告 |

### 9.2 例行任务

| 任务 | 频率 | 说明 |
|---|---|---|
| 答卷对账 | 每日 + 考试期间每 10 分钟 | 校验序列号一致性 |
| 统计重算 | 每日 | Analytics 读模型全量重算 |
| 分区维护 | 每日 | 预建下月分区，detach 过期分区 |
| Token 清理 | 每日 | 删除过期 refresh token 与黑名单项 |
| 备份 | 每日 + WAL 连续 | pgBackRest |
| 恢复演练 | 每月 | 自动恢复并校验 |

---

## 10. 扩缩容

| 场景 | 动作 | 注意 |
|---|---|---|
| 考试前扩容 | 提前 1 小时加 API 副本 | 副本需预热（迁移已就绪、Redis 缓存已预热） |
| 考试期间扩容 | 可加副本，连接池需复核 | PgBouncer 后端连接数可能成为新瓶颈 |
| 考试期间缩容 | 禁止 | 必须等场次结束 |
| PG 扩容 | 垂直扩容（加内存/加核）优先 | 水平扩展需先做分区与只读副本 |

**容量水位**：API 单实例饱和 QPS 约 800（基于压测基线）；`answer-submit` 场景下 1000 QPS 需 ≥ 2 实例。
