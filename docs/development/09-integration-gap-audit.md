# 联调缺口审计（2026-11-17）

> 目的：核对「后端 + 前端是否已经联调成功」，列出**未接入 API 的前端功能**与**缺失的 API**，
> 并给出逐个推进的顺序。
>
> 方法：把 `docs/api/openapi.json` 的 127 个契约端点与
> `backend/src/Exam.Web/Controllers/*.cs` 的实际路由逐条比对（结果：**1:1 全覆盖，无缺路由**），
> 再把两个 SPA 的每个页面按「数据从哪来」逐个对照。

## 0. 结论

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
| A2 | 场次详情：防作弊规则、名单、导出 | `features/sessions/ExamSessionDetailPage.tsx` | `PUT /exam-sessions/{id}`、`GET /exam-sessions/{id}/participants`、`/{id}/grades` | 存在 |
| A3 | 场次负责人 | 无 UI | `GET/PUT /exam-sessions/{id}/assignments` | 存在 |
| A4 | 用户与角色 | `features/users/UsersPage.tsx` | `GET /users`、`PUT /users/{id}`、`PUT/DELETE /users/{id}/roles`、`PUT /users/{id}/tags` | 存在 |
| A5 | 名单批量导入 | `features/users/UsersPage.tsx` | `POST /users/import`（multipart） | 存在 |
| A6 | 审计日志 | `features/audit/AuditLogPage.tsx` | `GET /audit-logs` | 存在 |
| A7 | 阅卷中心 | `features/review/ReviewCenterPage.tsx` | `GET /review-tasks`、`/{id}/grade`、`/batch-adopt`、`/{id}/claim`、`/{id}/assign` | 存在（claim/assign 无 UI） |
| A8 | 监考处置 | `features/monitoring/ProctoringPage.tsx` | `POST /attempts/{id}/proctor-actions`、`GET /attempts/{id}/proctor-actions` | 存在（**按 attempt 维度**，需先补 attemptId 到候选人模型） |
| A9 | 题库与题目 | `features/banks/*`、`features/shared/QuestionEditor.tsx` | `GET/POST/PUT/DELETE /questions`、`/question-banks`、`POST /questions/{id}/publish|disable|restore`、`/questions/batch-status` | 存在 |
| A10 | 组卷向导 | `features/papers/PaperWizardPage.tsx` | `POST/PUT /papers`、`/papers/{id}/items`、`/validate`、`/publish`、`/unpublish`、`/blueprint*`、`/paper-templates` | 存在 |
| A11 | 标签 | `features/tags/TagsPage.tsx` | `GET/POST/PUT/DELETE /tags` | 存在 |
| A12 | 成绩分析 | `features/analytics/AnalyticsPage.tsx` | `GET /statistics/exam-sessions/{id}`、`/statistics/questions/{id}`、`GET /exam-sessions/{id}/grades` | 存在（**只有聚合，没有逐人明细接口**） |
| A13 | 概览 | `features/overview/OverviewPage.tsx` | 无管理端看板接口，需由题目/试卷/阅卷/场次接口拼装 | 部分 |

## 3. 契约缺口（后端确实缺的）

| 缺口 | 依据 | 影响 |
|---|---|---|
| `POST /exam-sessions/{id}/participants/import`（名单 CSV 导入） | 只在 `docs/design/05-api.md:388` 出现；不在 openapi.json，控制器无此路由 | 场次级名单导入无入口 |
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
