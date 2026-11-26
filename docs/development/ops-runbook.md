# 运维手册（Ops Runbook）

> 面向部署与值班人员。设计依据见 `docs/design/08-deployment-operations.md`。
> 本文中的每条处置步骤都应在演练中实际走通一遍。

---

## 1. 环境与入口

| 项 | 值 |
|---|---|
| 统一入口 | `http://<host>:8088`（nginx） |
| API | `http://<host>:8080/api/v1` |
| 健康检查 | `/health/live`（存活）、`/health/ready`（就绪） |
| 指标 | `/metrics`（Prometheus 格式，仅内网可达） |
| PostgreSQL | 容器 `postgres`（**不对宿主机发布端口**） |
| PgBouncer | 容器 `pgbouncer`（可选 profile，事务池） |
| Redis / MinIO | 容器 `redis` / `minio`（**不对宿主机发布端口**） |

宿主机只发布两个端口：API `8080`、nginx 入口 `8088`（可用 `.env` 的 `API_PORT` / `WEB_PORT` 改）。
若 `WEB_PORT` 被占用，容器会报 `Bind for 0.0.0.0:8088 failed: port is already allocated`，
改 `.env` 里的 `WEB_PORT` 即可，**不要去停别的项目的容器**。

```bash
# 常用命令
cd deploy
docker compose ps                       # 看容器状态
docker compose logs -f api              # 看 API 日志
docker compose logs -f --tail 200 worker
docker compose restart api               # 重启单个服务
docker compose up -d --build api        # 滚动更新 API
```

---

### 1.1 全站 HTTPS（生产）

默认 compose 栈的 nginx 只监听 80，**适合内网试跑**。生产必须启用 TLS：

```bash
# 1. 放证书（不进版本库）
mkdir -p deploy/certs
cp /path/to/fullchain.pem deploy/certs/fullchain.pem
cp /path/to/privkey.pem   deploy/certs/privkey.pem
chmod 600 deploy/certs/privkey.pem

# 2. 用 TLS 覆盖层启动
cd deploy
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
```

- `nginx.tls.conf`：80 端口只做 301 跳转，业务全部挂在 443，并下发 HSTS。
- 宿主机发布 443（`TLS_PORT` 可改）；8088 默认不再对外，必要时留作内部排障。
- 证书续期：到期前用新证书覆盖 `deploy/certs/` 再 `docker compose exec nginx nginx -s reload`，无需重启其余服务。

---

### 1.2 局域网部署：来源地址与限流

系统先部署在**局域网**里：每个考场机器各有地址，所以「每 IP 限流」就是
「每台机器限流」，不需要为一个考场调高阈值。

**来源地址只由连接本身决定。** `X-Forwarded-For` 是客户端能自带的头，
只有在请求来自**受信任的反向代理网段**时才会被采信：

- 默认受信任的是**容器自身网段**（compose 里 nginx 与 api 之间那段网桥）——
  应用启动时会识别自己所在的容器网段并打印出来（启动日志里的
  「受信任的反向代理网段」那一行）。
- 考场局域网里的机器**直连 API 端口（8080）**时，自带的 `X-Forwarded-For`
  一律不认，来源地址就是那台机器的局域网地址。
- 反向代理不在容器网段里时，用 `.env` 的 `FORWARDED_HEADERS_KNOWN_NETWORKS`
  指定（多个网段用逗号隔开），例如 `10.0.0.0/8,10.1.0.0/16`。
- **不要把考场局域网整段填进去**：那样局域网里的任何机器都能伪造来源地址，
  限流分桶与审计记录随之失真。
- 兜底方案信任的是**整段容器网桥**：同网桥上的其它容器（数据库、Redis 等）
  也在信任范围内。这是「容器网络只有自己人」的取舍——同网桥的容器一旦被攻破，
  本来就已经能直连数据库了。

```bash
# 看应用实际认了哪些代理网段
docker compose logs api | grep 受信任的反向代理网段

# 确认审计里记的是客户端的局域网地址（而不是代理或网桥的地址）
docker compose exec postgres psql -U exam_owner -d exam \
  -c "select ip_address, action, occurred_at from audit.audit_log order by occurred_at desc limit 10;"
```

**排查限流误伤**时先看这两处：审计里的 `ip_address` 是不是每台机器各不相同；
启动日志里的受信任网段是不是把考场网段包含进去了。

---

### 1.3 用宿主机 PostgreSQL 的部署形态

