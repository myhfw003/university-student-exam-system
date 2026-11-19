# 联调缺口审计（2026-11-17）

> 目的：核对「后端 + 前端是否已经联调成功」，列出**未接入 API 的前端功能**与**缺失的 API**，
> 并给出逐个推进的顺序。
>
> 方法：把 `docs/api/openapi.json` 的 127 个契约端点与
> `backend/src/Exam.Web/Controllers/*.cs` 的实际路由逐条比对（结果：**1:1 全覆盖，无缺路由**），
> 再把两个 SPA 的每个页面按「数据从哪来」逐个对照。

## 0. 现状（2026-11-19 更新）

> §1 / §2 / §3 是 **2026-11-17 的初始快照**（当时前端几乎没接后端）。
> 到 2026-11-19，P10 阶段（T-P10-01 ~ T-P10-10）已全部完成：
>
> - **§2 列的 20 项功能全部接上真实后端**（学生端 S1–S7、管理端 A1–A13），
>   逐项的推进记录见 §6；
> - **§3 的两处契约缺口**：名单 CSV 导入已在 T-P10-10 补上；
>   **AI 生成题目仍没有端点**——设计决策 9 明确「只保留 Provider 抽象，不接模型」，
>   管理端的「AI 生成」页签仍留在 mock，这是**有意为之**，不是缺口。
> - 附件签名 URL 的对不上已在 T-P10-08b 解决（按附件 ID 取签名 URL）。

## 0. 结论（2026-11-17 的初始快照）

| 结论 | 依据 |
|---|---|
| **后端 API 面完整** | 契约 127 个端点与控制器路由逐条一致；`scripts/export-openapi.sh` 重新导出后与仓库内 `docs/api/openapi.json` **字节级相同** |
| **前端联调只完成了一小部分** | 全仓 grep：真实 API 调用点只有 4 处（见 §1） |
| **契约层缺 2 项**（见 §3） | `participants/import` 只见于设计文档；AI 生成无端点 |
| **作答选项键口径已实测确认** | 见 §4，影响任何 HTTP 模式下的判分正确性 |

## 1. 前端已经接上真实后端的地方

| 位置 | 调用 |
|---|---|
| `frontend/shared/src/api/httpClient.ts` | 带 401 单飞刷新重试的客户端 |
| `frontend/shared/src/auth/useAuth.ts` | `POST /auth/login` / `GET /auth/me` / `POST /auth/logout` / `POST /auth/change-password` / `POST /users/{id}/reset-password` |
| `frontend/shared/src/api/catalogApi.ts` | `GET /tags` `/question-banks` `/questions` `/papers` `/practices` |
| `frontend/shared/src/api/examSessionApi.ts` | `GET /exam-sessions`（**已实现但无页面调用**） |
| `frontend/student/src/lib/transports.ts` | `POST /attempts/{id}/answers`、`GET /attempts/{id}`（对账） |
| `frontend/admin/src/features/monitoring/useProctorFeed.ts` | `GET /exam-sessions/{id}/monitoring` |

## 2. 仍走 mock 的功能（按优先级）

### 学生端

| # | 功能 | 页面 | 应调用的端点 | 端点是否存在 |
|---|---|---|---|---|
| S1 | **考试作答主流程** | `features/exam-taking/useExamSession.ts` | `POST /attempts`、`POST /attempts/{id}/answers`、`/focus-events`、`/heartbeat`、`/submit` | 全部存在 |
| S2 | 考试安排列表 | `features/exam/ExamListPage.tsx` | `GET /exam-sessions`、`GET /attempts` | 存在 |
| S3 | 成绩报告（单场） | `features/reports/ExamReportPage.tsx` | `GET /attempts/{id}/report` | 存在 |
| S4 | 成绩列表 | `features/reports/ReportListPage.tsx` | `GET /my/results` | 存在 |
| S5 | 练习流程 | `features/exam-taking/usePracticeSession.ts` | `POST /attempts`（practiceAssignmentId）、`POST /attempts/{id}/feedback` | 存在 |
| S6 | 错题本 | `features/mistakes/MistakesPage.tsx` | `GET /mistakes` | 存在 |
| S7 | 工作台 | `features/dashboard/DashboardPage.tsx` | `GET /dashboard/summary` | 存在 |

### 管理端

| # | 功能 | 页面 | 应调用的端点 | 端点是否存在 |
|---|---|---|---|---|
| A1 | 场次列表与生命周期 | `features/sessions/ExamSessionListPage.tsx` | `GET/POST /exam-sessions`、`/{id}/publish`、`/close`、`/cancel` | 存在（无「推进到进行中」这一跳，发布即进入进行中） |
| A2 | 场次详情：防作弊规则、名单、导出、**成绩发布** | `features/sessions/ExamSessionDetailPage.tsx` | `PUT /exam-sessions/{id}`、`GET /exam-sessions/{id}/participants`、`/{id}/grades` | 存在 |
| A3 | 场次负责人 | 场次详情页「负责教师」卡片 | `GET/PUT /exam-sessions/{id}/assignments` | 存在（T-P10-12 补上 UI） |
| A4 | 用户与角色 | `features/users/UsersPage.tsx` | `GET /users`、`PUT /users/{id}`、`PUT/DELETE /users/{id}/roles`、`PUT /users/{id}/tags` | 存在 |
| A5 | 名单批量导入 | `features/users/UsersPage.tsx` | `POST /users/import`（multipart） | 存在 |
| A6 | 审计日志 | `features/audit/AuditLogPage.tsx` | `GET /audit-logs` | 存在 |
| A7 | 阅卷中心 | `features/review/ReviewCenterPage.tsx` | `GET /review-tasks`、`/{id}/grade`、`/batch-adopt`、`/{id}/claim`、`/{id}/assign` | 存在（T-P10-13 / T-P10-14 补上 UI） |
| A8 | 监考处置 | `features/monitoring/ProctoringPage.tsx` | `POST /attempts/{id}/proctor-actions`、`GET /attempts/{id}/proctor-actions` | 存在（**按 attempt 维度**，需先补 attemptId 到候选人模型） |
| A9 | 题库与题目 | `features/banks/*`、`features/shared/QuestionEditor.tsx` | `GET/POST/PUT/DELETE /questions`、`/question-banks`、`POST /questions/{id}/publish|disable|restore`、`/questions/batch-status` | 存在 |
| A10 | 组卷向导 | `features/papers/PaperWizardPage.tsx` | `POST/PUT /papers`、`/papers/{id}/items`、`/validate`、`/publish`、`/unpublish`、`/blueprint*`、`/paper-templates` | 存在 |
| A11 | 标签 | `features/tags/TagsPage.tsx` | `GET/POST/PUT/DELETE /tags` | 存在 |
| A12 | 成绩分析 | `features/analytics/AnalyticsPage.tsx` | `GET /statistics/exam-sessions/{id}`、`/statistics/questions/{id}`、`GET /exam-sessions/{id}/grades` | 存在（**只有聚合，没有逐人明细接口**） |
| A13 | 概览 | `features/overview/OverviewPage.tsx` | 无管理端看板接口，需由题目/试卷/阅卷/场次接口拼装 | 部分 |

## 3. 契约缺口（后端确实缺的）

| 缺口 | 依据 | 影响 |
|---|---|---|
| ~~`POST /exam-sessions/{id}/participants/import`（名单 CSV 导入）~~ | **已在 T-P10-10 补上**：端点、契约与前端入口都齐了 | — |
| AI 生成题目 | 全仓无任何生成端点 | 管理端「AI 生成」页签只能留在 mock；设计决策 9 明确「只保留 Provider 抽象，不接模型」 |

另有两项**不是缺口但要注意**：

- **FR-AUD-03 成绩 CSV 导出**：后端没有导出端点，但 `GET /exam-sessions/{id}/grades` + `GET /exam-sessions/{id}/participants` 已足够，
  导出应在**前端**做（`shared/src/utils/download.ts` 已有 `downloadCsv`）。
