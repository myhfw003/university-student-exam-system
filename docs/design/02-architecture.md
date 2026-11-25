# 02 · 系统架构设计

> 关联：`00-overview.md`（决策摘要）、`01-requirements.md`（需求规格）

---

## 1. 架构目标与约束

### 1.1 目标

1. **领域模型独立且可测**：考试业务的复杂度集中在"组卷规则、判分策略、防作弊处置、计时权威"四处，领域层必须能脱离数据库与 Web 框架做单元测试。
2. **1000 人同场考试的可靠作答**：作答链路（保存、交卷）必须在峰值 1000 RPS 下零丢答。
3. **考试公平性可审计**：任何一次改分、强制交卷、成绩发布都有不可篡改的痕迹。
4. **前后端可独立演进**：领域模型不被 API 契约绑架，前端不被后端实现细节绑架。
5. **可水平扩展**：API 实例无状态，扩容只需加实例。

### 1.2 硬约束

| 约束 | 来源 |
|---|---|
| .NET 10 + DDD + 整洁架构 + EF Core + PostgreSQL + RBAC | `claude.md` |
| React + Tailwind CSS | `claude.md` |
| 全局软删除 | `claude.md` |
| 界面按 `docs/ui-design` 原型实现 | `claude.md` |
| 单场考试 1000 人同时作答 | `claude.md` |

---

## 2. 架构原则

以下原则是本项目的"宪法"。任何实现与之冲突时，先修订原则本身并记录理由，不在实现里绕开。

### P-01 依赖方向严格单向

```
Web  ──►  Application  ──►  Domain
 │            ▲
 └────────────┘
              │
        Infrastructure 实现 Application 定义的接口
```

- `Exam.Domain` 只依赖 .NET BCL，**不引用任何 NuGet 包**（连 EF Core 的注解都不允许）。
- `Exam.Application` 只依赖 `Exam.Domain`，可依赖 MediatR / FluentValidation（管道行为），不依赖 EF Core。
- `Exam.Infrastructure` 实现 `Exam.Application` 声明的抽象（`IAppDbContext`、仓储、缓存、时钟、文件存储、事件分发）。
- `Exam.Web` 只做协议适配（HTTP、SignalR、认证），业务判断一律下沉。
- 由**架构测试**强制：扫描项目引用与 `using`，违反即测试失败。

### P-02 领域模型用领域语言命名

聚合根、实体、值对象使用 `00-overview.md` 第 3 节的统一语言。禁止 `Manager`、`Helper`、`Util`、`DataService`、`Model` 等通用命名；禁止用 `Question` 指代 `PaperItem`，用 `Exam` 指代 `ExamSession`。

### P-03 行为在领域层，数据在应用层

判定逻辑（能否组卷、能否提交、切屏是否超限、分数怎么算）必须落在领域对象的方法里，应用层只负责编排。判分策略实现为领域层的策略类（`IScoringStrategy`），不是应用层的 switch。

### P-04 单一事实来源

同一事实只存一处。分值只存 `paper_item.score`；发布状态只存 `status`；用户归属只存 `iam.user_tag` 关联。冗余列（如 `question.difficulty_tag_id`）必须由领域行为同步写入，并有对应的领域测试锁定。

### P-05 考试公平性数据追加式（append-only）

`answer_revision`、`focus_event`、`audit_log`、`grade_revision` 四类表**只允许 INSERT**。状态变化通过新增记录表达，不用 UPDATE 覆盖。数据库层对该 schema 的应用账号 `REVOKE UPDATE, DELETE`。

### P-06 服务端时钟权威

任何与考试公平性相关的判定，一律以服务端时间为准。客户端时间仅作为审计字段（`client_sent_at`）记录，不参与判定。服务端多实例部署时，各实例须与 NTP 同步，偏移超阈值时告警。

### P-07 作答链路不依赖 Redis 强一致

Redis 用于缓存、限流、黑名单、实时推送，**不作答数据的唯一存储**。Redis 不可用时，已登录用户的保存与交卷必须继续可用（限流降级为放行并记录告警）。

### P-08 无状态 API