有时数据库不跑在容器里——目标机已经装了 PostgreSQL，或运维要求数据库由宿主机统一管。
这时**应用仍在容器里**，只有数据库换成宿主机上的：

1. 宿主机装 PostgreSQL 17（用 PGDG 源），并让它监听容器能到的地址：
   `postgresql.conf` 里 `listen_addresses = '*'`，
   `pg_hba.conf` 放行 docker 网段（`host all all 172.16.0.0/12 scram-sha-256`，
   这个段覆盖 docker0 与 compose 的各个网桥）。
2. `.env` 里把 `DB_HOST` 指到宿主机的 docker0 网关（`172.17.0.1`），
   **不是** compose 里的服务名 `postgres`——那个服务这时根本不启动。
3. 迁移与授权照旧，只是连接串换成宿主机地址：
   `docker compose run --rm --no-deps -e ConnectionStrings__Database="Host=172.17.0.1;..." migrate`；
   授权同理：`docker compose run --rm --no-deps db-grants sh -c "psql -h 172.17.0.1 ..."`。
4. 起栈时**不起 postgres / migrate / db-grants / backup**：
   `docker compose up -d --no-deps api worker web nginx redis minio`。
5. **备份要另做**：仓库里的 pgbackrest 备份服务是给容器里的 PG 用的
   （它直接操作容器的 pgdata 卷）。数据库在宿主机上时，要么在宿主机上装
   pgbackrest 并按《08-deployment-operations.md》§7 配一个 stanza，
   要么用宿主机自己的备份方案。**别以为容器里那个 backup 服务还在跑**——
   它没起来，备份就是没有。

---

## 2. 启动顺序与依赖

```
postgres（健康）→ migrate（一次性，成功退出）→ db-grants（一次性，成功退出）
   → api（依赖 db-grants + redis 健康）→ nginx（依赖 api 健康 + web）
```

`migrate` 与 `db-grants` 是**一次性任务**（`restart: "no"`），成功退出后 `docker compose ps` 显示 `Exited (0)` 属正常。

**迁移必须单独执行**：多实例同时迁移会抢锁。应用容器不自动迁移。

`migrate` 服务复用 worker 镜像，执行 `dotnet Exam.Worker.dll --migrate`，
运行时调用 `DbContext.Database.Migrate()`（不走 `dotnet ef` CLI，镜像里没有 SDK）。

**PgBouncer 可选**：默认直连 PG（`DB_HOST=postgres`、`DB_PORT=5432`）。1000 并发的生产环境建议
`docker compose --profile pgbouncer up -d`，并在 `.env` 里把 `DB_HOST` 改为 `pgbouncer`、
`DB_PORT` 改为 `6432`。

**中间件不发布宿主机端口**：数据库、Redis、MinIO 只在容器网络内可达。
需要直连排查时：`docker compose exec postgres psql -U exam_owner -d exam`。

---

## 3. 首次部署

```bash
cp deploy/.env.example deploy/.env
$EDITOR deploy/.env                       # 填入所有 change-me
bash scripts/generate-jwt-key.sh          # 生成 RSA 密钥，写入 deploy/secrets/
docker compose -f deploy/docker-compose.yml up -d --build
```

**必须设置的环境变量**（缺一即启动失败，`compose` 会用 `:?` 强制）：

`POSTGRES_OWNER_PASSWORD`、`POSTGRES_APP_PASSWORD`、`REDIS_PASSWORD`、`MINIO_ROOT_PASSWORD`、`JWT_REFRESH_TOKEN_PEPPER`

**强烈建议设置**：签名私钥。不设置时服务会启动，但每次重启都会**临时生成一把新密钥**，
已签发的令牌全部失效。

私钥注入三选一，优先级从高到低（见 `JwtKeyProvider`）：

| 方式 | 配置 | 适用场景 |
|---|---|---|
| 挂载文件 | `Jwt__SigningPrivateKeyPemFile=/run/secrets/jwt-private.pem` | 生产（K8s Secret、Docker secret） |
| Base64 单行 | `JWT_SIGNING_PRIVATE_KEY_PEM_BASE64=<单行 Base64>` | compose 部署（**推荐**） |
| 内联 PEM | `JWT_SIGNING_PRIVATE_KEY_PEM=<多行 PEM>` | 本地调试 |

**不要把多行 PEM 直接写进 `.env`**。换行会被转义成字面 `\n`，
`RSA.ImportFromPem` 会抛 `No supported key formats were found`。用 Base64 形式可完全避开。

