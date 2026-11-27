# 编码规范与测试策略

> 关联：`../design/02-architecture.md`（架构原则）、`../design/03-domain-model.md`（统一语言）
> 本文是代码评审的检查依据。评审时逐条对照，不符合即打回。

---

## 1. 通用原则

1. **领域语言优先**：类名、方法名、变量名一律用统一语言表中的术语。出现 `Manager` / `Helper` / `Util` / `Wrapper` / `DataService` 一律打回。
2. **显式优于隐式**：不做"聪明"的隐式行为；依赖注入、生命周期、事务边界都写清楚。
3. **失败要响亮**：不允许静默 catch、不允许用默认值掩盖错误、不允许 `catch (Exception) { }`。
4. **注释解释"为什么"**：不解释"是什么"。代码本身能说明的事不写注释。
5. **不吞异常**：捕获后要么处理，要么重抛并保留原始堆栈。

---

## 2. 后端规范

### 2.1 分层与依赖

| 层 | 允许依赖 | 禁止 |
|---|---|---|
| `Exam.Domain` | .NET BCL | 任何 NuGet 包、EF Core、ASP.NET |
| `Exam.Application` | Domain、MediatR、FluentValidation | EF Core、ASP.NET、Infrastructure |
| `Exam.Infrastructure` | Application、Domain、EF Core、Redis、MinIO | 直接依赖 Web |
| `Exam.Web` | Application、Infrastructure | 直接引用 Domain 的仓储实现 |

**由 `Exam.ArchitectureTests` 强制**，违反即测试失败：

- `Exam.Domain` 无 `PackageReference`。
- `Exam.Domain` 无 `using Microsoft.EntityFrameworkCore`、无 `using Microsoft.AspNetCore`。
- `Exam.Application` 无 `using Microsoft.EntityFrameworkCore`。
- Handler 之间不直接 `new` 其他 Handler（必须走 `IMediator`）。
- Web 层不出现 `new DbContext` 或直接操作 `DbSet`。

### 2.2 命名

| 对象 | 规则 | 示例 |
|---|---|---|
| 聚合根 | 名词单数 | `Paper`、`Attempt`、`Question` |
| 实体 | 名词单数 | `PaperItem`、`ReviewTask` |
| 值对象 | 名词单数，描述"是什么" | `Score`、`TagSelector`、`ExamRules` |
| 命令 | 祈使句 + `Command` | `CreatePaperCommand`、`PublishPaperCommand` |
| 查询 | `Get` / `List` / `Search` / `Count` 开头 | `GetPaperDetailQuery` |
| 处理器 | `<命令名>Handler` | `CreatePaperHandler` |
| 校验器 | `<命令名>Validator` | `CreatePaperValidator` |
| 仓储接口 | `I<聚合根>Repository` | `IPaperRepository` |
| 领域事件 | 过去式 | `PaperPublished` |
| 领域异常 | `<名词>Exception` | `InsufficientQuestionPoolException` |
| API 路由 | 复数名词 + kebab-case | `/api/v1/paper-templates` |

### 2.3 领域层写法

```csharp
// 正确：不变性由领域方法保护
public sealed class Paper : AuditableEntity
{
    private readonly List<PaperItem> _items = [];
    public IReadOnlyCollection<PaperItem> Items => _items.AsReadOnly();

    private Paper() { }   // EF

    public static Paper CreateDraft(PaperKind kind, string name, long userId)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("试卷名称不能为空。", 20005);
        return new Paper { Name = name.Trim(), Kind = kind };
    }

    public void AddItem(QuestionId questionId, Score score, int sortOrder)
    {
        if (_items.Any(i => i.QuestionId == questionId))
            throw new DomainException("同一道题不能重复出现在试卷中。", 20005);
        _items.Add(PaperItem.Create(questionId, score, sortOrder));
    }
}

// 错误：领域对象持有 EF 特性或做 I/O
public sealed class Paper : AuditableEntity
{
    [NotMapped] public string Foo;          // ✗ 领域层不引入 EF 特性
    public void Save(DbContext ctx) { }    // ✗ 领域层不做持久化
}
```