API 实例不持有会话状态。JWT + Redis 黑名单。会话（Attempt）的状态在 PostgreSQL，热点读取走 Redis 缓存但以 PG 为准。

### P-09 前后端契约先行

API 契约（`05-api.md`）先行冻结，前后端并行开发。契约变更必须同时改契约文档与两侧代码，由契约测试守住。

### P-10 失败要显式，不要静默降级

组卷抽题池不足、答案保存失败、导入行校验不通过、发布校验不通过，一律**明确报错并给出可操作的原因**。禁止用假数据、默认值或静默跳过掩盖问题。

---

## 3. 限界上下文划分

### 3.1 总览

```
                          ┌──────────────────┐
                          │   Identity &     │  用户/角色/权限/令牌
                          │   Access (IAM)   │
                          └────────┬─────────┘
                                   │ 提供 当前用户 + 权限 + 标签范围
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
┌───────▼────────┐      ┌─────────▼─────────┐      ┌─────────▼─────────┐
│     Catalog     │      │     Authoring     │      │     Delivery      │
│  标签/题目/题库  │─────►│  试卷/组卷方案/快照 │─────►│  场次/会话/答案    │
│                 │      │                   │      │  /焦点事件/监考    │
└───────┬────────┘      └───────────────────┘      └─────────┬─────────┘
        │                                                   │
        │                        ┌──────────────────────────┤
        │                        │                          │
┌───────▼────────┐      ┌─────────▼─────────┐      ┌─────────▼─────────┐
│     Grading     │      │     Learning      │      │    Analytics      │
│  评分/阅卷/发布  │◄─────│  错题/能力画像/练习  │      │  成绩与逐题统计    │
└────────────────┘      └───────────────────┘      └───────────────────┘

                     ┌──────────────────┐
                     │  Shared Kernel   │  基础实体/值对象/领域事件/错误码/时钟抽象
                     └──────────────────┘
                     ┌──────────────────┐
                     │       Audit      │  追加式审计日志（横切，各上下文写）
                     └──────────────────┘
```

### 3.2 各上下文职责

| 上下文 | 拥有（写权限） | 对外提供 | 不拥有 |
|---|---|---|---|
| **Identity & Access** | 用户、角色、权限、刷新令牌、用户-标签关联 | 鉴权判定、当前用户档案、用户标签查询 | 题库、考试数据 |
| **Catalog** | 标签、题目、题库、导入批次、生成批次 | 题目查询（按标签/难度/题型）、题目快照数据 | 试卷的题位与配分 |
| **Authoring** | 试卷、题位、组卷方案、试卷快照、卷型模板 | 已发布试卷的卷面定义 | 作答记录、评分 |
| **Delivery** | 考试场次、考生名单、作答会话、答案、答案修订、焦点事件、监考动作 | 会话创建、答案保存、交卷、监考视图数据 | 题目正文（引用快照） |
| **Grading** | 评分结果、阅卷任务、成绩发布、成绩修订 | 判分、阅卷、发布 | 作答原文（引用 Delivery） |
| **Learning** | 错题、能力画像、练习开放单、练习结果 | 错题本、能力分析、练习可见性 | 试卷定义 |
| **Analytics** | 统计快照（读模型） | 成绩分析、逐题正确率、容量看板 | 原始作答数据 |
| **Audit** | 审计日志 | 审计查询 | 业务数据 |
| **Shared Kernel** | 基础类型 | 实体基类、值对象基类、领域事件、错误码、`IClock` | 任何业务规则 |

### 3.3 上下文映射与协作方式

| 上游 → 下游 | 协作方式 | 说明 |
|---|---|---|
| Catalog → Authoring | 同步查询 + 领域事件 | 组卷抽题时经仓储读取题目池；题目发布/停用时发 `QuestionPublished`/`QuestionDisabled` 事件，Authoring 监听以**失效缓存**并阻断正在引用该题的未发布试卷发布 |
| Authoring → Delivery | 发布事件 + 快照引用 | `PaperPublished` 事件携带 `snapshot_id`；Delivery 只存快照引用与副本，不反向读 Authoring |
| Delivery → Grading | 同步调用（交卷时）+ 领域事件 | 交卷命令在同一事务内完成客观题自动评分并生成阅卷任务 |
| Grading → Learning | 领域事件 | `ScoreFinalized` 事件携带判定结果，学习上下文据此回流错题 |
| Learning → Delivery | 同步查询 | 练习可见性判定 |
| 各上下文 → Audit | 同步写入（拦截器 + 显式） | 关键操作写审计日志 |