Base64 形式由密钥脚本一并生成：

```bash
bash scripts/generate-jwt-key.sh
# 然后把 deploy/secrets/jwt-private.pem.b64 的内容填入 .env 的
# JWT_SIGNING_PRIVATE_KEY_PEM_BASE64=
```

挂载文件方式用可选覆盖文件：

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.secrets.yml up -d
```

`deploy/secrets/` 已在 `.gitignore` 中，绝不入库。目录权限 `0700`、密钥文件 `0644`
（容器内进程以 uid 1654 运行，需要能读挂载进来的文件；宿主机侧的访问控制由目录权限保证）。

### AI 生成试题（可选）

「内容生产 → AI 生成」要调真实大模型，**API Key 只从环境变量给**，不写进配置文件、不入库。

```bash
# deploy/.env 里加一行（.env 已在 .gitignore 中）
AI_GENERATION_API_KEY=<厂商的 API Key>
```

compose 会把它注入成应用配置：`AiGeneration__Providers__minimax__ApiKey`。

供应商、模型清单、Base URL 都在 `appsettings.json` 的 `AiGeneration:Providers` 下，
改模型清单不用改代码；换厂商就加一段同结构的配置。**没配 Key 时功能是通的**：
界面列出供应商并标「未配置 API Key」，生成请求返回 422（`27101`）。

要注意的两件事：

- **容器要能出网**。模型服务在公网，容器网络没有 DNS / 出网时（公测机就是这种形态），
  调用会超时或连不上，报 502（`27102`）。
- **Key 会出现在进程环境里**。不要把它打进镜像、不要写进 compose 文件，
  更不要贴进工单或聊天记录。

### 写入种子数据

```bash
docker compose -f deploy/docker-compose.yml run --rm \
  -e Seed__AdminUsername=admin \
  -e Seed__AdminPassword='换成强密码' \
  worker --seed
```

种子是幂等的，重复执行不会重复创建。初始管理员密码只在**首次创建**时打印到日志。

---

## 4. 常见故障处置

### 4.1 学生反馈「答案没保存」

**症状**：考生作答后刷新，答案丢失。

1. 查该次会话的服务端记录：
   ```sql
   SELECT question_id, client_seq, revision, server_received_at
   FROM app.answer_revision WHERE attempt_id = <id> ORDER BY server_received_at DESC;
   ```
2. 若 `app.answer_revision` 有记录但 `delivery.answer` 缺失 → **对账不一致**，执行第 5 节的重建。
3. 若 `app.answer_revision` 也没有记录 → 检查客户端是否触发了限流：
   ```bash
   docker compose logs api | grep -i "429"
   ```
   限流阈值为每用户每分钟 120 次（正常约 20 次/分钟）。若确为限流误伤，临时调高
   `RateLimiting:AnswersPerUserPerMinute` 并观察（改完即生效，不用重启）。
4. 若客户端处于离线状态，答案在浏览器 IndexedDB 队列中，恢复网络后会自动重放。
   考生报障时先问「当时网络是否断开」。

### 4.2 交卷接口大量 5xx

```bash
docker compose logs --tail 300 api | grep -E '"@l":"Error"'
docker compose exec pg-bouncer sh -c "psql -h postgres -U $POSTGRES_OWNER_USER -d exam -c 'select count(*) from pg_stat_activity;'"
```

排查顺序：连接池耗尽 → 慢查询（`log_min_duration_statement=500`）→ 数据库负载 → 临时扩容 API 副本。

**紧急降载**：`docker compose up -d --scale api=3` 增加副本（连接池与 PgBouncer 后端连接数需同步复核）。

### 4.3 Redis 不可用

**影响面**：令牌吊销名单退化为**进程内内存名单**（单实例有效，多实例之间不共享），
限流降级为放行。**作答链路完全不受影响**（P-07 设计原则）。

```bash
docker compose logs redis | tail -20
docker compose restart redis
```

处置：修好 Redis 后，内存名单会自然过期（TTL = 令牌剩余有效期）。若需要跨实例立即一致，
可重启 API 实例清空本地名单。

### 4.4 监考大屏不更新

```bash
docker compose logs api | grep -i "signalr"
```

- 检查 Redis Backplane 是否可用（Redis 挂了会退化为单实例推送）。
- 检查 `ProctoringBroadcaster` 是否在运行（每 2 秒一批）。
- 监考不影响作答，必要时可让教师暂时用「刷新」按钮。

### 4.5 切屏计数异常增多

多半是前端去重逻辑异常（500 ms 窗口合并失效）。临时处置：
把该场次的 `max_focus_loss` 调高，避免误伤考生，同时排查前端版本。

### 4.6 数据库连接耗尽

```bash
docker compose exec pg-bouncer sh -c \
  "psql -h postgres -U $POSTGRES_OWNER_USER -d exam -c \
   \"select state, count(*) from pg_stat_activity group by state;\""
