# 公测部署记录：172.16.90.253

**日期**：2026-11-25　**目的**：公测（局域网）　**代码版本**：master

## 1. 目标机与部署形态

| 项 | 值 |
|---|---|
| 主机 | 172.16.90.253，Debian 12（内核 6.1），8 核 / 8G / 446G 空闲 |
| 容器运行时 | Docker 29.10.0 + Compose v5.8.0（机器原无 Docker，装自清华镜像源的 docker-ce） |
| 数据库 | **宿主机 PostgreSQL 17.12**（按要求不用容器），数据目录 `/var/lib/postgresql/17/main` |
| 应用 | 容器：`api` / `worker` / `web` / `nginx` / `redis` / `minio` |
| 监控 | 容器（monitoring profile）：`prometheus` / `alertmanager` / `grafana` / `node-exporter` |
| 入口 | `https://172.16.90.253/`（自签证书）；`http://<host>:8088/` 301 跳 HTTPS；API 直连 8080 |
| 宿主机的 80 | **被既有 nginx 占用**（另有 pm2 起的 node 服务），本系统不碰 |

数据库在宿主机上时，容器经 **docker0 网关 `172.17.0.1`** 连它；
PG 侧 `listen_addresses='*'`，`pg_hba.conf` 放行 `172.16.0.0/12`（覆盖 docker0 与 compose 网段）。
角色：`exam_owner`（迁移、种子、授权用）、`exam_app`（应用运行时用，最小权限）。

## 2. 部署步骤（按实际执行顺序）

1. **装 Docker**：清华镜像源的 `docker-ce` + `docker-compose-plugin`。
   `/etc/docker/daemon.json` 配 `registry-mirrors`（docker.m.daocloud.io、docker.1ms.run）。
   **必须在 dockerd 启动前写好**——apt 装完服务自己就起来了，写晚了不重启不生效。
2. **镜像在开发机构建后传过去**：目标机的**容器网络没有 DNS**（容器里 `nslookup` 一律
   「no servers could be reached」，宿主机却什么都通），构建一定失败。
   开发机用 host 网络的 buildx 构建器：`docker buildx build --builder hostnet --load`，
   再 `docker save | gzip | ssh 'gunzip | docker load'`。
   注意 `backend/Dockerfile` 的最后一段是 worker 段，打 API 镜像要 `--target runtime`。
3. 源码放 `/opt/exam`；`deploy/.env` 现填（口令、端口、限流阈值）；JWT 私钥在目标机本地生成
   （`scripts/generate-jwt-key.sh`）。
4. **装宿主机 PostgreSQL 17**：南大镜像源的 PGDG（Debian 12 自带只有 15；清华的 PGDG 路径 404）。
   配置监听与 pg_hba，建 `exam_owner` / `exam_app` 与 `exam` 库。
5. **迁移**：`docker compose run --rm --no-deps -e ConnectionStrings__Database="Host=172.17.0.1;..." migrate`。
   **授权**：把 `02-grant-app-role.sql` 与口令变量一起喂给**宿主机**的 psql——
   经容器多层引号传 `-v app_password=…` 会被吞掉，脚本第一行就 abort，后面的授权一条没执行
   （表现为 API 报「对模式 delivery 的权限不足」）。
6. **起栈**（**不起 postgres / migrate / db-grants / backup**）：
   `docker compose up -d --no-deps api worker web nginx redis minio`。
   顺序有讲究：**先 api 再 nginx**——nginx 的上游是 api 的服务名，api 不在 DNS 里它起不来。
7. **种子管理员要用 `exam_owner` 连**（应用账号没有建角色的权限，种子会报 `aclcheck_error`）。
8. **备份**：宿主机装 pgbackrest 2.60 + stanza + `archive_command`，定时任务用 systemd
   （复用 `deploy/backup/entrypoint.sh` 的逻辑）。仓库里那个 backup 容器这时**不适用**，
   它操作的是容器里的 pgdata 卷。

## 3. 验证结果

| 项 | 结果 |
|---|---|
| API | `exam-api-1` healthy，`/health/live` 200 |
| 前端入口 | `https://172.16.90.253/` 与 `/admin/` 均 200；HTTP 8088 → 301 → HTTPS |
| 管理员登录 | 200，拿到令牌 |
| 系统设定的原始密码 | 已配置（`originalPasswordConfigured=true`） |
| 来源地址：直连 API + 伪造 `X-Forwarded-For` | 审计记的是**真实对端 172.16.90.253**，伪造的 `203.0.113.88` 被忽略 ✓ |
| 来源地址：经 nginx + 转发头 | 采信代理带来的地址 ✓ |
| 监控 | prometheus healthy；grafana / alertmanager / node-exporter 在跑 |
| 备份 | 首备成功（32.6MB / 1562 个文件）；WAL 连续归档在推 |

## 4. 已知限制

1. **TLS 是自签证书**（SAN 含 172.16.90.253）：浏览器会告警。
   正式公测应换成有 CA 签发的证书或域名证书。
2. **宿主机 80 被既有 nginx 占用**：本系统入口在 443 / 8088。
   要让用户只记一个地址，得在那套既有 nginx 上加一条反代。
3. **仓库里的 backup 容器没有运行**（数据库在宿主机上，它不适用）；
   备份由宿主机的 `exam-backup.service` 做。
4. **目标机容器网络无 DNS**：那边不能再构建镜像，容器里也访问不了外网（应用本身不需要）。
5. **受信任代理网段 = 容器自身网段**：宿主机自己与同网桥容器的流量在应用看来都落在受信任段内
   （Docker 的 NAT 会把来源改写成网桥网关），它们自带的 `X-Forwarded-For` 会被采信。
   **局域网里的真实机器不受影响**——直连 API 时来源就是它自己的地址（已实测）。
6. 应用日志里会有一条 `libgssapi_krb5.so.2` 缺失的告警：非致命（认证回落口令），可忽略。