**跨上下文不共享实体**：跨边界传递的是 ID、DTO 或领域事件，不共享 EF 实体类型。Application 层定义只读投影（`QuestionSummary`、`PaperSnapshotDto`）供其他上下文使用。

---

## 4. 项目结构

### 4.1 后端解决方案

```
backend/
├── ExamManager.sln
├── Directory.Build.props           # 全局编译设置：nullable、可空分析、警告即错误
├── Directory.Packages.props        # 中央包版本管理（Central Package Management）
├── global.json                     # 锁定 SDK 10.0.x
├── NuGet.config
│
├── src/
│   ├── Exam.Domain/                # 领域层（零外部依赖）
│   │   ├── SharedKernel/
│   │   │   ├── Entities/            # Entity, AggregateRoot, IDomainEvent
│   │   │   ├── ValueObjects/        # ValueObject 基类
│   │   │   ├── Events/              # DomainEvent 基类
│   │   │   ├── Exceptions/          # DomainException, ErrorCode
│   │   │   └── Abstractions/        # IClock, IUnitOfWork
│   │   ├── Identity/                # User, Role, Permission, RefreshToken, UserTag
│   │   ├── Catalog/                 # Tag, Question, QuestionBank, ImportBatch
│   │   ├── Authoring/               # Paper, PaperItem, Blueprint, PaperSnapshot
│   │   ├── Delivery/                # ExamSession, Attempt, Answer, FocusEvent, ProctorAction
│   │   ├── Grading/                 # ScoreResult, ReviewTask, GradePublication
│   │   ├── Learning/                # Mistake, AbilityProfile, PracticeAssignment
│   │   ├── Analytics/               # 统计读模型
│   │   └── Audit/                   # AuditLog
│   │
│   ├── Exam.Application/           # 应用层（用例编排）
│   │   ├── Common/
│   │   │   ├── Interfaces/          # IAppDbContext, ICurrentUser, ICache, IObjectStorage, IDomainEventDispatcher
│   │   │   ├── Behaviors/           # Validation / Logging / Authorization / Transaction / UnitOfWork / Performance
│   │   │   ├── Models/              # PageRequest, PageResult, Result
│   │   │   └── Exceptions/          # 异常过滤器与 ProblemDetails 映射
│   │   ├── Identity/                # Commands / Queries / DTOs / Handlers
│   │   ├── Catalog/
│   │   ├── Authoring/
│   │   ├── Delivery/
│   │   ├── Grading/
│   │   ├── Learning/
│   │   ├── Analytics/
│   │   └── Audit/
│   │
│   ├── Exam.Infrastructure/        # 基础设施层
│   │   ├── Persistence/
│   │   │   ├── AppDbContext.cs
│   │   │   ├── Configurations/      # 每实体一个 IEntityTypeConfiguration
│   │   │   ├── Interceptors/        # 审计、领域事件派发、软删除
│   │   │   └── Repositories/
│   │   ├── Caching/                 # Redis 实现
│   │   ├── Messaging/               # 领域事件分发、Outbox
│   │   ├── Storage/                 # MinIO/S3 实现
│   │   ├── Identity/                # JWT 签发、密码哈希
│   │   ├── Time/                    # SystemClock
│   │   └── DependencyInjection.cs
│   │
│   ├── Exam.Web/                    # 宿主
│   │   ├── Controllers/             # v1 Controllers
│   │   ├── Hubs/                    # ProctoringHub (SignalR)
│   │   ├── Middleware/              # 异常处理、请求日志、限流、时钟校验
│   │   ├── Filters/                 # 授权过滤器
│   │   ├── Endpoints/               # 健康检查、Swagger、指标
│   │   └── Program.cs
│   │
│   └── Exam.Worker/                 # 后台作业宿主
│       ├── Jobs/                    # 答案对账、统计汇总、缓存预热、会话清理
│       └── Program.cs
│
└── tests/
    ├── Exam.Domain.UnitTests/       # 领域规则（覆盖率 ≥ 90%）
    ├── Exam.Application.UnitTests/  # Handler 编排（覆盖率 ≥ 80%）
    ├── Exam.Infrastructure.IntegrationTests/  # Testcontainers PG/Redis
    ├── Exam.Web.FunctionalTests/    # WebApplicationFactory 端到端接口
    └── Exam.ArchitectureTests/      # 分层依赖规则强制
```