- 聚合根的集合属性对外只读（`IReadOnlyCollection`），变更只能走领域方法。
- 私有构造函数供 EF 使用；工厂方法做校验。
- 领域异常用 `DomainException`（带错误码），不用 `ArgumentException`（面向外部输入的校验用 FluentValidation）。

### 2.4 应用层写法

```csharp
public sealed class CreatePaperHandler : IRequestHandler<CreatePaperCommand, PaperDto>
{
    public async Task<PaperDto> Handle(CreatePaperCommand request, CancellationToken ct)
    {
        var paper = Paper.CreateDraft(request.Kind, request.Name, _currentUser.UserId);
        paper.SetRules(request.ExamRules, request.PracticeRules);   // 领域方法保证 kind 一致性
        await _repository.AddAsync(paper, ct);
        return PaperDto.From(paper);
    }
}
```

- Handler 只做编排：取数据 → 调领域 → 持久化 → 返回 DTO。**不放业务判断**。
- 查询 Handler 返回 DTO，**不返回实体**；用 `Select` 投影避免 N+1。
- 需要跨聚合一致性时用领域事件 + Outbox，不写跨聚合的长事务。

### 2.5 校验分层

| 层 | 负责 | 例子 |
|---|---|---|
| FluentValidation | 请求格式与必填 | 名称非空、时长范围、标签数量 ≤ 5 |
| 领域方法 | 业务不变量 | 同一题不可重复入卷、切屏计数不可为负 |
| 数据库约束 | 最终兜底 | `CHECK (duration_minutes BETWEEN 1 AND 300)` |

**不重复校验**：同一个规则只在一层实现。FluentValidation 不重复领域层的规则。

### 2.6 错误处理

- 领域层抛 `DomainException`（错误码 + 中文消息）。
- 应用层可抛 `ValidationException`、`ConcurrencyConflictException`、`ForbiddenException`。
- Web 层全局异常中间件统一映射为 ProblemDetails。
- **不使用异常做正常流程控制**：如"提交已交卷的会话"应返回幂等结果而非抛异常。

### 2.7 日志

```csharp
// 正确：结构化 + 关联 ID
_logger.LogInformation("答卷已保存 {AttemptId} {ItemCount} 条，批次 {ClientSeq}", attemptId, count, clientSeq);

// 错误：字符串拼接 + 高频日志
_logger.LogInformation($"用户 {userId} 保存了答案");        // ✗ 无法结构化检索
_logger.LogDebug("答案内容：" + payload);                   // ✗ 敏感数据 + 高频
```

- 热路径（答案保存）用 `Debug` 级别记录详情，`Information` 只记录摘要。
- 禁止记录：密码、令牌、完整答案正文、手机号全文。

### 2.8 异步

- 所有 I/O 方法异步化，后缀 `Async`。
- `CancellationToken` 必须透传到最底层。
- 禁止 `.Result` / `.Wait()` / `GetAwaiter().GetResult()`。
- 禁止 `async void`。

### 2.9 EF Core

- 查询默认 `AsNoTracking()`；只有聚合读取才跟踪。
- 禁止在循环中查库（N+1）；用投影 + `Include` 或批量查询。
- 迁移必须用 `dotnet ef migrations add` 生成并入库。
- 禁止 `FromSqlRaw` 拼接用户输入；参数化。
- 批量写用 `ExecuteUpdate` / `ExecuteDelete` / 原生批量 upsert，不用 `SaveChanges` 逐条。

### 2.10 数据库命名与 SQL

- 表名小写蛇形，schema 前缀按上下文（`iam` / `catalog` / `authoring` / `delivery` / `grading` / `learning` / `analytics` / `audit` / `app` / `outbox`）。
- 索引命名 `ix_<表>_<列>`，唯一索引 `uq_<表>_<列>`。
- 所有表与列必须有中文注释。
- 时间列 `timestamptz`，一律 UTC。

---

## 3. 前端规范

### 3.1 组件

- 组件文件用 PascalCase；一个组件一个文件。
- 展示组件放 `shared/ui`；业务组件放 `features/<feature>/components`。
- 组件 props 必须有 TypeScript 类型；禁止 `any`。
- 组件不直接发请求（除 `shared/api` 外），数据由 `useQuery`/`useMutation` 提供。