```

PgBouncer 事务池的 `DEFAULT_POOL_SIZE` 默认 25。若长期打满，调大该值并同步提高
PostgreSQL 的 `max_connections`（当前 200）。

### 4.7 时钟偏移告警

```
clock_offset_ms > 50
```

**考试进行中出现此告警必须立即处理**——服务端计时是考试公平性的基础。

```bash
docker compose exec api date -u
timedatectl status       # 宿主机 NTP 状态
```

修正宿主机 NTP 后重启该 API 实例。

---

## 5. 答卷对账与重建

对账作业（`AnswerReconciliationJob`）在生产环境**每日执行**，考试期间每 10 分钟执行一次。
它比对客户端已确认的 `client_seq` 与服务端已接收的 `client_seq`。

发现差异时，以 `app.answer_revision` 为准重建当前值：

```sql
INSERT INTO delivery.answer (attempt_id, question_id, paper_item_id, payload, is_blank,
                              revision, client_seq, saved_at, created_at)
SELECT DISTINCT ON (attempt_id, question_id)
       attempt_id, question_id, NULL, payload, false,
       revision, client_seq, server_received_at, server_received_at
FROM app.answer_revision
ORDER BY attempt_id, question_id, revision DESC
ON CONFLICT (attempt_id, question_id) DO UPDATE
SET payload = EXCLUDED.payload,
    revision = EXCLUDED.revision,
    client_seq = EXCLUDED.client_seq,
    saved_at = EXCLUDED.saved_at;
```

**执行前务必先备份**：`pg_dump -Fc -d exam -f /backup/exam-$(date +%F).dump`。

差异非零必须开事故单，记录：涉及的场次、考生数、差异条数、处置动作。

---

## 6. 备份与恢复

| 项 | 方案 |
|---|---|
| 全量 | 每日 pgBackRest 全量 |
| 增量 | WAL 归档连续，RPO ≤ 5 分钟 |
| 保留 | 日备 14 天，周备 8 周，月备 12 个月 |
| 演练 | 每月恢复到临时实例并校验 |

```bash
# 手工备份
docker compose exec postgres pg_dump -U $POSTGRES_OWNER_USER -Fc exam > /backup/exam-$(date +%F).dump

# 恢复到新库
docker compose exec -T postgres pg_restore -U $POSTGRES_OWNER_USER -d exam_restore --clean --if-exists < /backup/exam-2026-11-12.dump
```

**恢复目标 RTO ≤ 30 分钟。** 恢复后必须校验：表行数、关键外键关系、以及一次答卷对账。

---

## 7. 发布与回滚

```bash
# 发布
docker compose build api worker
docker compose up -d api worker
# 观察 5 分钟健康检查与错误率，再切流量