### 4.2 项目引用规则

```
Exam.Domain            ← 无引用
Exam.Application       ← Exam.Domain
Exam.Infrastructure    ← Exam.Application, Exam.Domain
Exam.Web              ← Exam.Application, Exam.Infrastructure
Exam.Worker            ← Exam.Application, Exam.Infrastructure
```

`Exam.Domain` 的 `.csproj` 中 **不允许** 出现任何 `<PackageReference>`，由架构测试断言。

### 4.3 前端工作区

```
frontend/
├── pnpm-workspace.yaml
├── package.json                     # 根：统一脚本（dev/build/test/lint）
├── tsconfig.base.json
│
├── shared/                          # @exam/shared（源码包，非构建产物）
│   ├── package.json                 # exports → src/index.ts
│   └── src/
│       ├── api/                     # HttpClient 封装、JWT 刷新拦截器、错误规范化
│       ├── auth/                    # 令牌存取、刷新单飞（single-flight）
│       ├── contracts/               # 与后端对应的 TypeScript 类型（手写 + 生成脚本）
│       ├── design/                  # 设计令牌（Tailwind v4 @theme）、基础组件样式
│       ├── ui/                      # Button / Dialog / Table / Toast / Empty / Badge 等
│       ├── hooks/                   # useServerTime / useDebouncedAutosave / useOnline
│       └── utils/
│
├── student/                         # 学生端 SPA
│   ├── vite.config.ts
│   └── src/
│       ├── app/                     # 路由、布局、守卫
│       ├── features/
│       │   ├── auth/
│       │   ├── dashboard/
│       │   ├── practice/
│       │   ├── exam-taking/         # 答题器（核心）
│       │   ├── reports/
│       │   ├── mistakes/
│       │   └── profile/
│       ├── stores/                  # Zustand（客户端态）
│       ├── lib/                     # IndexedDB 队列、图表组件、Markdown 渲染
│       └── main.tsx
│
└── admin/                           # 管理端 SPA
    ├── vite.config.ts
    └── src/
        ├── app/
        ├── features/
        │   ├── auth/
        │   ├── overview/
        │   ├── tags/
        │   ├── banks/               # 题库 + 题目工作台
        │   ├── authoring/           # 组卷向导 + Blueprint
        │   ├── exams/               # 场次管理
        │   ├── proctoring/          # 实时监考大屏
        │   ├── review/              # 阅卷中心
        │   ├── analytics/
        │   ├── users/
        │   └── audit/
        ├── stores/
        └── main.tsx
```

---

## 5. 技术选型论证

### 5.1 后端

