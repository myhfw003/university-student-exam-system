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
| 入口 | `http://172.16.90.253/`（学生端）、`http://172.16.90.253/admin/`（管理端）、`/portal/`（门户） |
| 宿主机的 80 | **被既有 nginx 占用** → 复用它做反向代理：配置在 `/etc/nginx/conf.d/exam.conf`，把请求转给 compose 的入口容器（宿主机的 8088） |

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
   入口容器的 8088 对宿主机开放，**宿主机原有的 nginx 反代到它**：
   ```nginx
   # /etc/nginx/conf.d/exam.conf
   map $http_upgrade $connection_upgrade { default upgrade; "" close; }
   server {
       listen 80;
       listen [::]:80;
       server_name 172.16.90.253;
       client_max_body_size 20m;
       location / {
           proxy_pass http://127.0.0.1:8088;
           proxy_http_version 1.1;
           proxy_set_header Host              $host;
           proxy_set_header X-Real-IP         $remote_addr;
           proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header Upgrade           $http_upgrade;
           proxy_set_header Connection        $connection_upgrade;
           proxy_read_timeout 600s;
       }
   }

   # AI 生成走 SSE：/api/ 这一段不能缓冲。
   # 少了这三行，事件会被外层 nginx 攒着一起到 ——
   # 界面上的「题目一道道出现」就没了，看着像接口坏了。
   location /api/ {
       proxy_pass http://127.0.0.1:8088;
       proxy_http_version 1.1;
       proxy_set_header Host              $host;
       proxy_set_header X-Real-IP         $remote_addr;
       proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_buffering off;
       proxy_cache off;
       proxy_read_timeout 300s;
       proxy_send_timeout 300s;
   }
   ```
   原有 nginx 里没有 `connection_upgrade` 这个 map，要在这个文件里自己定义
   （conf.d 是在 http 上下文里加载的 ✓）。原有的 `npm.soft.com` / `sprite.soft.com`
   两个 vhost 不受影响 ✓（它们按 server_name 匹配 ✓）。

   **两段反代都要关缓冲**：compose 栈自己的 nginx（`deploy/nginx/nginx.conf`）
   与宿主机这套 nginx 各是一段代理，只关一段不解决问题。
7. **种子管理员要用 `exam_owner` 连**（应用账号没有建角色的权限，种子会报 `aclcheck_error`）。
8. **备份**：宿主机装 pgbackrest 2.60 + stanza + `archive_command`，定时任务用 systemd
   （复用 `deploy/backup/entrypoint.sh` 的逻辑）。仓库里那个 backup 容器这时**不适用**，
   它操作的是容器里的 pgdata 卷。
   三处必须写对，否则备份静默失败：
   - `archive_command` 里要带 **`%p`**（要归档的 WAL 段号），且 `LC_ALL=C` 与
     `PATH=/usr/lib/postgresql/17/bin` 要**写在命令里**（它跑在 postgres 进程的境里，
     `pg_controldata` 不在默认 PATH，输出又跟着 locale 走）；
   - stanza 里**不要写 `pg1-host`**：写了 `localhost` 会被当成远端主机去走 SSH；
   - 定时任务的 `PGHOST` 要指本地 socket（`/var/run/postgresql`），否则脚本卡在
     「等待数据库就绪」的死循环里。
   备份指标写进 node-exporter 读的那个卷：`/var/lib/docker/volumes` 是 700，
   postgres 用户穿不过去，需要 `chmod o+x /var/lib/docker /var/lib/docker/volumes`
   （只放开穿越，目录内容仍是 root 的）。

## 3. 验证结果

| 项 | 结果 |
|---|---|
| API | `exam-api-1` healthy，`/health/live` 200 |
| 前端入口 | `http://172.16.90.253/`、`/admin/`、`/portal/` 均 200；管理端页面标题「知行测评 · 管理端」 |
| 刷新令牌 Cookie | `Set-Cookie` **不带 Secure**（纯 HTTP 部署，`JWT_REFRESH_COOKIE_SECURE=false`），浏览器才会保存 |
| 管理员登录 | 200，拿到令牌 |
| 系统设定的原始密码 | 已配置（`originalPasswordConfigured=true`） |
| 来源地址：直连 API + 伪造 `X-Forwarded-For` | 审计记的是**真实对端 172.16.90.253**，伪造的 `203.0.113.88` 被忽略 ✓ |
| 来源地址：经 nginx + 转发头 | 采信代理带来的地址 ✓ |
| 监控 | prometheus healthy；grafana / alertmanager / node-exporter 在跑 |
| 备份 | 首备成功（32.6MB / 1562 个文件）；WAL 连续归档在推 |

## 4. 已知限制

1. **入口是纯 HTTP**（按部署要求走 80 端口复用原有 nginx）：登录口令在局域网里是明文传输的。
   要加密就上 TLS——compose 的 TLS 覆盖层已经备好（`deploy/docker-compose.tls.yml` +
   `deploy/certs/`），并把原有 nginx 改成 301 到 https。
2. **刷新令牌的 Cookie 不带 Secure**（`JWT_REFRESH_COOKIE_SECURE=false`）：
   浏览器只在 HTTPS 下保存 Secure Cookie，纯 HTTP 下不关掉它，刷新令牌会丢，
   用户每 15 分钟被登出一次。改成 HTTPS 后要把它调回 true。
3. **仓库里的 backup 容器没有运行**（数据库在宿主机上，它不适用）；
   备份由宿主机的 `exam-backup.service` 做。
4. **目标机容器网络无 DNS**：那边不能再构建镜像，容器里也访问不了外网。
   业务功能不受影响（导入是纯本地解析），但 **AI 生成试题用不了**——
   模型服务在公网，容器既没 DNS 也没出网，调用会失败（报 502 / `27102`）。
   要在这台上用 AI，得先给容器网段出网（DNS + 路由），这是环境活，不是代码问题。
5. **受信任代理网段 = 容器自身网段**：宿主机自己与同网桥容器的流量在应用看来都落在受信任段内
   （Docker 的 NAT 会把来源改写成网桥网关），它们自带的 `X-Forwarded-For` 会被采信。
   **局域网里的真实机器不受影响**——直连 API 时来源就是它自己的地址（已实测）。
6. 应用日志里会有一条 `libgssapi_krb5.so.2` 缺失的告警：非致命（认证回落口令），可忽略。
7. **AI 生成走 SSE，两段反代都要 `proxy_buffering off`**：compose 栈的 nginx
   （仓库里已配好）与宿主机的这套 nginx（手工配，见 §2.6）。
   少配一段，事件就会被攒着一起到——接口看着是好的，但「一道道出现」的可见性没了。