- **附件签名 URL**：作答卷面返回的是 `ObjectKey`，`GET /questions/{id}/attachments/{aid}/url` 需要附件 **ID**，
  两者对不上；考试中显示题目配图需要补一个按 objectKey 取签名的路径。

## 4. 已实测确认的判分口径（HTTP 模式必须遵守）

后端卷面 `AttemptQuestionDto.Options` 返回的是**置换后的顺序**，但每个选项的 `key` 是**原题键**；
服务端判分（`ScoringStrategies`）拿作答载荷的键直接与快照的 `CorrectKeys`（原题键）比较。

实测（`small_plum` 卷，正确项原题键 `C`）：

| 提交内容 | 得分 |
|---|---|
| 原题键 `C` | 10 / 10 |
| 显示字母 `A`（该选项在卷面上的显示字母） | 0 / 10 |

因此 **HTTP 模式必须在上行前把「显示字母」换算成「原题键」**（`BuiltPaperItem.toOriginal`），
否则梅花卷会整卷判错。这与 `docs/design/05-api.md:988-994` 的待确认项一致，取「客户端换算、服务端存原题键」这一支。

## 5. 推进顺序（一个功能一次）

| 序 | 功能 | 涉及改动 |
|---|---|---|
| 1 | 学生端考试作答（S1+S2） | 后端：作答卷面补 `steps`/`tagIds`；`AttemptSummaryDto` 补 `examSessionId`；前端：`attemptApi` 适配层、作答页接后端、上行键换算 |
| 2 | 学生端成绩报告（S3+S4） | 报告页与成绩列表改读 `/attempts/{id}/report` 与 `/my/results` |
| 3 | 学生端练习（S5） | `POST /attempts`（practiceAssignmentId）+ `/feedback` |
| 4 | 学生端错题本与工作台（S6+S7） | `/mistakes`、`/dashboard/summary` |
| 5 | 管理端场次（A1+A2+A3） | 场次 CRUD、名单、负责人 |
| 6 | 管理端用户与审计（A4+A5+A6） | 用户/角色/组织标签、名单导入、审计日志 |
| 7 | 管理端阅卷与监考（A7+A8） | 阅卷队列、处置（需补 attemptId） |
| 8 | 管理端内容生产（A9+A10+A11） | 题库、题目、组卷、标签 |
| 9 | 管理端统计与概览（A12+A13） | 成绩分析、看板拼装 |

## 6. 推进记录

### T-P10-01 学生端考试作答（已完成）

**后端契约补齐**

| 补什么 | 为什么 |
|---|---|
| `AttemptQuestionDto.Steps` | 综合题没有步骤，学生在卷面上无从作答（只给题干与分值，**不含参考答案与关键词**） |
| `AttemptQuestionDto.TagIds` / `DifficultyTagId` | 题头的领域/知识点/难度片要靠标签 ID 渲染 |
| `AttemptSummaryDto.ExamSessionId` | 前端要靠它把「我的作答」对应回「考试安排」里的某一场 |

**前端接线**

- `shared/src/api/attemptApi.ts`：开始作答、取会话、交卷、焦点事件、心跳、我的作答列表（DTO → 前端口径的映射都在这一层）。
- `shared/src/api/answerPayload.ts`：**选择键口径换算**——上行时显示字母 → 原题键，对账回填时原题键 → 显示字母。
- `shared/src/engine/paper.ts` 的 `buildPaperFromSurface`：服务端卷面 → 答题者卷面（按位置重编号显示字母，记下 `toOriginal`/`fromOriginal`）。
- `student/src/features/exam-taking/useRemoteExamSession.ts`：HTTP 模式的考试会话（服务端卷面、服务端截止时间、服务端切屏计数、服务端交卷）。
- `student/src/features/exam/useExamList.ts`：HTTP 模式的考试安排列表（场次 + 我的作答 + 内容目录里的试卷信息）。

**实测结论（真实后端，小梅花卷）**

服务端给的选项顺序是置换过的（例：`[C(TCP), B(以太网帧), A(IP), D(ARP)]`），正确项原题键 `C` 在卷面上的显示字母是 `A`：

| 上行内容 | 客观题得分 |
|---|---|
| 原题键 `C`（换算后） | 10 / 10 |
| 显示字母 `A`（不换算） | 0 / 10 |

**顺带修掉的一个真 bug**：`SyncEngine` 的落盘防抖（300ms）把「待成批条目」提前清空了，
3 秒后的上行防抖因此永远无批可发——答案只落在 L2（IndexedDB），传不到服务器。
现在落盘只写盘不清条目，成批与上行交给 `flush`；单批按服务端上限 50 条拆批。

**仍未接后端**：成绩报告页与成绩列表（T-P10-02）。交卷后跳转到报告页会看到「成绩报告尚未接入」的空状态。

### T-P10-02 学生端成绩报告（已完成）

**后端契约补齐**：`MyResultDto` 补 `ExamSessionId` 与 `PracticeAssignmentId`——
成绩条目要能对应回「考试安排」里的某一场与「练习」里的某一条，否则列表点不进去。

**前端接线**

- `shared/src/api/reportApi.ts`：`/my/results` 与 `/attempts/{id}/report` 的 DTO 映射。
- `shared/src/engine/report.ts` 的 `gradedPaperFromReport`：服务端成绩 → 逐题判分明细（复用引擎的 `GradedDetail`，页面渲染不动）。
- `student/src/features/reports/useExamReport.ts`：报告页的数据通路（场次 + 成绩条目 + 卷面 + 报告）。
- `student/src/features/reports/useReportList.ts`：成绩列表的数据通路。

**实测结论（真实后端）**

| 时点 | 接口表现 |
|---|---|
| 场次进行中 | `answersRevealed=false`、`correctKeys=[]`、`analysis=null` |
| 场次关闭后 | `answersRevealed=true`、`correctKeys=["C"]`（**原题键**）、`analysis` 给出 |

两条口径因此定死：**成绩由服务端判，前端不重算**；**正确答案与作答都是原题键**，
前端用考生卷面的换算表还原成显示字母。未到公布时机时前端显示「未公布」，不自己补答案。

**还差的**：综合题逐步得分与简答题要点命中——接口没有给学生端，
HTTP 模式只显示作答原文；这属于接口能力缺口，不是前端映射问题。

### T-P10-03 学生端练习（已完成）

**前端接线**

- `shared/src/api/practiceApi.ts`：`/practices`（学生可见的开放单）与 `/attempts/{id}/feedback`（即时反馈）。
- `shared/src/engine/practice.ts` 的 `gradedPaperFromFeedback`：服务端反馈 → 整卷判分结果（练习结果页的渲染逻辑不用改）。
- `student/src/features/practice/usePracticeList.ts`：练习中心列表（开放单 + 已做过的成绩）。
- `student/src/features/exam-taking/useRemotePracticeSession.ts`：HTTP 模式的练习会话。

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 练习卷面 | 不置换选项（标准卷），`targetType=practice` |
| 即时反馈 | `correct=true`、`score=10`、`correctKeys=["C"]`（**原题键**）、`analysis` 给出 |
| 交卷 | `submitted`，总分 10 / 10 |
| 成绩条目 | 带 `practiceAssignmentId`（练习）与 `examSessionId=null` |

**口径**：练习的正确答案同样给原题键，前端用卷面的换算表还原成显示字母；
错题回流由服务端负责，前端不再本地记错题（错题本本身是 T-P10-04）。

### T-P10-04 学生端错题本与工作台（已完成）

**前端接线**

- `shared/src/api/learningApi.ts`：`/mistakes`、`/mistakes/{id}/redo`、`/mistakes/{id}/resolve`、`/dashboard/summary`。
- `shared/src/domain/learning.ts`：错题与工作台的领域类型。
- `student/src/features/mistakes/useMistakeList.ts`、`student/src/features/dashboard/useDashboard.ts`。

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 错题本 | 题面、题型、错因（`单选错选`）、错次、来源（练习 / 考试）都有 |
| 单题重做 | 返回 `practiceAssignmentId` 与 `attemptId`——服务端把单题练习与会话开好了 |
| 工作台 | 待完成练习、进行中考试、学期平均分、待订正错题、推荐练习、最近成绩、成绩趋势、错题分布全部有 |