| 选型 | 备选 | 决策理由 |
|---|---|---|
| MediatR **12.4.1** | Wolverine / 自研管道 | MediatR 12.x 为 Apache-2.0；13+ 转商业授权，不适合生产项目。Wolverine 生态较新，中文资料少 |
| EF Core 10 + Npgsql | Dapper / Marten | 需求指定 EF Core。EF Core 提供迁移、变更追踪、全局过滤器、乐观并发，是本项目软删除与并发控制的效率来源 |
| Controllers | Minimal APIs | 项目端点约 90 个，需过滤器、模型绑定、Swagger 分组、约定式约定验证；Controllers 的可读性与测试友好度更好 |
| PostgreSQL 17 | PostgreSQL 15 / MySQL | 需求指定 PG。17 的 `MERGE`、并行 vacuum 改进、更好的 WAL 压缩有利于长时间高写入的答题表 |
| SignalR | WebSocket 手写 / SSE | 需要双向推送（监考大屏）+ 组管理 + Redis Backplane；SignalR 是 .NET 官方方案，重连与协议协商成熟 |
| Redis 7 | Memcached / 无 | 需要黑名单、限流、缓存、分布式锁、SignalR Backplane，Redis 一套覆盖 |
| Serilog + OpenTelemetry | 内置 ILogger | Serilog 的结构化 JSON 输出与丰富 sink 更适合日志聚合；OTel 提供统一追踪与指标导出 |
| FluentValidation 11.11 | 内置 DataAnnotations | FluentValidation 支持异步验证、条件验证、错误分组，更适合复杂 Command；11.x 为 Apache-2.0 |
| ClosedXML + CsvHelper | EPPlus / 手写解析 | ClosedXML 为 MIT（EPPlus 商业授权）；CsvHelper 成熟且支持流式，利于大文件 |
| Testcontainers | 真实 PG / SQLite | 需真实 PG 特性（jsonb、GIN、部分索引、递归 CTE），SQLite 无法等价 |
| xUnit 2.9 | NUnit / MSTest | 生态与工具链最成熟；Testcontainers 与 FluentAssertions 适配良好 |

### 5.2 前端

| 选型 | 备选 | 决策理由 |
|---|---|---|
| React 19 + TS 5.9 | Vue 3 | 需求指定 React |
| Vite 7 | Next.js | 纯 SPA + 独立部署，无需 SSR；Next 的服务端能力对本项目无收益 |
| Tailwind CSS v4 | CSS Modules / UnoCSS | 需求指定 Tailwind。v4 的 `@theme` 让设计令牌直接进入 Tailwind 空间，与原型的 `tokens.css` 一一对应 |
| Zustand | Redux Toolkit / Jotai | 客户端态（作答缓冲、计时、主题、路由）用 Zustand 足够，样板代码少 |
| TanStack Query | SWR / 手写 | 服务端数据（题目列表、成绩）需要缓存、失效、重试、后台轮询，TanStack Query 是标准解 |
| Dexie (IndexedDB) | localStorage / idb-keyval | 答案队列需索引与批量操作，Dexie 优于手写 IDB；localStorage 容量仅 5 MB 且为同步 API |
| react-hook-form + zod | Formik | 复杂表单（题目编辑器、组卷规则）的性能与校验体验更好 |
| 自研 SVG 图表组件 | ECharts / Recharts | 需渲染的仅 4 类简单图表（折线、柱状、横条、环形）。自研约 400 行，完全匹配原型视觉令牌，包体节省约 300 KB gzip。若后续图表需求复杂，可替换为 ECharts（组件接口已隔离） |
| Vitest + Testing Library + MSW | Jest | 与 Vite 同源，配置统一；MSW 做网络层打桩 |
| Playwright | Cypress | 多浏览器并行、录制 trace、CI 稳定性好 |

### 5.3 设计令牌的落地

原型的 `docs/ui-design/shared/styles/tokens.css` 定义了完整的颜色、字号、间距、圆角、阴影、动效令牌与深浅双主题。落地方式：

1. 将 `tokens.css` 转为 Tailwind v4 的 `@theme` 声明，保留**变量名**（`--c-primary` 等）以确保与原型像素级一致。
2. `@exam/shared` 导出一份 `theme.css`，两个 SPA 各自 import，保证令牌单一来源。
3. 深色主题通过 `:root[data-theme="dark"]` 覆盖，与原型一致（原型已用 `data-theme` 属性）。
4. 原型中手写的语义化类（`.card`、`.btn-primary`、`.badge-warn`、`.tag-chip` 等）在 `shared/ui` 中实现为 React 组件，**类名保持不变**，便于逐屏比对原型。

---

## 6. 请求处理管线

ASP.NET Core 中间件顺序（`Program.cs` 中严格按此顺序注册）：