# 回滚（镜像 tag 回退）
docker compose up -d --force-recreate api
```

**数据库迁移不可自动回滚**。破坏性变更（删列、改类型）必须分两步发布：
先发布兼容新旧 schema 的代码 → 再执行破坏性迁移。

**考试进行中禁止重启承载该场次的 API 实例。** 发布窗口必须避开考试时段；
必须重叠时，用蓝绿部署保留旧实例承载现有场次。

---

## 8. 例行任务

| 任务 | 频率 | 责任方 |
|---|---|---|
| 答卷对账 | 每日 + 考试期间每 10 分钟 | 自动（Worker） |
| 统计重算 | 每日 | 自动（Worker） |
| 分区预建与过期分区 detach | 每日 | 自动（Worker） |
| 过期令牌清理 | 每日 | 自动（Worker） |
| 备份 | 每日 + WAL 连续 | 自动 |
| 恢复演练 | 每月 | 人工 |
| 依赖漏洞扫描 | 每周 | CI |
| 监控看板与告警复核 | 每月 | 人工 |

---

## 9. 告警清单与首响

下表与 `deploy/monitoring/prometheus-rules.yml` 一一对应；规则改了，这里也要改。

| 告警 | 规则名 | 级别 | 首响时限 | 处置入口 |
|---|---|---|---|---|
| 答卷丢失疑似（对账差异 > 0） | `ExamAnswerLostSuspected` | P1 | 立即 | §4.1 + §5 |
| 备份失败 / 备份过期 | `ExamBackupFailed` / `ExamBackupStale` | P1 | 立即 | §6 + 重跑备份 |
| 答卷保存错误率 > 1% | `ExamAnswerSaveErrorRateHigh` | P1 | 15 分钟 | §4.2 |
| 活跃会话数骤降 > 30% | `ExamActiveSessionsDropped` | P1 | 15 分钟 | §4.2 + 网关 |
| 数据库连接耗尽 | `ExamDatabaseConnectionsExhausted` | P1 | 15 分钟 | §4.6 |
| Redis 不可用 | `ExamRedisUnavailable` | P1 | 30 分钟 | §4.3 |
| HTTP 5xx 比例 > 0.1% | `ExamHttpErrorRateHigh` | P1 | 30 分钟 | §4.2 |
| 答卷保存 p95 > 500 ms | `ExamAnswerSaveP95High` | P2 | 1 小时 | §4.2 |
| 时钟偏移 > 50 ms | `ExamClockOffsetHigh` | P2 | 1 小时 | §4.7（考试中升级为 P1） |
| Outbox 积压 > 1000 | `ExamOutboxBacklog` | P2 | 1 小时 | 检查 Worker 状态 |
| 后台作业失败 / 变慢 | `ExamBackgroundJobFailed` / `ExamBackgroundJobSlow` | P2 | 1 小时 | 检查 Worker 日志 |
| Redis 命令 p95 > 50 ms | `ExamRedisCommandSlow` | P2 | 1 小时 | §4.3 |
| 切屏事件激增 | `ExamFocusEventsSpiking` | P2 | 1 小时 | §4.5 |
| 磁盘使用 > 80% | `ExamDiskUsageHigh` | P2 | 4 小时 | 清理 / 扩容 |

## 10. 值班手册

### 10.1 分级与首响

| 级别 | 含义 | 首响 | 处置目标 |
|---|---|---|---|
| P1 | 影响正在进行的考试或可能丢答 | 立即（5 分钟内确认） | 先止损，再定位 |
| P2 | 影响容量或体验，考试仍能进行 | 1 小时内 | 定位并安排修复窗口 |
| P3 | 观察项 | 下一个工作日 | 记入待办 |

**首响时限是「确认」不是「修好」**：5 分钟内至少回一句「已知悉，正在查」。

### 10.2 值班安排

- 考试日：开考前 30 分钟进入值班，监考教师与技术值班同时在线，考试结束后 30 分钟退出。
- 平日：工作日 9:00–18:00 有人值班，夜间只保留 P1 呼叫。
- 考试日 P1 一律电话直呼，不走工单流转。

### 10.3 处置原则

1. **先止损，后定位**。答卷丢失疑似、数据库连接耗尽这两条先保数据与可用性，再查根因。
2. **考试进行中，P1 优先于一切 P2**。P2 可以先记下来，等考完再处理。
3. **不要在考试进行中重启 Worker**。Worker 停了 Outbox 会积压，统计与对账全部推后；
   确实要停，先确认没有正在进行的场次。
4. **恢复后要确认告警自己消警**。指标回到正常值，告警要在一段时间后自动 resolved；
   消不掉的告警说明指标口径有问题，别手工关单了事。
5. **每次处置都要留痕**：告警名、开始时间、处置动作、恢复时间、影响范围。

### 10.4 升级路径

值班人 → 技术负责人（15 分钟未定位）→ 教研/考试负责人（涉及场次暂停或数据补录）。
涉及考生成绩、申诉、成绩发布的任何决定，必须由考试负责人拍板，技术值班只提供事实。

### 10.5 新增权限码后的运维动作

权限码是**角色**的集合，不是给到人身上的。新增权限码之后必须做两件事，
否则**系统管理员自己都用不了新功能**：

1. **重跑种子作业**（`dotnet run --project src/Exam.Worker -- --seed`）：
   种子只补齐缺失的角色权限行，不会删掉已有的。新权限码不在旧部署的角色里，
   种子不重跑就没有人拥有它。
2. **等权限缓存过期或清掉缓存**：权限按用户缓存在进程内与 Redis 里（默认 10 分钟），
   直接改库不会让缓存失效。缓存没过期之前，管理员仍然拿不到新权限。
   （管理端改角色会主动失效缓存；种子直写数据库不会。）

端到端巡检会当场抓到这件事：管理员令牌调用新接口得到 403。

### 10.6 值班交接

交接时说清楚四件事：当前在跑的考试场次、最近一次故障与是否闭环、已知未修复的问题、
下一次计划中的变更（发布、扩容、数据库迁移）。考试日交接必须当面或电话，不留文字。

## 11. 告警演练

演练的目的很具体：**确认人为制造的异常能触发预期告警**。
没演练过的告警，等于没有告警——规则写对了不代表表达式里的指标真的存在、真的有值。

### 11.1 规则级演练（每次改动告警规则后必做）

在 `deploy/monitoring` 目录下：

```bash
# 造出越界的指标序列，断言告警按预期 firing；一切正常时断言不 firing。
docker run --rm --entrypoint /bin/promtool -v "$PWD:/w" -w /w \
  prom/prometheus:v2.54.1 test rules prometheus-rules.test.yml