**要注意的**：错题回流是**异步**的——交卷后错题本可能要过一拍才有这一条
（`ScoreFinalized` 事件走 outbox，由 worker 落本）。前端读错题本是一次性拉取，不做轮询。

### T-P10-05 管理端场次（已完成）

**前端接线**

- `shared/src/domain/admin.ts`：管理域类型（场次摘要 / 规则 / 详情 / 名单 / 成绩 /
  负责人 / 组织标签 / 用户摘要）。
- `shared/src/api/adminApi.ts`：`GET /tags`（取 organization 维度）、`GET /users`。
- `shared/src/api/examSessionApi.ts` 管理端段：场次 CRUD、发布 / 关闭 / 取消、名单、
  成绩、负责人。
- `admin/src/features/sessions/useAdminSessions.ts`：列表与详情的统一数据通路
  （mock 与 HTTP 各一份，策略口径互转）。
- `admin/src/features/sessions/ExamSessionListPage.tsx` 与 `ExamSessionDetailPage.tsx`：
  改为消费上述通路。

**三处口径差异由数据通路吸收**（页面不需要知道）

1. mock 的名单按班级 ID 展开；真实后端是**组织维度标签**（院系 → 专业 → 班级）
   在发布时物化成的考生列表。
2. mock 的「推进状态」这一步后端没有——后端是「发布即进行中」，再由关闭 / 取消收尾。
3. mock 叫 `AntiCheatPolicy`，后端叫 `rules`，字段一一对应，转换只在数据通路里做。

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 建场次 | 返回 `{session, rules, note, participantTagIds, participantUserIds}`；`variantRule` 传 `null` 时沿用来源试卷的卷型（传空串会被判非法值） |
| 列表 | `GET /exam-sessions?status=&keyword=` 按服务端过滤；摘要含 `statusLabel`、`participantModeLabel`、`variantRuleLabel` |
| 详情 | 与建场次同构；`rules` 与前端防作弊策略一一对应 |
| 改策略 | `PUT /exam-sessions/{id}` 只对未发布的场次生效；改完后后端存的就是同一套 `rules` |
| 发布 | 状态 `scheduled → in_progress`，名单在此刻物化 |
| 名单 | `GET /participants` 返回逐人状态（`invited` / 待入场）、已用次数 |
| 成绩 | `GET /grades` 返回逐人成绩（客观分、总分、待阅卷标记、交卷时间） |
| 关闭 | `POST /close` → `closed` |

**要注意的**

- 允许重考是**来源试卷**的属性，不是场次的：HTTP 模式下新建场次不再有「允许重考」勾选。
- 列表接口不返回名单人数，所以列表页「名单」列显示的是**名单纳入方式**——
  逐场次去数会把请求数乘上场次数。
- 「按组织标签」目前还没有标签可选：组织维度标签要等名单导入
  （`POST /users/import`，属 T-P10-06）之后才会存在。

### T-P10-06 管理端用户与审计（已完成）

**前端接线**

- `shared/src/api/adminApi.ts`：用户列表（带组织归属）、用户详情、档案修改、
  角色分配、组织标签、名单导入、角色目录、审计日志。
- `shared/src/domain/admin.ts`：管理域类型补齐（用户、角色、组织归属、审计条目、
  导入结果）。
- `shared/src/api/httpClient.ts`：支持 `FormData`——名单导入是 multipart。
- `admin/src/features/users/useAdminUsers.ts`：用户列表、角色目录、组织标签与
  变更动作的数据通路。
- `admin/src/features/audit/useAuditLogs.ts`：审计日志的数据通路。
- `admin/src/features/users/UsersPage.tsx` 与 `admin/src/features/audit/AuditLogPage.tsx`：
  改为消费上述通路。

**后端补了三处**

| 补什么 | 为什么 |
|---|---|
| `GET /users` 的响应补 `organizations` | 组织归属与用户条目平行返回。列表接口原来只给用户，前端要显示组织归属只能逐个调 `GET /users/{id}/tags`（N+1） |
| 组织标签的编码派生换成中划线 | **缺陷**：班级名里常有空格（「计科 2301 班」），编码不允许空格 → 整行名单被判「编码非法」而跳过 |
| 用户状态统一成小写 | **缺陷**：列表返回 `Active`，档案修改接口只认 `active`——「读—改—写」会断在半路（写回列表读到的值直接 400） |

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 用户列表 | 条目与组织归属（标签 ID + 完整路径）都齐 |
| 角色目录 | 6 个内置角色与各自的权限点 |
| 名单导入 | 一行成功（新建 + 初始密码回显）、一行因账号非法被跳过；组织标签自动创建并按层级挂接 |
| 组织归属 | 新账号的组织路径是「计算机学院 / 计算机科学与技术 / 计科 2301 班」 |
| 改角色 | 角色码与角色 ID 对得上，权限点按并集给 |
| 停用账号 | 状态写回去不再报 400 |
| 审计日志 | 操作者、动作、对象、摘要、IP、UA、时间都有；导入动作也写了审计 |

**要注意的**

- 角色过滤与角色分配用的都是**角色 ID**：列表给的是角色码，靠 `GET /roles` 对上。
- 审计日志的**操作者过滤**在前端这一页里筛——后端按操作者 **ID** 筛，
  页面上选的是**名字**；动作与对象类型仍然交给服务端。
- 名单导入在 HTTP 模式把**原文件**交给服务端：逐行校验、失败行跳过、
  组织标签自动创建都在后端做，前端的预览只是给人看的。
- 教职 / 在校学生 / 社会人士三个计数在 HTTP 模式是**本页**的，
  账号总数才是服务端统计。
- 组织维度标签要等名单导入之后才会存在——刚部署的库里 `GET /tags` 的
  organization 分组是空的。

### T-P10-07 管理端阅卷与监考（已完成）

**前端接线**

- `shared/src/api/reviewApi.ts`：阅卷任务队列 / 计数 / 卷宗详情 / 领取 / 指派 /
  评分 / 批量采纳 / 上一份下一份。
- `shared/src/api/proctorApi.ts`：监考处置的下发与历史。
- `shared/src/domain/review.ts`：阅卷与监考的领域类型。
- `admin/src/features/review/useReviewTasks.ts`：阅卷队列的数据通路。
- `admin/src/features/review/ReviewCenterPage.tsx`、
  `admin/src/features/monitoring/ProctoringPage.tsx`：改为消费上述通路。
- 候选人模型（`ProctorCandidate`）补 `attemptId`：处置是**按作答**下发的。

**后端补了两处**

| 补什么 | 为什么 |
|---|---|
| `ReviewTaskDto` 补 `studentUsername` / `studentDisplayName` | 队列要显示「谁交的卷」，原来只有卷宗详情里才有学生姓名 |
| 强制交卷前先看 `Attempt.Submit` 的返回值 | **缺陷**：对**已经交卷**的作答再点强制交卷会 500——`Submit` 是幂等的（已交卷返回 false），但命令没看返回值又判了一次分，撞上「一次作答一题一条成绩」的唯一约束。现在返回 422 与明确原因 |

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 阅卷队列 | 主观题交卷后自动进队列；条目带学生姓名、试卷名、建议分、满分与三档状态 |
| 阅卷计数 | 待领取 / 阅卷中 / 已阅完 / 我的 四个数都有 |
| 卷宗详情 | 题干、参考答案、解析、要点命中与未命中项都有 |
| 领取 | 抢占式：任务被领走后再次领取返回 422「该任务已被领取或已阅完」 |
| 评分 | 落 7.5 分并生成改分流水（版本号递增） |
| 上一份 / 下一份 | 可用 |
| 批量采纳 | 需要 `confirm=true`；空队列按参数校验拒绝 |
| 监考快照 | 候选人带 `attemptId`、切屏与断连次数、已答题数 |
| 处置下发 | 警告 / 备注 / 强制交卷都按作答记录，带操作人与原因 |
| 处置历史 | `GET /attempts/{id}/proctor-actions` 返回该次作答的处置列表 |