### 3.2 状态

| 数据 | 位置 | 禁止 |
|---|---|---|
| 服务端数据 | TanStack Query | 复制到 Zustand 再维护一份 |
| 作答缓冲 | Zustand `attemptStore` | 放 React state（会丢） |
| 离线队列 | Dexie | 放 localStorage |
| 令牌 | 内存变量 | localStorage / sessionStorage / cookie（除 HttpOnly） |

- 选择器细粒度订阅：`useStore(s => s.field)`，禁止 `useStore()` 整体订阅导致的整树重渲染。
- 组件卸载时清理定时器与订阅。

### 3.3 样式

- 一律用 Tailwind 工具类 + 设计令牌（`bg-surface`、`text-text-2`、`text-primary`），**禁止硬编码颜色值**。
- 组件样式不写内联 `style`（动态值除外，如水印位置）。
- 深浅主题必须都验证（用 `data-theme` 切换测试）。

### 3.4 可访问性

- 所有交互元素可键盘操作。
- 图标按钮必须有 `aria-label`。
- 表单错误用 `aria-invalid` + `aria-describedby`。
- 模态框用原生 `<dialog>`，管理初始焦点与焦点归还。
- 动态提示用 `aria-live`（`polite` 用于提示，`assertive` 用于错误）。

### 3.5 文案

- 中文，面向用户；不使用开发术语。
- 错误文案由错误码映射表统一提供，不在组件里硬编码。
- 数字用 `tabular-nums`；分数保留 1 位小数；时间用 `HH:MM:SS`。

---

## 4. 测试策略

### 4.1 测试金字塔

| 层次 | 工具 | 数量占比 | 覆盖对象 |
|---|---|---|---|
| 单元测试 | xUnit | ~65% | 领域规则、算法、应用层 Handler |
| 集成测试 | xUnit + Testcontainers | ~25% | EF 映射、迁移、Redis、对象存储、端到端接口 |
| 端到端 | Playwright | ~10% | 关键用户旅程 |

### 4.2 覆盖率门禁

| 项目 | 门禁 |
|---|---|
| `Exam.Domain` 行覆盖 | ≥ 90% |
| `Exam.Application` 行覆盖 | ≥ 80% |
| 全局行覆盖 | ≥ 80% |
| 分支覆盖（领域层） | ≥ 85% |

覆盖率工具：coverlet.collector + ReportGenerator，CI 中生成 HTML 报告并上传 artifact。

### 4.3 领域层测试

- 每个领域方法至少一条正例、一条反例。
- 状态机测试：穷举合法与非法流转。
- 算法测试（必须含**确定性**断言）：
  - 抽题：同种子同结果；池不足报错内容完整。
  - 分值分配：总和精确等于目标。
  - 卷面派生：同人同卷；判断题不置换。
  - 判分：多选各种组合；关键词归一化。
  - 掌握度：样本不足判定。

```csharp
[Fact]
public void Generate_WithInsufficientPool_ThrowsWithGapDetails()
{
    var pool = BuildPool(onlyTwoHardSingles: true);
    var rules = BuildRules(requireThreeHardSingles: true);

    var ex = Assert.Throws<InsufficientQuestionPoolException>(() => rules.Generate(pool, "seed-1"));

    Assert.Equal(1, ex.Shortfalls.Count);
    Assert.Equal(3, ex.Shortfalls[0].Required);
    Assert.Equal(2, ex.Shortfalls[0].Available);
}
```

### 4.4 集成测试

- 用 Testcontainers 起**真实** PostgreSQL 17 与 Redis（不用 SQLite，无法等价 jsonb / GIN / 递归 CTE）。
- 每个 Command 至少一条集成测试：执行 + 断言数据库状态。
- 每个越权敏感端点至少一条越权测试（断言 404/403）。
- 迁移测试：空库执行全部迁移必须成功（CI 每次跑）。

### 4.5 前端测试