```
1. ExceptionHandlingMiddleware      # 全局异常 → ProblemDetails
2. SerilogRequestLoggingMiddleware # 结构化访问日志
3. ForwardedHeadersMiddleware       # 识别代理后的客户端 IP；只认受信任代理网段带来的转发头
4. HttpsRedirection / HSTS         # 生产启用
5. ResponseCompressionMiddleware    # gzip
6. RateLimitingMiddleware           # .NET 8+ 内置限流（Redis 分布式实现）
7. CorsPolicy                       # 允许学生端/管理端来源
8. AuthenticationMiddleware         # JWT Bearer
9. AuthorizationMiddleware          # Policy-Based RBAC
10. RequestLoggingContextMiddleware # 注入 TraceId / 当前用户到日志作用域
11. Endpoint (Controller / Minimal API)
```

管线之外的横切：

- **验证**：FluentValidation 的 `ValidationBehavior` 在 MediatR 管道内执行，失败抛 `ValidationException`，由异常中间件转成 `400 + ProblemDetails`（字段级错误）。
- **授权**：`AuthorizationBehavior` 在管道内检查 `IRequest` 标注的权限点，与 Controller 的 `[Authorize]` 形成双保险。
- **事务**：`TransactionBehavior` 对写命令包裹数据库事务；跨聚合的写用 Outbox 而非分布式事务。
- **领域事件**：EF `SaveChanges` 拦截器收集领域事件，`UnitOfWorkBehavior` 在事务提交后派发。

---

## 7. CQRS 与 MediatR 规范

### 7.1 命名与位置

```
Exam.Application/Catalog/Commands/CreateQuestion/
├── CreateQuestionCommand.cs        # 记录 + 嵌套 Validator
├── CreateQuestionHandler.cs        # IRequestHandler<,>
├── CreateQuestionValidator.cs      # 独立文件，便于复用
└── CreateQuestionResponse.cs
```

- 命令命名 = 祈使句（`CreateQuestion`、`PublishPaper`、`SubmitAttempt`）。
- 查询命名 = 以 `Get`/`List`/`Search` 开头（`GetQuestionDetail`、`ListQuestions`）。
- 查询**必须**返回 DTO，**禁止**返回 EF 实体（防止惰性加载与 N+1）。
- 查询**允许**直连 `IAppDbContext` 投影，不强制走仓储；仅聚合读取走仓储。

### 7.2 管道行为顺序

```
Validation → Logging → Performance(Metrics) → Authorization → UnitOfWork(Transaction)
```

### 7.3 分页

统一 `PageRequest { Page = 1, Size = 20, SortBy?, SortDir? }`，返回 `PageResult<T> { Items, Total, Page, Size }`。**所有列表接口强制分页**，`Size` 上限 200。

---

## 8. 领域事件与 Outbox

### 8.1 领域事件

领域事件定义在 `Exam.Domain/<Context>/Events/`，由聚合根在状态变更时追加到自身的事件集合，持久化时与聚合一同写入。

| 事件 | 发布方 | 消费方 | 作用 |
|---|---|---|---|
| `QuestionPublished` / `QuestionDisabled` | Catalog | Authoring | 失效抽题缓存；阻断引用已停用题的未发布试卷 |
| `PaperPublished` / `PaperUnpublished` | Authoring | Delivery | 生成/失效试卷快照缓存 |
| `ExamSessionPublished` / `Closed` / `Cancelled` | Delivery | Notification（预留） | 通知 |
| `AttemptStarted` | Delivery | Analytics | 计入活跃会话 |
| `AttemptSubmitted` | Delivery | Grading、Analytics | 触发判分与统计 |
| `ScoreFinalized` | Grading | Learning、Analytics | 错题回流、掌握度更新 |
| `GradePublished` | Grading | Delivery | 开放学生查看成绩 |
| `ProctorActionIssued` | Delivery | Delivery（站内信） | 考生端提示 |
| `UserRoleChanged` / `UserTagsChanged` | IAM | Audit | 审计 |

### 8.2 Outbox

领域事件与聚合状态在同一事务内落库到 `outbox_message` 表。后台 `Exam.Worker` 轮询未派发消息并派发到进程内处理器（本期无外部消息队列，故为进程内派发 + 记录）。这样保证"状态已变但事件未送达"不会发生。