**要注意的**

- **初判在服务端**：建议分、要点命中、步骤命中都是服务端给的，前端不重算。
- 阅卷任务有三档状态（`pending` / `in_review` / `reviewed`），mock 只有两档。
- 批量采纳要**二次确认**：批量定分不可逆，服务端要求 `confirm=true`。
- 监考处置的**完整历史按作答维度存**，没有场次级列表接口：大屏的「处置记录」
  在 HTTP 模式下只列本屏下发的，完整历史走 `GET /attempts/{id}/proctor-actions`。
- 强制交卷由服务端真正结束作答并判分，前端不自己改本地状态——
  下一次轮询就会看到新状态。

### T-P10-08a 管理端标签（已完成）

**前端接线**

- `shared/src/api/tagApi.ts`：标签的列表 / 建 / 改 / 删。
- `admin/src/features/tags/useAdminTags.ts`：标签的数据通路。
- `admin/src/features/tags/TagsPage.tsx`：改为消费上述通路。

**三处口径差异由数据通路吸收**

| 差异 | 说明 |
|---|---|
| 编码 | 真实后端新建标签必须给编码（唯一、创建后不可改），mock 没有编码——HTTP 模式按「分组 + 名称」派生（`domain.极限与连续`），并允许管理员改 |
| 难度等级 | 后端按维度校验（难度维度必须带等级，其他维度不许带）；两边都按名称定级：基础 1 / 中等 2 / 较难 3 |
| 挂载统计 | 后端只给**总数**；mock 给按对象的明细。后端的题库与练习**没有标签挂载**（题库表上没有标签列，也没有关联表），所以 HTTP 模式只显示挂载总数 |

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 标签列表 | 按维度分组返回；organization 维度里是名单导入建的院系 / 专业 / 班级 |
| 建标签 | 成功；编码重复返回 422「标签编码已存在」 |
| 难度标签 | 缺等级返回 422「难度维度的标签必须指定难度等级（1 到 5）」 |
| 改标签 | 名称与说明可改，**编码保持不变** |
| 删标签 | 成功返回 204 |
| 删有子节点的标签 | 422「标签「计算机学院」下仍有子标签，请先移除子标签」 |
| 删系统预置标签 | 422「系统预置标签「基础」不可删除」 |

**要注意的**

- 父标签只能取同一维度里的标签（维度隔离）。
- 后端拒绝删除时会说明原因（仍有子标签 / 已关联用户 / 系统预置标签），
  前端原样把这句话给管理员看。
### T-P10-08b 管理端题库与题目（已完成）

**前端接线**

- `shared/src/api/questionApi.ts`：题目与题库的读写，外加附件（上传 / 清单 / 签名 URL）。
- `shared/src/api/importApi.ts`：导入批次（上传 → 改列映射 → 采纳）。
- `admin/src/features/banks/useAdminBanks.ts`：题库与题目的数据通路。
- `admin/src/features/shared/useCatalogTags.ts`：标签目录（HTTP 模式来自服务端）。
- `admin/src/features/banks/BanksPage.tsx`、`BankWorkbenchPage.tsx`、
  `admin/src/features/shared/QuestionEditor.tsx`：改为消费上述通路。

**口径差异由数据通路吸收**

| 差异 | 说明 |
|---|---|
| 题号 | mock 的题号就是 id；真实后端里 `id` 是数字主键，题号是 `code` |
| 题库没有标签 | 后端的题库表上没有标签列，也没有关联表——HTTP 模式不提供题库标签，页面如实写「题库无标签」 |
| 过滤在服务端 | 题目可能成千上万：状态 / 题型 / 标签 / 关键词都交给服务端筛 |
| 难度是独立维度 | 建题必填「难度维度的标签」（`difficultyTagId`）；标签 ID 是数字主键，编辑器与列表的标签目录改读服务端 `/tags`（按 `appliesToQuestions` 过滤，组织维度的标签挂不到题目上） |
| 解析在服务端 | 导入是「上传 → 改列映射 → 采纳」三步，解析都在服务端，前端不再自己读文件算列 |
| 列映射的字段名 | 前后端统一为 `code / stem / type / options / answer / steps / analysis / referenceAnswer / score / difficulty / tags`——字段名对不上，服务端认不出来，映射白改 |
| 采纳没有题库参数 | 服务端的采纳端点只把有效行落成草稿候选题；题库归属在题库工作台里维护 |
| 丢弃候选题 | 服务端没有批量丢弃端点：逐题删除（软删） |

**后端补了两处**

| 补什么 | 为什么 |
|---|---|
| `ImportBatchDetailDto` 补 `headers` | 管理员要按**文件表头**调列映射，原来拿不到表头 |
| `MinioObjectStorage.GetAsync` 的缓冲所有权 | **缺陷**：取流时缓冲在自己的 `using` 里被释放，方法返回时流已经关掉——调用方一读就抛 `ObjectDisposedException`，导入批次改列映射直接 500。现在缓冲的所有权交给调用方，并补了回归测试（`MinioObjectStorageTests`，旧实现下必失败） |

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 题库列表 / 建 / 改 / 删 | 成功；删题库返回 204 |
| 建题 / 改题 | 成功；题号唯一（重复返回 422） |
| 难度标签 | 必填：缺难度标签返回 422「请选择难度标签」；标签 ID 不存在返回「存在未知标签」 |
| 题目列表 | 服务端过滤生效（状态 / 题型 / 关键词 / 标签） |
| 状态流转 | 发布 / 停用 / 恢复 / 批量状态都可用 |
| 题目进出题库 | `POST` / `DELETE /question-banks/{id}/items` 可用，统计随归属变化 |
| 删题 | 只有草稿能删：已发布返回 422「只有草稿状态的题目才能删除，当前状态：已发布。」 |
| 导入上传 | 服务端解析并给出列映射建议与逐行结果 |
| 导入的难度 | **没有难度列时每一行都标红「必须指定难度标签。」**——服务端要求每道导入题挂一个难度维度的标签，列映射里补上「难度」即可 |
| 导入改列映射 | 修好 MinIO 取流后返回 200（此前 500 `ObjectDisposedException`） |
| 导入采纳 | 有效行落成草稿候选题（source=import），返回采纳数量与失败行 |
| 附件上传 | 200，返回附件 ID 与对象键；文件落在私有桶 |
| 附件清单 / 签名 URL | 都能取到；URL 是 5 分钟有效的签名地址 |
| 题目详情里的附件 | 只给 ID、文件名、类型与大小，**没有访问地址**——地址要按附件单独取 |
| 上传非图片 | 422「只允许上传 png、jpg、webp 格式的图片。」 |

**要注意的**

- **编辑题目要先取详情**：列表里只有摘要（没有选项、答案、要点、附件），
  拿摘要编辑会把题目内容清空。
- **附件在保存时才上传**：题目还没有 ID 时挂不上附件，编辑器先留文件，
  保存题目后按题目 ID 传。
- **已上传的附件暂时不能移除**：服务端没有「删附件」的端点，HTTP 模式不给移除按钮。
- 题库与练习在后端**没有标签挂载**。
- 导入的「解析文件」在服务端做，前端不再自己解析文件。

### T-P10-08c 管理端组卷向导（已完成）

**前端接线**

- `shared/src/api/paperApi.ts`：试卷（增删改查、题位、校验、发布 / 撤回、派生卷面）、
  卷型模板（列表 / 另存 / 套用）与组卷方案（规则 / 生成 / 差异）。
- `admin/src/features/papers/useAdminPapers.ts`：组卷的数据通路——
  卷对象（mock / HTTP 同一形状）、题目池、已选题目。