# 规则引用的指标必须真的被应用导出，对不上即失败。
python3 ../../scripts/check-metric-names.py
```

CI 里跑的就是这两条。

### 11.2 环境级演练（每季度一次，考试前必做）

启用监控栈：`docker compose --profile monitoring up -d`。
在 Grafana（默认 3000 端口）与 Alertmanager（9093 端口，只在容器网络内可达）里确认告警真的 firing。

Redis 那一档已经脚本化了（`deploy/monitoring/drill-alerts.sh`）：停 Redis → 等
`ExamRedisUnavailable` firing → 恢复 Redis → 等它自己消警。脚本以非零码退出即演练失败。

```bash
cd deploy/monitoring
./drill-alerts.sh redis        # 完整演练（停 Redis、验 firing、恢复、验消警）
./drill-alerts.sh redis-check  # 只看当前有哪些告警在 firing
```

| 告警 | 怎么造 | 怎么确认 |
|---|---|---|
| Redis 不可用 | `docker compose stop redis` | 一分钟后 `redis_up` 为 0，Alertmanager 收到 firing；`docker compose start redis` 后自动 resolved |
| 数据库连接耗尽 | 把 `max_connections` 调小到当前连接数附近，重启 PG | `db_pool_available_connections` 低于上限 10%，告警 firing |
| 答卷保存错误率 | 对已交卷的会话继续调用保存答案接口 | `attempt_answers_saved_total{result="rejected"}` 上升，错误率超过 1% 后 firing |
| 活跃会话数骤降 | 开一场考试，等考生进场后停掉 API 容器 | `attempt_active_sessions` 掉下去（心跳断了），告警 firing；注意恢复后要确认序列被撤掉 |
| Outbox 积压 | `docker compose stop worker` 后产生领域事件 | `outbox_pending_messages` 持续上涨，超过 1000 后 firing |
| 后台作业失败 | 停 Worker 或破坏它依赖的表 | `background_job_failures_total` 上涨，告警 firing |
| 答卷丢失疑似 | 用 owner 账号手工删掉一条已交卷的 answer 行 | 对账作业发现差异，`answer_reconciliation_findings_total` 上涨，P1 firing |
| 时钟偏移 | 改宿主机时间或容器时区 | `clock_offset_ms` 超过 50 后 firing |
| HTTP 5xx | 制造一个必然抛异常的请求 | `http_requests_total{status="500"}` 上涨，5xx 比例超过 0.1% 后 firing |
| 切屏事件激增 | 脚本循环调用焦点事件上报接口 | `attempt_focus_events_total` 速率超过 50/秒后 firing |
| 备份失败 | 改坏 pgbackrest 配置后跑一次备份 | 备份任务写出 `pgbackup_last_run_success 0`，告警 firing |
| 磁盘使用 > 80% | 在宿主机上造一个大文件 | `node_filesystem_avail_bytes / node_filesystem_size_bytes` 低于 0.2 后 firing |

**演练纪律**：造完异常必须等它自己恢复（或者手工造恢复），确认告警能自动 resolved；
只看到 firing 不算演练完成。

### 11.3 演练记录

每次演练记一行：日期、演练人、告警名、造异常的方式、是否 firing、消警耗时、发现的问题。
发现问题的当场修，别攒着。