| 类型 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | 格式化、图表计算、同步引擎队列逻辑 |
| 组件 | Vitest + Testing Library | 题目渲染、答题卡状态、校验清单 |
| 网络 | MSW | 错误处理、令牌刷新重放、限流提示 |
| 渲染冒烟 | headless Chromium（CDP，零依赖脚本 `frontend/scripts/smoke-render.mjs`） | 逐路由验证真实渲染：防白屏、防控制台报错、防资源 404、防守卫失效 |
| 端到端 | Playwright | 考试、组卷、练习三条主流程 |

### 4.6 渲染冒烟检查（每次改动后必做）

单元测试与组件测试跑在 jsdom 里，**不反映真实浏览器**。样式漏移植、
产物路径撞车这类问题在它们那里全部隐形。因此前端每次改动后必须跑：

```bash
cd frontend
pnpm smoke            # 对 dev server
pnpm smoke:preview    # 对生产构建
```

它用 headless Chromium 逐路由检查四件事：正文是否渲染出来（防白屏）、
有无控制台错误与未捕获异常、有无失败的资源请求、关键文案是否出现。

CI 把它作为**门禁**（缺浏览器即失败，不静默跳过）。新增页面时，
同步在 `scripts/smoke-render.mjs` 的路由表里补一条。

### 4.7 端到端测试场景（必须覆盖）

1. **考试主流程**：登录 → 进入考试 → 作答 3 题 → 刷新页面（答案还在）→ 断网 → 继续作答 → 恢复网络 → 同步 → 交卷 → 看到成绩报告。
2. **防作弊流程**：考试中切屏 3 次 → 第 3 次被强制交卷 → 学生端看到强制交卷原因 → 教师端监考大屏出现该考生状态。
3. **组卷流程**：教师配置标签规则 → 生成（池不足报错并显示缺口）→ 调整规则 → 生成成功 → 手工微调 → 发布校验 → 发布 → 学生端看到该考试。
4. **越权流程**：学生 A 直接访问学生 B 的 `attemptId` → 404；学生访问管理端端点 → 403。
5. **阅卷流程**：交卷 → 阅卷队列出现主观题 → 阅卷给分 → 发布成绩 → 学生端看到主观题分。

### 4.8 CI 失败了怎么看（免管理员权限）

**作业日志与 artifact 只有仓库管理员能下载，注解（annotation）却对所有人可见。**
所以 CI 偶发变红时，失败详情已经贴成注解，直接看运行页上的红色条目即可；
不用管理员权限，也不用猜是哪条用例挂了。

三个测试作业（后端、前端、端到端）都按同一套两段式接：

```yaml
- name: 某某测试
  id: xxx_test
  run: bash ../scripts/ci-run-logged.sh /tmp/xxx.log pnpm test
- name: 某某测试失败详情（写进注解，免管理员权限也能看到）
  if: failure() && steps.xxx_test.outcome == 'failure'
  run: bash ../scripts/ci-annotate-failure.sh /tmp/xxx.log "某某测试失败"
```

**接的时候有三个坑**：

1. `cmd | tee log` 会把退出码换成 tee 的 **0**——测试失败会变成「步骤成功」，
   CI 绿灯而问题没被发现。`ci-run-logged.sh` 显式取 `PIPESTATUS[0]`。
2. **路径随作业的工作目录而变**：backend/frontend 作业的默认工作目录是
   `backend/` 与 `frontend/`，脚本要写 `../scripts/...`；端到端作业没有默认
   工作目录（=仓库根），要写 `scripts/...`。
3. **注解步骤要盯着自己那一步**（上面的 `id` + `outcome` 判断）。只写
   `if: failure()` 的话，作业里后面任何一步红了都会触发它，把一份**通过的**
   日志当成失败清单贴出来。

**前端偶发变红**多半是断言撞上了同名元素。页面上同一个名字常渲染两次
（列表行 + 详情面板），`getByText` 撞上两个就报 `Found multiple elements`。
HTTP 模式的详情是异步取回的，取没取回是**竞态**，CPU 一忙就翻车。修法是
把查询**收进各自的区域**：

```tsx
const queue = screen.getByRole("heading", { name: "卷宗队列" }).closest("section")!;
expect(within(queue).getByText(/考试名/)).toBeInTheDocument();
```

