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
   `RateLimiting:GlobalPerMinute` 并观察。
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

| 告警 | 级别 | 首响时限 | 处置入口 |
|---|---|---|---|
| 答卷丢失疑似（对账差异 > 0） | P1 | 立即 | §4.1 + §5 |
| 答卷保存错误率 > 1% | P1 | 15 分钟 | §4.2 |
| 活跃会话数骤降 > 30% | P1 | 15 分钟 | §4.2 + 网关 |
| 数据库连接耗尽 | P1 | 15 分钟 | §4.6 |
| Redis 不可用 | P1 | 30 分钟 | §4.3 |
| 可用会话 p95 > 500 ms | P2 | 1 小时 | §4.2 |
| 时钟偏移 > 50 ms | P2 | 1 小时 | §4.7（考试中升级为 P1） |
| Outbox 积压 > 1000 | P2 | 1 小时 | 检查 Worker 状态 |
| 磁盘使用 > 80% | P2 | 4 小时 | 清理 / 扩容 |
| 备份失败 | P1 | 立即 | 重跑并排查 |