- `admin/src/features/shared/PaperVariantTable.tsx`：服务端派生卷面的预览表。
- `admin/src/features/papers/PaperListPage.tsx`、`PaperWizardPage.tsx`：改为消费上述通路。
- `admin/src/features/shared/EntityTagsDialog.tsx`：加 `onSave` 与 `catalogTags`
  （HTTP 模式把标签挂到服务端的卷对象上，目录来自服务端）。
- `admin/src/features/papers/__tests__/papersPage.http.test.tsx`：HTTP 模式用例（5 条）。

**十处口径差异由数据通路吸收**

| 差异 | 说明 |
|---|---|
| 名单与开放时间不在试卷上 | 它们属于**场次**（`/exam-sessions`）：HTTP 模式的向导不再提供名单与开考 / 结束时间，页面如实写明「名单在场次里配置」 |
| 题序规则 | 服务端存 `by_type` / `manual`，前端叫「按题型分块 / 按选题顺序」 |
| 卷型 | 服务端存 `standard` / `small_plum` / `large_plum` |
| 答案公布时机 | 服务端存 `immediately` / `after_submit` / `after_close`，前端叫「结束后立即公布 / 结束后仅交卷者公布 / 结束后全员公布」 |
| 状态 | 服务端是 `draft` / `published` / `archived` 三态；mock 的考试卷另有「进行中 / 已结束」的运行时状态 |
| 发布校验在服务端 | `POST /papers/{id}/validate` 给逐项结果；警告项要填覆盖理由，而**服务端只收一段总理由**（前端把逐项理由合成一段） |
| 卷面预览用服务端的派生卷面 | `GET /papers/{id}/preview?studentKey=` 只有**已发布**的试卷才有可预览的卷面 |
| 列表摘要里没有卷型与标签 | 卷型与发布校验要看详情——列表里给「进向导查看」与「查看校验」两个入口 |
| 一键出卷在服务端 | 先 `PUT /papers/{id}/blueprint` 存规则，再 `POST /papers/{id}/blueprint/generate` 抽题；题池不足由服务端逐条列出缺口 |
| 题目池的筛选 | 服务端一次只认一个题库（`bankId`），前端按所选题库分别取回再合并去重；题型多选时服务端筛一次、前端再筛一次 |

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 建卷 / 改卷 | 前端载荷原样可用；卷型、题序规则、答案公布时机按服务端口径写入 |
| 题位 | 整体替换可用；**单题分值不能超过 40**（422「题目分值不能超过 40。」） |
| 发布校验 | 逐项返回（题目数量 / 题目状态 / 总分一致 / 无重复题 / 主观题占比 / 时长匹配 / 标签数量 / 名单…），区分阻断项与提醒项 |
| 发布 | 有提醒项且没给覆盖理由时 422「发布校验有警告项未确认，请填写覆盖理由后重试。」；给了理由就发布成功（生成快照并冻结卷面） |
| 撤回发布 | 成功；未发布的试卷撤回返回 422「只有已发布的试卷才能撤回。」 |
| 派生卷面预览 | 发布后可用，返回题序与**选项显示顺序**（选项带的是原题键，顺序是置换后的） |
| 未发布就预览 | 404「试卷尚未发布，没有可预览的卷面。」 |
| 组卷方案 | 存规则 → 生成都可用；返回方案条目、题池缺口与「方案 ↔ 当前卷面」的差异 |
| 卷型模板 | 另存与套用都可用；套用返回套用数、跳过数与被跳过的题目 |
| 删除 | 成功返回 204（只有草稿可删） |

**要注意的**

- **已发布的试卷不能改题位**：服务端对已发布试卷拒绝改题位与改规则——先撤回发布再改。
- **发布要覆盖理由**：提醒项（时长匹配等）不填理由就发布不了。
- **预览需要已发布**：第 3 步的「答题者卷面预览」在草稿状态下没有卷面，页面会说明原因。
- **名单不在卷上**：参加考试的人、开放范围都在**场次**里配置，卷只管内容。
- 列表里的卷型与发布校验要进详情才看得到，列表给的是入口。

### T-P10-09 管理端统计与概览（已完成）

**前端接线**

- `shared/src/api/statisticsApi.ts`：场次成绩分析（服务端的逐项统计）。
- `shared/src/api/importApi.ts`：补导入批次列表（看板上的「最近生产批次」）。
- `admin/src/features/analytics/useAnalytics.ts`：成绩分析的数据通路。
- `admin/src/features/overview/useAdminOverview.ts`：概览看板的数据通路
  （后端没有「管理端仪表盘」这一个端点，数字由各资源自己数，前端拼起来）。
- `admin/src/features/analytics/AnalyticsPage.tsx`、`admin/src/features/overview/OverviewPage.tsx`：
  改为消费上述通路。
- 测试：`admin/src/features/analytics/__tests__/analyticsPage.http.test.tsx`、
  `admin/src/features/overview/__tests__/overviewPage.http.test.tsx`、
  `shared/src/api/__tests__/statisticsApi.test.ts`。

**七处口径差异由数据通路吸收**

| 差异 | 说明 |
|---|---|
| 统计按**场次**，不按试卷 | 服务端给的是「一场考试的成绩分析」（`GET /statistics/exam-sessions/{id}`）——场次才有作答记录；页面上的「试卷」筛选在 HTTP 模式变成「考试场次」 |
| 比率 vs 百分数 | 服务端给的是**比率**（0..1），API 层统一换算成百分数（0..100）——不换算，页面上会出现「及格率 1%」 |
| 分数段与门槛在服务端 | 分数段的切分与及格（60%）/ 优秀（85%）的门槛都在服务端算，前端不重算 |
| 没有发布过的场次没有统计 | 服务端按场次的试卷快照算；没发布过的场次返回 422「考试场次尚未发布，暂无统计数据。」——列表里只列**发布过**的场次 |
| 名单组筛选没有 | 服务端的逐人明细不带组织路径，HTTP 模式不提供「名单组」筛选 |
| 概览是看板不是端点 | 数字由各资源自己数（题目按状态各取一次总数、题库、试卷、练习、阅卷计数、场次、账号、模板、导入批次），前端拼起来 |
| 发布校验未通过要逐卷校验 | 列表接口不给校验结果，概览对**草稿**卷逐卷调校验端点 |

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 场次成绩分析 | 返回参与 / 交卷 / 缺考、平均分 / 最高 / 最低 / 极差、及格率与优秀率、分数段分布、题型得分率、逐题正确率与掌握度、逐人明细 |
| 未发布的场次 | 422「考试场次尚未发布，暂无统计数据。」 |
| 比率口径 | 满分 100 分的人 `passRate = 1.0`（比率，不是百分数） |
| 分数段标签 | 与原型一致（90 分以上 / 80–90 / 70–80 / 60–70 / 60 分以下） |

**要注意的**

- 成绩分析只对**发布过**的场次有数据。
- 逐人明细没有组织路径，名单组筛选在 HTTP 模式不提供。
- 概览的「发布校验未通过」要对每份草稿卷各调一次校验端点。
- 概览的数字来自多个资源，别把它们当成同一时刻的一致快照。

### T-P10-10 场次名单 CSV 导入（已完成）

**后端**

- 新增 `ImportExamParticipantsCommand` 与
  `POST /exam-sessions/{id}/participants/import`（设计文档 §7 列了但一直没实现）。
- CSV 解析复用「用户名单」的解析器：同一份文件（账号、姓名两列必填，列名中英文都认，
  UTF-8 / GBK 都认）。

**三条业务规则**（设计文档没写死，按最保守的做法落地，**要产品确认**）

| 规则 | 说明 |
|---|---|
| 导入的是**已有账号** | 账号不存在时跳过该行并给出原因——场次导入不建账号，建账号走 `POST /users/import` |
| 导入后口径切到「指定考生」 | 名单就是这批账号。原因：服务端规定「指定考生」必须至少有一人，管理员没法先切口径再导入 |
| 只在**未发布**的场次上导入 | 已发布的场次名单已经物化、考生可能已经在作答，换口径会让「谁在考这场」前后不一致（422「场次已发布，不能再修改配置。」） |