本地复现偶发失败要压 CPU：`taskset -c 0,1` 把 vitest 限到两个核，
循环跑几轮就能稳定复现。

---

## 5. Git 规范

### 5.1 分支

| 分支 | 用途 |
|---|---|
| `main` | 生产可用代码，受保护 |
| `develop` | 集成分支 |
| `feature/<阶段>-<简述>` | 功能分支，如 `feature/p3-blueprint` |
| `fix/<简述>` | 缺陷修复 |
| `chore/<简述>` | 构建、配置、依赖 |

### 5.2 提交信息

```
<type>(<scope>): <简述>

<正文：为什么这样改，关联影响>

Refs: T-P3-02
```

`type`：`feat` / `fix` / `refactor` / `perf` / `test` / `docs` / `build` / `ci` / `chore`

示例：

```
feat(p3): 实现标签规则确定性抽题引擎

按 (类型, 难度) 配额矩阵抽取，种子派生自 Blueprint.Seed，
保证同规则同种子下结果完全一致。池量不足时抛
InsufficientQuestionPoolException 并携带逐项缺口，不做静默降级。

Refs: T-P3-02
```

### 5.3 提交粒度

- 一个提交只做一件事。
- 不提交编译产物、密钥、本地配置（`.env`、`appsettings.Development.json` 的密钥部分）。
- 大改动用 `--amend` 或 `rebase -i` 整理后再合并。

### 5.4 PR 要求

- 关联任务号。
- 描述变更内容与影响面。
- CI 全绿。
- 至少一名评审人批准（架构层改动需架构评审）。
- 合并方式：**Squash merge**，保持主分支历史线性。

---

## 6. 代码评审检查清单

### 6.1 后端

- [ ] 命名符合统一语言表，无 `Manager` / `Helper` / `Util`
- [ ] 领域逻辑在领域层，未下沉到 Handler 或 Controller
- [ ] 依赖方向正确，无越层引用
- [ ] 集合属性对外只读，变更走领域方法
- [ ] 校验未与领域规则重复
- [ ] 错误使用领域异常 + 错误码，未用 `ArgumentException` 表达业务规则
- [ ] 未吞异常，无空 catch
- [ ] 无 N+1 查询
- [ ] 异步方法带 `CancellationToken`
- [ ] 热路径日志级别恰当，无敏感数据
- [ ] 数据库变更走迁移
- [ ] 关键操作已写审计

### 6.2 前端

- [ ] 无硬编码颜色值，全部用令牌
- [ ] 服务端数据走 Query，未复制到本地 store
- [ ] 选择器细粒度订阅
- [ ] 组件卸载清理定时器与订阅
- [ ] 交互元素可键盘操作，图标按钮有 `aria-label`
- [ ] 深浅主题都验证过
- [ ] 错误文案来自错误码映射表
- [ ] 作答相关逻辑未使用 React state（会丢）

### 6.3 通用

- [ ] 有对应测试，且测试断言的是**行为**不是实现细节
- [ ] 新增错误码已登记
- [ ] 新增权限点已在权限矩阵登记
- [ ] 文档（接口、领域模型）同步更新
- [ ] 无 TODO / FIXME 遗留

---

## 7. 依赖管理

- 后端使用 Central Package Management（`Directory.Packages.props`），版本集中一处。
- 锁版本，不使用浮动版本（`1.*`）。
- **授权红线**：引入新包前必须确认许可证允许商用（Apache-2.0 / MIT / BSD / PostgreSQL License 可用；GPL / AGPL / 商业授权需显式批准）。
- 前端使用 pnpm lockfile，提交入库。
- 定期（每月）运行依赖漏洞扫描，高危漏洞当期修复。
- **漏洞门禁按生产依赖卡**：`pnpm audit --prod` 与 `dotnet list package --vulnerable` 必须零漏洞。
  开发工具链（ESLint、Vitest 等）的传递依赖不进交付产物，其公告仅作可见性参考，不阻断构建。
- 审计接口只在官方 npm registry 上存在；若使用镜像源（`registry.npmmirror.com`），
  需显式指定 `--registry=https://registry.npmjs.org`，否则审计请求会 404。