---

## 9. 持久化策略

### 9.1 软删除

- 所有可变实体继承 `AuditableEntity`，含 `deleted_at timestamptz null`。
- `AppDbContext.OnModelCreating` 统一注册全局查询过滤器：`e => e.DeletedAt == null`。
- 追加式表（`answer_revision`、`focus_event`、`audit_log`、`grade_revision`）**无** `deleted_at`，不参与过滤（见 P-05）。
- 恢复接口（若提供）需显式 `IgnoreQueryFilters()`。

### 9.2 乐观并发

- 聚合根使用 PostgreSQL 的 `xmin` 系统列作为并发令牌（EF `IsRowVersion()`），零额外列开销。
- 冲突时 EF 抛 `DbUpdateConcurrencyException`，领域层转换为 `ConcurrencyConflictException` → HTTP `409`，前端提示"数据已被他人修改，请刷新后重试"。
- 答案保存走**无并发令牌的单语句 upsert**（`INSERT ... ON CONFLICT DO UPDATE`），不触发并发检查（作答是单人单会话场景，不存在竞争）。

### 9.3 索引策略

- 外键列一律建索引。
- 题目筛选主路径：`(status, type)` 复合索引 + `question_tag(tag_id, question_id)` 索引。
- 标签子集匹配用递归 CTE（`tag` 树），结果集缓存于 Redis 5 分钟。
- 作答表：`attempt_answer(attempt_id)` 唯一索引；`answer_revision(attempt_id, client_seq)` 唯一索引（幂等去重）。
- 会话列表：`attempt(exam_session_id, status)`、`attempt(user_id, created_at desc)`。
- 分析类聚合表按需物化，避免在主表上做重聚合。

### 9.4 分区

`attempt_answer`、`answer_revision`、`audit_log` 按月做 `PARTITION BY RANGE (created_at)`。超过 12 个月的分区转为只读归档分区。首期只建当月与下月分区，由 Worker 按月预建。

---

## 10. 横切关注点

| 关注点 | 实现位置 | 说明 |
|---|---|---|
| 认证授权 | `Program.cs` + `AuthorizationBehavior` + `CurrentUserAccessor` | JWT Bearer + Policy |
| 限流 | `.NET 内置 RateLimiting` + Redis 分布式存储 | 按 IP / 用户 / 端点分级 |
| 日志脱敏 | Serilog `Destructure` 策略 + 自定义 `SensitiveDataMasker` | 手机号、令牌、密码 |
| 密钥管理 | 环境变量 / `dotnet user-secrets`（开发） | 禁止落 `appsettings.json` |
| 审计 | `AuditInterceptor` + 显式 `AuditRecorder` | 关键操作显式记录 |
| 时钟 | `IClock` 抽象 + `SystemClock` | 领域层可测 |
| 缓存 | `ICache` + Redis 实现 + `HybridCache`（内存 L1 + Redis L2） | 试卷快照、标签树 |
| 对象存储 | `IObjectStorage` + MinIO 实现 | 题目附件 |
| 幂等 | 客户端序列号 + 唯一索引 | 答案保存 |
| 限流降级 | Redis 不可用时限流放行并告警 | 保证作答不中断（P-07） |
| 时钟偏移监控 | `ClockSkewMonitor` Hosted Service，30 秒一次 | 偏移 > 50 ms 告警（P-06） |

---

## 11. 关键数据流

### 11.1 主线 A：考生作答保存（最高频路径）

```
浏览器
  │  作答 → Zustand 缓冲 → 3 秒防抖
  ├─ 批量组装 { items: [{questionId, payload, clientSeq}], clientSeq }
  │
  ├─ 若离线 → 写入 IndexedDB 队列（不请求网络）
  │
  ▼
POST /api/v1/attempts/{id}/answers
  │
  ├─ 限流检查（Redis，失败降级放行）
  ├─ 认证 + 权限（本人作答）
  ├─ 校验：会话存在 / 未交卷 / 未超截止时间
  ├─ 幂等：按 (attempt_id, client_seq) 去重
  ├─ 单事务内：
  │    ├─ upsert attempt_answer（当前值）
  │    └─ INSERT answer_revision（追加流水，去重后写）
  └─ 返回 { acceptedSeq, serverTime, remainingSeconds }
```