另外：**一行都没导进去时不动名单**——宁可什么都不改，也不要把已有名单清空。

**前端**

- `shared/src/api/examSessionApi.ts`：补 `importExamParticipants`。
- `admin/src/features/sessions/ExamSessionDetailPage.tsx`：「考生名单」卡片加「导入名单」
  （只在未发布且真实后端模式下出现），导入结果与被跳过的行都列给管理员。

**实测结论（真实后端）**

| 环节 | 结果 |
|---|---|
| 导入名单 | 3 行（2 个已有账号 + 1 个不存在的）→ 成功 2 人、跳过 1 行，原因「账号不存在：xxx。先在「用户」里建好账号再导入。」 |
| 名单口径 | 导入后切到「指定考生」，名单人数 2 |
| 发布后 | 名单就是导入的 2 人（发布时物化） |
| 已发布的场次再导入 | 422「场次已发布，不能再修改配置。」 |
| 缺少账号列的文件 | 422「名单文件缺少「账号」列（也可用 account / 学号）。」 |

### T-P10-12 场次负责人指派（已完成）

**缺口**：审计 §2 的 A3 写着「端点存在、无 UI」——后端有
`GET` / `PUT /exam-sessions/{id}/assignments`，前端也只有 API 封装。

**前端**

- `admin/src/features/sessions/useAssignees.ts`：负责人候选（除学生与社会人士以外的活跃账号）。
- 场次详情页加「负责教师」卡片与指派对话框；指派覆盖式保存。

**要注意的**

- **指派不授予权限**：只界定「谁负责这场考试」；被指派的人仍要有阅卷或监考的权限点。
- 候选口径是近似做法（不做角色白名单），**待产品确认**；后端不校验角色。

**实测结论**（真实后端）：指派 200 并返回 `userId` / `username` / `displayName` /
`assignedAt`；回读一致；指派不存在的账号 422；传空数组即清空。

### T-P10-13 阅卷任务指派（已完成）

**缺口**：审计 §2 的 A7 写着「claim/assign 无 UI」——后端有
`POST /review-tasks/{id}/claim` 与 `/{id}/assign`，数据通路里也有 `claim` / `assign`。

**前端**

- 阅卷中心的「评分与评语」卡片加「指派阅卷人」入口与「指派阅卷人」信息行；
  候选与场次负责人共用 `features/shared/usePeopleCandidates.ts`。

**要注意的**

- 后端只认**权限**不认角色：没有 `review:grade` 的人被指派会被拒（422）；
  已阅完 / 阅卷中的任务不能再指派（各一条 422）。
- 指派**不改状态**：任务仍是「待领取」，被指派的人领取后才变「阅卷中」。

**实测结论**（真实后端）：给待阅任务指派 → 200 并带 `assigneeId`；给学生指派 →
422「该用户没有阅卷权限，不能指派阅卷任务。」；给已阅完的任务指派 →
422「已阅完的任务不能再指派。」；账号不存在 → 404「指派的阅卷人不存在。」。

### T-P10-14 阅卷任务领取（已完成）

**缺口**：审计 §2 的 A7 里「claim 无 UI」——后端有 `POST /review-tasks/{id}/claim`，
数据通路里也有 `claim`，页面上没有入口。

**前端**：待阅卷宗的「评分与评语」卡片加「领取任务」按钮；领取后走刷新，
下一次拉取就能看到「阅卷中」。**领取与指派按状态互斥**：只有 `pending` 才显示这两个按钮。

**实测结论**（真实后端）：领取 → 200，`status=in_review`，`assigneeId` 与
`reviewerId` 都置为领取人；再领一次 → 422「该任务已被领取或已阅完。」

### T-P10-17 浏览器连真实后端的端到端用例（已完成）

**要补的空白**：验证链路此前只有两档——mock 模式的前端用例（不碰后端）
与 api 组的接口巡检（不碰前端）。**浏览器 → 真实后端**这一档此前是空的。

**前端**

- `pnpm build:http` 出连后端模式的产物（`dist-http/`），与 mock 模式的 `dist/` 并存；
- `scripts/serve-dist.mjs` 新增 `--api-target`：`/api/*` 反代到真实后端
  （与 nginx 的 `location /api/` 同义，前端因此用相对路径，不碰跨域）；
- Playwright 新增 `ui-http` 项目：另一套静态服务器 + 连后端模式的产物。

**断言方式**：先调接口取到一条真实数据，再在页面上找它——不写死具体数值。

**实测结论**（真实后端 + Chromium）：管理端登录后场次列表出现接口返回的那场考试；
学生端登录后工作台显示 `/dashboard/summary` 给的推荐练习；两条用例全绿。

### T-P10-18 场次成绩发布（已完成）

**缺口**：后端有 `POST /exam-sessions/{id}/publish-grades`（权限 `grade:publish`），
前端既没有端点常量也没有调用——成绩发布不出去。

**前端**

- `shared/src/api/examSessionApi.ts` 补 `publishSessionGrades`；
- 场次详情页「考生名单」卡片加「发布成绩」按钮与发布范围对话框
  （全部成绩 / 仅客观题），与「导出成绩」并排。

**要注意的**

- 范围只有 `all` 与 `objective_only` 两种，非法范围是 **400**（请求体校验）不是 422。
- 按钮不按权限点隐藏：能不能发布由后端判定。

**实测结论**（真实后端）：发布全部成绩 → 200（`affectedAttempts=1`）；发布仅客观题 →
200；非法范围 → 400「请求参数校验失败。」；发布后场次成绩 `published=true`。

### T-P10-19 学生端成绩报告显示改分流水（已完成）

**缺口**：后端有 `GET /attempts/{id}/grade-revisions`（权限 `attempt:read-own`，
注释写着「学生端可见：改过几次分、谁改的」），前端没有调用——
学生看不到自己的分被改过。

**前端**

- `shared/src/api/reportApi.ts` 补 `loadGradeRevisions`；
- 成绩报告页加「改分记录」卡片（题号、原分、改后、评语、改分时间），有改分才显示。

**要注意的**

- **成绩没发布之前改分流水是空的**：流水本身是分数的一部分，
  可见性不是 `published` 就返回空列表——学生要等成绩发布后才看得到。

**实测结论**（真实后端）：连续评两次分产生两条流水；发布成绩前学生读到空列表，
发布后读到两条（10 → 5、5 → 8）。

### T-P10-20 端到端流程③：切屏 3 次 → 服务端强制交卷（已完成）

**缺口**：`frontend/e2e/exam-focus-guard.spec.ts` 里那条
「切屏 3 次后被服务端强制交卷」一直用 `test.skip` 挂着，理由是「后端未就绪」。
后端与前端都已就绪，这条改到**真实后端**上跑。

**用例**：`frontend/e2e/exam-focus-guard.http.spec.ts`（`ui-http` 那组）。

**要注意的**

- 场次规则要写 `maxFocusLoss: 3` + `onMaxFocusLoss: force_submit`；
  两次切屏之间要等 700ms——客户端 500ms 窗口内去重。
- 断言两头都查：页面显示已交卷 **且** 服务端会话状态确实已交卷。

**实测结论**（真实后端 + Chromium）：切屏 3 次 → 页面进入已交卷阻断态，
服务端会话状态为已交卷。

### T-P10-21 阅卷中心两处缺陷（已完成）

**缺口**：端到端流程②在真实后端上跑时当场暴露的两处缺陷。

- **领取后卷宗从眼前跳走**：任务离开「待阅卷」筛选后，页面落到队列里的另一份卷宗上，
  教师接着打的分落到别人的卷上。现在领取后把筛选切到「阅卷中」。
- **刷新把教师选好的分数冲掉**：卷宗详情每次刷新都重置评分，
  保存下去的是初判分而不是教师选的分。现在只在换卷宗时重置。

**两处都有回归测试**：修之前用例失败（筛选没切、分数是 6.5 而不是 7）。

### T-P10-22 端到端流程②：阅卷 → 发布成绩 → 学生看到成绩（已完成）

