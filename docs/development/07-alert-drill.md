# 告警演练记录（T-P9-06）

对应《08-deployment-operations.md》§5.4 与《ops-runbook.md》§11。
**没演练过的告警等于没有告警**——规则写对了不代表表达式里的指标真的存在、真的有值。
每个季度真跑一遍，把结果记在这份文档里。

## 两层演练

| 层次 | 做什么 | 频率 |
|---|---|---|
| 规则级 | promtool 单元测试：造出越界的指标序列，断言告警按预期 firing | 改规则就必做（CI 强制） |
| 环境级 | 真实环境造异常，看 Prometheus → Alertmanager → Grafana 全链路 | 每季度一次，考试前必做 |

规则级演练：

```bash
cd deploy/monitoring
docker run --rm --entrypoint /bin/promtool -v "$PWD:/w" -w /w \
  prom/prometheus:v2.54.1 test rules prometheus-rules.test.yml
python3 ../../scripts/check-metric-names.py
```

环境级演练步骤与逐条「怎么造异常」见《ops-runbook.md》§11.2；
Redis 那一档已脚本化：`deploy/monitoring/drill-alerts.sh redis`。

## 2026-11-15 演练记录（实测）

环境：本地 compose 栈（API + Worker + PostgreSQL 17 + Redis + Prometheus 2.54 +
Alertmanager 0.27 + Grafana 11.2 + node-exporter 1.8.2），指标与规则均为本轮新实现。

| 层次 | 覆盖 | 结果 |
|---|---|---|
| 规则级 | 16 条规则、32 组正反用例 | **全部 SUCCESS** |
| 指标名核对 | 规则与看板引用的 23 个指标名 vs 应用导出的 19 个 | **通过**（外部来源 5 个：node_exporter 与备份 textfile） |
| 环境级 | Redis 不可用 | **firing → 恢复后自动 resolved** ✓ |
| 环境级 | 活跃会话骤降（心跳中断） | **pending 5 分钟后 firing**，恢复心跳后消警 ✓ |
| 环境级 | 备份失败（指标缺失分支） | **firing** ✓（真阳性：本沙箱构建不出带 pgBackRest 的镜像，备份任务确实没跑） |

### 演练中发现并修掉的问题

演练不是走过场，它当场抓出了四个真问题：

| 问题 | 现象 | 修法 |
|---|---|---|
| Worker 起不来 | `Unable to resolve service for type 'ICurrentUser'`——审计拦截器要读当前调用者，而 Worker 不是 HTTP 进程 | Worker 注册 `BackgroundCurrentUser`（后台作业不记操作人） |
| Worker 起来就死 | `HttpListener.AddPrefix` 要求前缀以 `/` 结尾，指标端点写的是 `/metrics` → 异常 → 整个 Worker 跟着停 | 前缀挂根路径，路径在处理请求时判断；端点起不来只记警告不拖垮 Worker |
| Worker 的对账作业跑不动 | `Unable to resolve service for type 'IRequestContext'`——审计记录器要读请求上下文 | Worker 注册 `BackgroundRequestContext`（IP 与 UA 留空） |
| 活跃会话一直是 0 | PostgreSQL 的 `count()` 返回 bigint，代码按 int32 读 → 类型转换异常被吞进采样循环 | 按 bigint 读再做范围检查；采样结果变化时记一行日志，采样器有没有在跑一眼可见 |

### 演练记录

| 告警 | 造异常的方式 | 是否 firing | 消警耗时 | 发现的问题 |
|---|---|---|---|---|
| ExamRedisUnavailable | `docker compose stop redis` | ✓（14:00 起，110s 后 firing） | 30s（恢复 Redis 后自动 resolved） | 无 |
| ExamActiveSessionsDropped | 把 `delivery.attempt.last_heartbeat_at` 老化 10 分钟（模拟考生掉线） | ✓（14:00:08 pending → 14:05:08 firing，hold 满 5 分钟） | 恢复心跳后约 15s 自动 resolved | 见上表第四行 |
| ExamBackupFailed | 备份任务没跑（沙箱构建不出 pgBackRest 镜像） | ✓ | — | 真阳性：备份任务确实没跑 |

时间线（ExamActiveSessionsDropped）：心跳老化 → 采样器下一轮把 `attempt_active_sessions` 降到 0
（心跳不新鲜）→ Prometheus 抓到 0 → 规则条件成立（0 < 0.7 × 15 分钟峰值 1）→ pending
→ hold 满 5 分钟 → firing → Alertmanager 按 severity=P1 路由到 oncall-p1 → 恢复心跳 →
采样器下一轮把值报回 1 → 条件不再成立 → 自动 resolved。
**整条链路（数据库 → 采样器 → 指标端口 → Prometheus → 规则 → Alertmanager 路由）实测走通。**

### 环境级演练的造异常手法

| 告警 | 怎么造 |
|---|---|
| Redis 不可用 | `docker compose stop redis` |
| 活跃会话骤降 | `update delivery.attempt set last_heartbeat_at = now() - interval '10 minutes'`（心跳一停，采样器就看不到这个考生） |
| 数据库连接耗尽 | 把 `max_connections` 调小到当前连接数附近，重启 PG |
| 答卷保存错误率 | 对已交卷的会话继续调用保存答案接口（整批被拒） |
| Outbox 积压 | `docker compose stop worker` 后产生领域事件 |
| 后台作业失败 | 停 Worker 或破坏它依赖的表 |
| 答卷丢失疑似 | 用 owner 账号删掉一条已交卷的 answer 行 |
| 时钟偏移 | 改宿主机时间或容器时区 |
| HTTP 5xx | 打一个必然抛异常的请求 |
| 切屏事件激增 | 脚本循环调用焦点事件上报接口 |
| 备份失败 | 改坏 pgbackrest 配置后跑一次备份 |
| 磁盘使用 > 80% | 在宿主机上造一个大文件 |

> 造完异常必须等它自己恢复，确认告警能自动 resolved；只看到 firing 不算演练完成。