**性能关键**：该端点使用 EF 的 `ExecuteUpdate`/原生 SQL 批量 upsert，**不**走变更追踪，避免 1000 RPS 下的 GC 压力。批大小上限 50 条/请求。

### 11.2 主线 B：开考（1000 人同时进入）

```
POST /api/v1/attempts  { examSessionId }
  │
  ├─ 校验场次状态、时间窗、名单、次数
  ├─ 创建 Attempt（写库）
  ├─ 读取试卷快照（Redis 缓存命中则直取）
  ├─ 派生本考生的卷面（题序 + 选项置换，确定性种子）
  ├─ 计算截止时间 = min(场次结束时间, 服务端现在 + 时长)
  └─ 返回 { attemptId, questions[], serverTime, deadlineAt, variantKey }
```

快照与派生卷面均为**纯函数 + 确定性种子**，可重复计算，无需额外存储（Redis 缓存加速）。

### 11.3 主线 C：交卷与判分

```
POST /api/v1/attempts/{id}/submit
  │
  ├─ 幂等：已提交则直接返回既有结果
  ├─ 校验截止时间与交卷原因
  ├─ 单事务内：
  │    ├─ 锁定 Attempt（行锁）
  │    ├─ 置 Submitted，写 SubmittedAt / SubmitReason
  │    ├─ 客观题：应用层评分策略 → ScoreResult（Status=AutoScored）
  │    ├─ 主观题：生成 ReviewTask（Status=Pending），ScoreResult（Status=PendingReview）
  │    └─ 写 Outbox 消息
  └─ 提交后派发 AttemptSubmitted / GradePublished（视配置）
```

### 11.4 主线 D：监考实时推送

```
考生端每 15 秒心跳 → POST /attempts/{id}/heartbeat（同时更新 Redis 的活跃状态）
  │
  └─ SignalR Hub（按场次分组）每 2 秒聚合一次状态 → 批量推送给监考教师
```

聚合在服务端 `ProctoringBroadcaster` 中完成，避免 1000 个考生产生 1000 条独立消息。

---

## 12. 架构决策记录（ADR 摘要）

完整 ADR 存放于 `docs/development/adr/`，此处列出索引：

| 编号 | 标题 | 状态 |
|---|---|---|
| ADR-001 | 采用整洁架构四层与单向依赖 | 已接受 |
| ADR-002 | 锁定 MediatR 12.x（Apache-2.0） | 已接受 |
| ADR-003 | 考试与练习共用 Paper 聚合，用 kind 区分 | 已接受 |
| ADR-004 | 题目与卷面分离为 Question 与 PaperItem | 已接受 |
| ADR-005 | 发布时生成不可变试卷快照 | 已接受 |
| ADR-006 | 答案采用"当前值 upsert + 修订流水 append-only"双表 | 已接受 |
| ADR-007 | 作答保存走原生 SQL upsert，绕过 EF 变更追踪 | 已接受 |
| ADR-008 | 标签采用单表 + 维度判别 + 可选父标签树 | 已接受 |
| ADR-009 | 组卷采用规则引擎 + 确定性种子，池不足时报错不降级 | 已接受 |
| ADR-010 | 试题导入真实实现，AI 生成仅留 Provider 抽象 | 已接受 |
| ADR-011 | 服务端权威计时，客户端时钟仅作显示 | 已接受 |
| ADR-012 | 防作弊定位为可审计与可威慑，非绝对防护 | 已接受 |
| ADR-013 | 监考采用 SignalR + 2 秒批量聚合推送 | 已接受 |
| ADR-014 | 图表自研 SVG 组件，不引入重型图表库 | 已接受 |
| ADR-015 | 数据库分 Schema，追加式表独立 Schema + 权限收回 | 已接受 |
| ADR-016 | 密码使用 ASP.NET Core Identity 默认 PBKDF2 | 已接受 |