**缺口**：`frontend/e2e/admin-authoring.spec.ts` 里那条
「组卷发布 → 阅卷 → 发布成绩 → 学生看到成绩」一直用 `test.skip` 挂着。
现在落到**真实后端**上跑（`review-grade-publish.http.spec.ts`）。

**要注意的**

- 组卷与建场次走接口，浏览器跑「学生作答 → 教师阅卷打分 → 发布成绩 → 学生看到分数」。
- 学生端与管理端要用**两个浏览器上下文**（刷新令牌是 HttpOnly Cookie，同源会互相顶掉）。
- 按**考试名**定位卷宗，不按学生名：同一个学生在队列里可能还有别的待阅卷宗。

**实测结论**（真实后端 + Chromium）：教师打 8 分并发布成绩后，
学生成绩列表显示「8 / 10」「已完成」，成绩报告页是同一个分。

### T-P10-23 标签筛选语义（已完成）

**缺口一：按标签筛选的请求整条 400**。

前端把标签 ID 拼成逗号串（`tagIds=8,9`），服务端的 `long[]` 只认重复参数
（`tagIds=8&tagIds=9`），逗号串被判成非法值，整条请求失败——
**HTTP 模式下按标签筛选从来没通过**。现在 `httpClient` 把数组参数展开成重复参数。

**缺口二：题库工作台的筛选取值用的是显示文案**。

工作台把「全部」这个**标签文案**直接当请求取值发给数据层，而数据层只认 `all`：

- mock 模式：`全部 ≠ all`，每一行都被过滤掉，题目列表是空的；
- HTTP 模式：发出 `type=全部`，服务端 `ParseType` 判非法，请求直接失败。

按标签筛选的语义再对，只要列表是空的就验不出来——**这是筛选不可用的根因**。
现在取值走数据层口径（`all` / `published`），显示文案只管显示。

**缺口三：后端「全部命中」在含子标签时做不到**。

`includeDescendants=true` 时，「命中所有选中标签」要求父子标签全都挂在题目上。
改成按选中标签**逐个**判定：命中该标签的任意后代就算命中它。

**mock 与服务端对齐**：mock 侧新增 `matchTagFilter`，按 `includeDescendants` /
`matchMode` 判定，与服务端逐条一致（6 条用例）；组卷选题池也换用同一套。

**要注意的**

- `TagFilter` 的两个控件只在页面传了对应回调时才渲染——学生端没传，结构不变。
- API 契约没动：`includeDescendants` / `matchMode` 早就在 `openapi.json` 里，
  只是前端没发。导出后 `openapi.json` 与之前逐字节相同。

**实测结论**（真实后端 + Chromium + 后端功能测试 7 条 + 前端 350 条用例）：全部通过。

- 新增 `e2e/tag-filter.http.spec.ts`：造一对父子标签与两道题（走接口），
  浏览器里点 chip、开关、切命中模式，断言列表怎么变**并**断言线上的 `tagIds`
  是重复参数。把前端的修复临时改回逗号串，这条用例**当场失败**（列表空），
  改回来又通过——**证明这条用例盯得住这个缺陷**。
- `ui-http` 那组（浏览器连真实后端）5 条用例、
  `api` 那组（接口全景巡检 + 越权 + 契约对齐）13 条用例全通过。

**待确认：FR-CAT-02 的例子与「同维度成树」冲突**

需求原文（`docs/design/01-requirements.md:111`）写的是
「选『高等数学』命中其下所有知识点」——这要求**领域维度的标签**下挂
**知识点维度的标签**，是跨维度父子关系。

但已接受的三处决定都要求**同维度**成树：

- `docs/design/00-overview.md:243`（D6）：「标签增加 `parent_id`，**同维度内**成树」；
- `docs/design/03-domain-model.md:183`：`ParentId` 是「**同维度内**的父标签」；
- `docs/development/adr/0008-single-tag-table-with-dimensions.md`：
  「可选的 `parent_id` 形成**维度内的**树」。

后端也**强制**这条规则（`Tag.SetParent` 报「父标签必须与当前标签属于同一维度」），
所以上面那个例子按当前实现**实现不了**。

**本次按同维度成树实现**（与 D6 / ADR-008 / 后端强制一致）。
若产品要的是跨维度，牵动的是：后端的 `Tag.SetParent` 约束、
`ExpandDescendantsAsync` 的递归 CTE（要跨维度就得去掉维度判断）、
以及维度隔离约束（FR-CAT-01：题目只能挂四维）——**不是改前端能解决的**。
**这一条需要产品确认后再动。**

### T-P10-24 登录审计（已完成）

**缺口一：登录是唯一没留痕的动作**。

审计的其余动作（改用户、改角色、发试卷、发布成绩、监考处置……）都写了审计行，
只有登录没有——`LoginHandler` 根本没注入 `IAuditRecorder`。
「谁在什么时候登进来过」这条线在系统里是断的，撞库也查不出来。

**缺口二：失败路径压根不落库**。

`UnitOfWorkBehavior` 只在命令**成功返回**之后才 `SaveChangesAsync`，
而登录失败抛的是 `BusinessRuleException`——审计行**和**域里的失败计数
一起被回滚。改之前的实测：连着登错 5 次，`failed_login_count` 还是 0，
账号还是 `Active`，FR-IAM-01 的「连错 5 次锁 15 分钟」从来没生效过。

现在失败路径自己提交一次（`LoginHandler` 注入 `IUnitOfWork`，
与 `CreateUserCommand` 等既有写法一致），审计行与失败计数一起落库。

**操作者**：登录请求还没有令牌，取不到当前用户，所以给 `IAuditRecorder`
加了一个「显式指定操作者」的重载——成功是登录者本人，
失败是**自称的账号**（账号不存在时只有名字，ID 留空）。
账号不存在也留痕（撞库要靠它查），但对外仍是统一提示，不泄露账号是否存在。

**mock 与服务端对齐**：前端本来就有 `auth.login` / `auth.login_failed`
这两个动作码与中文名（`AUDIT_ACTION_LABEL`），这次补上两端——
mock 模式由前端写同一行；示例数据里登录那两行的对象类型从 `session`
改成 `user`（后端口径是「被登录的账号 + 用户 ID」）。
**API 契约没动**：审计行是数据，不是接口。

**要注意的**

- 登录审计行之外还会多出 `entity.user.updated` 自动留痕（`User` 是被审计实体，
  登录时 `LastLoginAt` / `FailedLoginCount` 变了）。这是既有机制，不是重复记录。
- 失败登录现在真的会累积失败计数：同一账号连错 5 次会被锁 15 分钟。
  端到端用例试失败登录要用临时账号。
- 登录失败的对外提示仍是 422 + `20005`（统一提示，不区分账号是否存在），
  与 `openapi.json` 里写的 401 不一致——这是**改动之前就有的**契约出入，
  本次没动（动了就是改接口行为，超出这一项的范围）。

**实测结论**（真实后端 + Chromium + 后端功能测试 + 前端单测）：全部通过。

- 后端功能测试新增 4 条：登录成功写审计行、登录失败写审计行**并**落库
  （`failed_login_count` 变成 1）、账号不存在也写审计行、连错 5 次账号真被锁。
- 浏览器连真实后端（新增 `e2e/login-audit.http.spec.ts`）：管理端登录 →
  审计页按「登录成功」筛能筛到这一行；另一次失败登录按「登录失败」筛能筛到那一行。
- 接口直查：`GET /audit-logs?action=auth.login` 返回
  `operatorName=admin`、`targetType=user`、`summary={"username":"admin"}`；
  `action=auth.login_failed` 返回 `summary={"reason":"密码错误","username":"admin"}`。

### T-P10-25 令牌复用检测（已完成）

**缺口：整族吊销被回滚了，等于没拦**。

`RefreshAccessTokenHandler` 的复用检测那一支是「先整族吊销、再抛异常」，
而工作单元只在命令**成功返回**之后才提交——异常一抛，吊销全没了。
结果：**被偷走的那一族照样能继续刷新**、继续换到访问令牌，
FR-IAM-02 要求的「吊销整个 Token Family」根本没兑现。

