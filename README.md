# 大学生考试系统

以大学生为主体、呈现为通用生产级考试系统的在线考试平台。

基于标签的题库与自动组卷、考试与练习双模式、服务端权威计时、答案可靠持久化、
切屏防作弊与实时监考、单场 1000 人同时作答。

---

## 目录结构

```
.
├── backend/                  .NET 10 整洁架构后端
│   ├── src/
│   │   ├── Exam.Domain/          领域层（零 NuGet 依赖，由架构测试强制）
│   │   ├── Exam.Application/      应用层（MediatR CQRS + 管道行为）
│   │   ├── Exam.Infrastructure/   基础设施层（EF Core / Redis / MinIO / JWT）
│   │   ├── Exam.Web/             Web 宿主（Controllers + SignalR + 健康检查）
│   │   └── Exam.Worker/           后台作业宿主（种子、答卷对账、统计重算）
│   └── tests/                    领域 / 应用 / 架构 / 集成 / 功能测试
├── frontend/                 React 19 + Vite + Tailwind v4
│   ├── shared/                   @exam/shared：API 客户端、设计令牌、通用组件
│   ├── student/                  学生端 SPA
│   └── admin/                    管理端 SPA
├── deploy/                   Docker 编排、nginx、数据库初始化与授权脚本
├── docs/
│   ├── design/                   设计文档集（9 份）
│   ├── development/              开发文档集（3 份）
│   └── ui-design/                交互原型（只读参考）
├── scripts/                  运维脚本（密钥扫描等）
├── .workflow/frontend.yml     Gitee Go 流水线（前端门禁）
└── .github/workflows/ci.yml   GitHub Actions 流水线（镜像仓库用）
```

---

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | .NET 10、MediatR 12（Apache-2.0）、EF Core 10、PostgreSQL 17、PgBouncer、Redis 7、SignalR |
| 前端 | React 19、TypeScript、Vite、Tailwind CSS v4、Zustand、TanStack Query、Dexie |
| 测试 | xUnit、Shouldly、NSubstitute、Testcontainers、NetArchTest、Vitest、Playwright |
| 可观测 | Serilog、OpenTelemetry、prometheus-net、Prometheus、Grafana |

依赖授权红线：只允许 Apache-2.0 / MIT / BSD / PostgreSQL License 商用友好的包。
MediatR 锁定 12.x（13+ 转商业授权）。

---

## 快速开始

### 1. 全栈（Docker）

```bash
cp deploy/.env.example deploy/.env
$EDITOR deploy/.env          # 填入真实密钥
bash scripts/generate-jwt-key.sh   # 生成 RSA 私钥（产出 deploy/secrets/ 下的密钥文件与 Base64 单行文件）

bash deploy/build.sh          # 构建镜像（容器内 DNS 不可用时用 BUILD_NETWORK=host）
docker compose -f deploy/docker-compose.yml up -d
```

> **构建环境注意**：部分宿主上 Docker 的 BuildKit 无法解析外网域名，导致 NuGet 还原报错（NU1301）。
> 绕过方式：`BUILD_LEGACY=1 BUILD_NETWORK=host bash deploy/build.sh`（用经典构建器走宿主 DNS）。
> 精确诊断与三种处置方案见 `docs/design/08-deployment-operations.md` §4.0。

启动顺序：`postgres → migrate（一次性）→ db-grants（一次性，收回追加式表的写权限）→ api / worker → nginx`。

| 服务 | 地址 |
|---|---|
| nginx（统一入口） | `http://localhost:8088`（端口在 `.env` 的 `WEB_PORT` 中改） |
| API | `http://localhost:8080/api/v1` |
| 健康检查 | `/health/live`、`/health/ready` |
| Prometheus 指标 | `/metrics` |

### 2. 本地开发

```bash
# 数据库（独立 PG 17 容器）
docker run -d --name exam-pg-local -p 55432:5432 \
  -e POSTGRES_DB=exam -e POSTGRES_USER=exam_owner -e POSTGRES_PASSWORD=exam_owner_password \
  postgres:17

# 后端
cd backend
export ConnectionStrings__Migration="Host=localhost;Port=55432;Database=exam;Username=exam_owner;Password=exam_owner_password"
export ConnectionStrings__Database="$ConnectionStrings__Migration"
dotnet tool install --global dotnet-ef --version 10.0.11
dotnet ef database update -p src/Exam.Infrastructure -s src/Exam.Web
Seed__AdminUsername=admin Seed__AdminPassword='Admin@12345' \
  dotnet run --project src/Exam.Worker -- --seed
dotnet run --project src/Exam.Web

# 前端
cd frontend && pnpm install && pnpm dev
```

---

## 常用命令

```bash
# 后端
dotnet build backend/ExamManager.slnx          # 警告视为错误
dotnet test backend/ExamManager.slnx           # 全量测试
dotnet test backend/ExamManager.slnx --filter "FullyQualifiedName~Domain"   # 领域层

# 数据库
dotnet ef migrations add <Name> -p src/Exam.Infrastructure -s src/Exam.Web -o Persistence/Migrations
dotnet ef database update -p src/Exam.Infrastructure -s src/Exam.Web

# 前端
cd frontend && pnpm typecheck && pnpm lint && pnpm test && pnpm build

# 安全
bash scripts/scan-secrets.sh
dotnet list backend/ExamManager.slnx package --vulnerable --include-transitive

# 提交（仓库同时托管在 Gitee 与 GitHub，两个远端一起推）
bash scripts/push-all.sh          # 或 git pushall，推当前分支
```

---

## 关键设计约束

这些约束由代码与测试共同保证，修改前请先读 `docs/design/`。

| 约束 | 保障方式 |
|---|---|
| 领域层零外部依赖 | `Exam.ArchitectureTests` 断言程序集引用与特性注解 |
| 应用层不依赖 EF Core | 同上（仓储接口返回 `IQueryable<T>`，由基础设施实现异步物化） |
| 全局软删除 | `ISoftDeletable` + EF 全局查询过滤器，集成测试验证 |
| 乐观并发 | PostgreSQL `xmin` 作为并发令牌，冲突返回 409 |
| 追加式数据不可篡改 | `app` / `audit` schema 在数据库层回收 UPDATE / DELETE 权限 |
| 服务端时钟权威 | 考试时长只由服务端判定，客户端时钟仅作显示 |
| 答案可靠持久化 | `clientSeq` 单调序列 + 唯一索引去重 + 服务端对账作业 |
| 防作弊能力边界 | 「可审计 + 可威慑」，不宣称绝对防护，对外文案须明示 |

---

## 文档

- 设计文档：[`docs/design/00-overview.md`](docs/design/00-overview.md) 起，共 9 份
- 开发文档：[`docs/development/01-task-breakdown.md`](docs/development/01-task-breakdown.md) 起，共 3 份
- 交互原型：`docs/ui-design/`（只读）

---

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 基础设施（骨架、编排、认证、RBAC、可观测性、CI） | ✅ 完成 |
| P1 | 身份与标签基础 | 未开始 |
| P2 | 题库与题目 | 未开始 |
| P3 | 组卷 | 未开始 |
| P4 | 考试组织与作答 | 未开始 |
| P5 | 防作弊与监考 | 未开始 |
| P6 | 评分与阅卷 | 未开始 |
| P7 | 学习与分析 | 未开始 |
| P8 | 练习模式 | 未开始 |
| P9 | 质量与上线 | 未开始 |