现在这一支自己提交一次——与 T-P10-24 的登录失败是**同一处根因**
（命令抛异常时工作单元不提交）。

**既有的单元测试是「假通过」的**：`令牌已吊销_判定为复用并整族吊销`
只断言内存里实体的状态，数据库里什么都没写它也是绿的。
新的功能测试走真实 HTTP + 真实 PostgreSQL：登录拿 Cookie → 刷新（轮换）→
再用旧 Cookie（判定复用）→ **用轮换后的新 Cookie 再刷新必须失败**——
这一条才盯得住「吊销有没有落库」。

**审计行**：动作 `auth.refresh_reuse`（前端中文名「刷新令牌异常使用」），
操作者是令牌的主人，摘要里带令牌族 ID 便于排查。

**另外两个分支没动**（不在 FR-IAM-02 范围，也不构成安全问题）：
令牌过期、账号被禁用时也是「吊销 + 抛异常」，吊销同样被回滚——
但这两种情况刷新请求本来就会被拒（令牌已过期 / 账号不可用），
吊销只是清理动作，回滚了没有安全后果。

**实测结论**（真实后端 + PostgreSQL + 后端单测 + 前端单测）：全部通过。

- 后端功能测试新增 1 条：复用后**轮换出来的新令牌也刷不动了**（整族吊销落库），
  且审计行在（`auth.refresh_reuse`，操作者是账号，摘要带令牌族 ID）。
- 单元测试补断言：复用检测要写审计行、要自己提交。
- 前端：审计页新增动作码 `auth.refresh_reuse`，动作筛选项里能选到。
- API 契约没动：`openapi.json` 逐字节不变。

### T-P10-26 登出留痕（已完成）

**缺口：安全合规文档 §8.2 必审计动作清单里的「登出」没有留痕**。

逐条核过那份清单：登录（T-P10-24 补的）、密码修改、密码重置、角色变更、
用户禁用、用户标签变更、题目、题库、导入采纳、组卷、试卷、场次、名单、
监考处置、阅卷评分、成绩发布、改分——都有审计行，**只剩登出**没有。

`LogoutHandler` 吊销了令牌族、把访问令牌加进黑名单，却没写审计行，
所以「这个账号什么时候登出的」在系统里查不到。

**与前两项的差别**：登出走的是**成功路径**（`LogoutHandler` 正常返回），
工作单元会提交，审计行跟着业务变更一起落库——不像 T-P10-24 / T-P10-25
那样要在失败路径上补一次提交。

**留什么**：动作 `auth.logout`（前端中文名「登出」），操作者是当前登录的人，
对象是账号；摘要里记这次登出有没有带上刷新 Cookie（`refreshTokenRevoked`）——
带上了才说明刷新令牌族被吊销了。

**mock 模式**：前端登出也补同一行（http 模式由后端写），与登录同一套口径。

**实测结论**（真实后端 + PostgreSQL + 后端单测 + 前端单测）：全部通过。

- 后端功能测试新增 1 条：登录后登出 → 审计行在（`auth.logout`，
  操作者是账号，对象是 user）。
- 单元测试新增 2 条：登出写审计行；带刷新令牌时整族吊销且摘要记下。
- 前端：审计页新增动作码 `auth.logout`，mock 模式登出也留痕。
- API 契约没动：`openapi.json` 逐字节不变。

### T-P10-27 敏感数据脱敏（已完成）

**缺口：手机号在 API 响应里是原文**。

用户列表、用户详情、创建用户、更新用户、指派角色——五处映射都直接把
`user.Phone` 带了出去。安全合规文档 §8.4 的规则是「手机号保留前 3 后 4」。

**规则集中成一个地方**：新增
`Exam.Application/Common/Security/SensitiveDataMasker`——
密码与令牌全掩码 `***`、手机号前 3 后 4、邮箱保留首字符与域名；
身份证号不入系统（§9.1），无需处理。单元测试 7 条把每条规则钉住。

**存储的值不改**：库里存的仍是原文——管理员还要能改、能比对，
只在「给人看」的地方（API 响应、日志、审计摘要）脱敏，
与 §9.2「展示脱敏、按需最小化」一致。

**日志侧**：Serilog 加 `Destructure` 策略，登录 / 改密 / 重置密码 /
建用户 / 改用户这几个命令对象一旦被人记进日志，密码与令牌会被换成 `***`、
手机号按前 3 后 4、邮箱保留首字符与域名。
（现在请求体本来就没进日志，这几条策略是防着以后有人把命令对象记进日志。）

**核过一遍「日志里有没有明文密钥」**，结论是没有：

- 审计摘要里没有密码——`user.create` 记的 `generatedPassword` 是
  「是否由系统生成初始密码」这个**标记**，不是密码本身；
- 全仓没有把 password / token / phone 写进 `Log.*` 的调用；
- 名单导入的命令带的是文件字节，不是结构化的行。

**有一处与 FR 的字面要求冲突，先按现状保留，需要产品确认**：
FR-AUD-02 写的是「API 响应中密码一律脱敏」，但**新建用户**与
**重置密码**的响应里带着系统生成的初始密码——那是给管理员一次性转交用的
（FR-IAM-03 要管理员把初始密码交给用户）。掩掉就没法交付初始密码了，
所以这一处没动。

**实测结论**（真实后端 + PostgreSQL + 后端单测）：全部通过。

- 后端功能测试新增 1 条：新建带手机号的用户 → 用户接口返回 `138****5678`。
- 单元测试新增 7 条：脱敏规则的每一条（手机号前 3 后 4、太短全掩码、
  空值原样、密码全掩码、邮箱首字符与域名等）。
- API 契约没动：`openapi.json` 逐字节不变（字段没变，只是值脱敏了）。

### T-P10-28 标签创建留痕（已完成）

**缺口：清单里的「标签创建」没留痕**。

安全合规文档 §8.2 写的是「标签创建/改名/删除」都要审计。改名与删除留到了
——EF 拦截器会记（`entity.tag.updated`）；**创建没留**：拦截器只记
`Modified` 与 `Deleted`，新增实体它不看，而 `CreateTagCommand` 自己也没写
显式审计行。

**留什么**：动作 `tag.create`（前端中文名「新建标签」），对象是标签，
摘要里带编码、名称与维度。mock 模式由前端补同一行（http 模式由后端写）。

**实测结论**（真实后端 + PostgreSQL + 前端单测）：全部通过。

- 后端功能测试新增 1 条：新建标签 → 审计行在（`tag.create`，
  操作者是管理员，对象是 tag，摘要带编码）。
- 前端：审计页新增动作码 `tag.create`，mock 模式新建标签也留痕。
- API 契约没动：`openapi.json` 逐字节不变。

### T-P10-29 时钟偏移提示（已完成）

**缺口：偏移算出来了，没人看**。

`lib/useServerTime.ts` 早就按设计文档实现了「多次采样取中位数 → 偏移突变
超过 5 秒 → 置 `driftDetected`」，但**没有任何消费者**——考试中把系统时间
改掉，用户看不到任何提示，FR-DLV-04 的「偏移突变超过阈值时提示用户并以
服务端时间为准」这条验收从来没兑现。

**提示语沿用设计文档里的原话**：「检测到本机时间异常，已以服务器时间为准」。

**一处实现**：新增 `useClockDriftNotice`（考试作答目录），两个考试会话钩子
（mock 的 `useLocalExamSession` 与 http 的 `useRemoteExamSession`）都调它——
**判定仍在 `useServerTime` 里**，这里只负责把结果告诉用户。

**「以服务端时间为准」那半边本来就是好的**：倒计时用的是 `serverNow()`
（本机时间 + 偏移），截止时间另由服务端裁决，改系统时间不影响服务端的判定。

**实测结论**（前端单测）：新增 3 条用例——检测到偏移突变时提示一次、
没有偏移不提示、偏移状态不变不重复提示。前端 358 条用例全通过。
