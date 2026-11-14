# 前端实现契约

> 前端开发的**长期契约**：规定了分层、状态、样式、文案与无障碍的口径。
> 改前端前先读完本文档；新增页面按本文档的清单走。
> 原型在 `docs/ui-design/`，**中文文案必须逐字照抄原型**。
>
> 当前状态：学生端 9 个路由、管理端 13 个路由全部落地，`pnpm -r typecheck` 零错误、
> `pnpm lint` 零错误、`pnpm -r test` 242 个用例全绿、`pnpm smoke:preview` 23 个路由全绿、
> `pnpm e2e` 6 例通过（2 例因后端未就绪跳过）。落地清单见
> `docs/development/01-task-breakdown.md` 附录 A；还原度审查与修复记录见
> `docs/development/04-frontend-parity-review.md`。

---

## 1. 分层与依赖

```
frontend/shared   设计令牌 + 无业务 UI 原语 + 领域类型 + 引擎 + mock 数据层
frontend/student  学生端 SPA
frontend/admin    管理端 SPA
```

- 依赖方向单向：`student` / `admin` → `shared`。**不得反向**，`shared` 不引入业务概念。
- `shared` 已有 30 个 UI 原语（含图标表 `Icon`）、4 张自研 SVG 图表、领域类型、抽题/判分引擎、mock 数据层。**先查有没有现成的，不要重写。**

### 命令

```bash
cd frontend
pnpm --filter @exam/student typecheck     # 学生端类型检查
pnpm --filter @exam/student test          # 学生端测试
pnpm --filter @exam/admin typecheck
pnpm --filter @exam/admin test
pnpm --filter @exam/shared typecheck
pnpm -r typecheck                         # 全量
pnpm smoke                                # 渲染冒烟（查 5173 / 5174 的 dev server）
pnpm smoke:preview                        # 渲染冒烟（查生产产物，用与 nginx 一致的静态服务器托管）
pnpm e2e                                  # 端到端测试（Playwright，跑生产产物）
```

**数据源开关**：默认走本地示例数据（mock）。设置 `VITE_DATA_SOURCE=http`
（或 `VITE_API_BASE_URL`）后，登录态、答案上行、监考快照、内容目录全部改走后端，
**页面代码不感知这个开关**。

交付前必须：`pnpm -r typecheck` 零错误，`pnpm -r test` 全绿，
**并且 `pnpm smoke` 全部路由通过**（见 §10）。

---

## 2. shared 的公开 API

- `api/index.ts`：`AuthInterceptorConfig`、`DEFAULT_BASE_URL`、`DEFAULT_TIMEOUT_MS`、`ENDPOINTS`、`ERROR_MESSAGE_MAP`、`HttpClientConfig`、`HttpError`、`HttpMethod`、`NETWORK_ERROR_MESSAGE`、`NormalizedProblem`、`OnAuthFailureFn`、`ProblemDetails`、`RefreshTokenFn`、`RequestOptions`、`STATUS_MESSAGE_MAP`、`TokenPair`、`clearTokens`、`createHttpClient`、`getAccessToken`、`getTokens`、`httpClient`、`isExpired`、`isRefreshing`、`isUnauthorized`、`messageForErrorCode`、`normalizeProblem`、`parseProblemDetails`、`refreshOnce`、`setTokens`、`subscribeTokens`、`withAuthRetry`
- `charts/index.ts`：`BarChart`、`BarChartDatum`、`BarChartProps`、`CHART_ACCENT`、`CHART_AXIS`、`CHART_COLORS`、`CHART_FILL`、`CHART_GRID`、`DonutChart`、`DonutChartDatum`、`DonutChartProps`、`HorizontalBarChart`、`HorizontalBarChartDatum`、`HorizontalBarChartProps`、`LineChart`、`LineChartDatum`、`LineChartProps`、`chartColor`、`niceMax`
- `ui/index.ts`：`Icon`、`IconProps`、`Analysis`、`AnalysisProps`、`AnswerSheet`、`AnswerSheetProps`、`Badge`、`BadgeProps`、`BadgeTone`、`BarRow`、`BarRowProps`、`Button`、`ButtonProps`、`ButtonSize`、`ButtonVariant`、`Callout`、`CalloutProps`、`CalloutTone`、`Card`、`CardProps`、`ConfirmDialog`、`ConfirmDialogProps`、`DataTable`、`DataTableColumn`、`DataTableProps`、`Dialog`、`DialogProps`、`Empty`、`EmptyProps`、`Field`、`FieldProps`、`IconButton`、`IconButtonProps`、`KeypointItem`、`KeypointList`、`KeypointListProps`、`Meter`、`MeterProps`、`MeterTone`、`OptionList`、`OptionListProps`、`Pagination`、`PaginationProps`、`QuestionHead`、`QuestionHeadProps`、`RuleList`、`RuleListProps`、`SearchInput`、`SearchInputProps`、`Segmented`、`SegmentedOption`、`SegmentedProps`、`SelectInput`、`SelectInputProps`、`SheetCell`、`Skeleton`、`SkeletonProps`、`SortDirection`、`Stat`、`StatProps`、`TYPE_BADGE_TONE`、`TabItem`、`Tabs`、`TabsProps`、`TagChip`、`TagChipGroup`、`TagChipProps`、`TagFilter`、`TagFilterProps`、`TextArea`、`TextAreaProps`、`TextInput`、`TextInputProps`、`Toast`、`ToastHost`、`ToastHostProps`、`ToastProps`、`ToastTone`、`keypointItems`、`stepItems`
- `utils/index.ts`：`NUM_CLASS`、`formatClock`、`formatDate`、`formatDateTime`、`formatInteger`、`formatMinutes`、`formatPercent`、`formatPercentWithSign`、`formatScore`、`formatTime`、`downloadCsv`、`downloadText`、`toCsv`、`ATTACHMENT_MAX_BYTES`、`ATTACHMENT_MIME_TYPES`、`formatFileSize`、`readFileAsDataUrl`、`validateAttachment`、`parseCsv`、`decodeCsvBuffer`
- `auth/index.ts`：`useAuth`（登录态）、`useCan`、`hasPermission`、`permissionsFor`、`ROLE_PERMISSIONS`、`PermissionPoint`、`AuthUser`、`AuthMode`、`authMode`

### 领域类型（`@exam/shared/domain`）

- 内容域：`Question` `Bank` `ExamPaper` `Practice` `Tag` `Student` `ClassGroup` `ReviewItem`
  `ImportBatch` `GenerationBatch` `PaperTemplate` `ScoreRecord` `Mistake` `PaperItem`
  （也可用 `@exam/shared/domain/types` 直接取；`@exam/shared/domain/attempt` 只放作答域类型）
- 交付域（设计文档 §2.4）：`ExamSession` `ExamSessionStatus` `AntiCheatPolicy`
  `OnExceededPolicy` `ProctorCandidate` `CandidateStatus` `ProctorAction` `ProctorActionKind`
- 治理域（§2.1 §2.7）：`AppUser`（含 `mustChangePassword`）`UserRole` `UserStatus` `AuditLog` `AuditAction`
- 枚举：`QuestionType`（single/multi/judge/short/comprehensive）、`QuestionStatus`
  （draft/published/disabled）、`QuestionSource`（manual/import/ai）、`TagGroup`
  （domain/knowledge_point/ability/difficulty）、`PaperMode`（standard/small/large）、
  `OrderRule`（type/manual）、`UserRole`（system_admin / content_admin / author_teacher /
  grader_teacher / student / general_user，**与设计文档 §2.2 的 Role.Code 一致**）
- **ID 一律是字符串**（`"q-m-01"`、`"t-dom-calc"`、`"exam-net-mid"`、`"2023120101"`），不是数字。

### mock 数据层（`@exam/shared/mock/catalog`）

内容仓库是 **Zustand store** `useCatalog`，配合纯函数读写：

```ts
import { useCatalog, getQuestion, getExam, studentExams, studentExam, preflight, ... } from "@exam/shared/mock/catalog";
```

**读取**：`useCatalog()` 直接订阅（组件里用细粒度选择器，如 `useCatalog((s) => s.questions)`）。
**写入**：调用 `upsertQuestion` / `upsertBank` / `createTag` / `updateTag` / `removeTag` /
`setQuestionStatus` / `setQuestionsStatus` / `removeQuestion` / `discardQuestion` /
`createExam` / `createPractice` / `setExamMeta` / `setPracticeMeta` / `setPaperItems` /
`removePaper` / `savePaperTemplate` / `removePaperTemplate` / `createImportBatch` /
`commitImport` / `createGeneration` / `commitGeneration` / `addReview` / `updateReview` /
`recordMistakes` / `resetCatalog`。
所有写函数返回 `{ ok: boolean; message?: string; ... }`，**失败时必须把 message 原样提示给用户**。

### 运维数据层（`@exam/shared/mock/adminOps`）

考试场次、账号、审计日志、监考快照。**原型没有这四个模块**，按设计文档 §2.4 §2.5 §2.7 §2.8 新建：

```ts
import { useAdminOps, getSession, createSession, publishSession, cancelSession,
         advanceSession, updateUser, setUserRoles, writeAudit, recordProctorAction,
         proctorSnapshot, setCandidate, resetAdminOps,
         ORG_TAGS, USER_ROLE_LABEL, SESSION_STATUS_LABEL, CANDIDATE_STATUS_LABEL,
         AUDIT_ACTION_LABEL, PROCTOR_ACTION_LABEL } from "@exam/shared/mock/adminOps";
```

- **组织归属用组织维度标签表达**（`ORG_TAGS`，学院 → 专业 → 班级三级树），**不存独立字段**。
  组织标签已进 store（`useAdminOps((s) => s.orgTags)`），名单导入时可**按层级自动创建**；
  `ensureOrgTag(name, parentId)` 取或建，`parseUserRole(text)` 解析角色码 / 中文名。
- **人员名单批量导入**（FR-IAM-05）在 `shared/src/mock/roster.ts`：
  `parseRosterCsv` → `validateRosterRows`（逐行校验，错误行标红跳过）→ `importRoster`
  （写用户目录 + 组织标签 + 学生档案 + 审计日志，返回成功 / 失败明细与一次性初始密码）。
- `proctorSnapshot(sessionId, tick)` 是确定性模拟（同一场次 + 同一 tick 必然同结果）；
  接 SignalR 后只需替换 `admin/src/features/monitoring/useProctorFeed.ts` 内部的轮询。

### 引擎（`@exam/shared/engine`）

- `buildPaper(exam, studentId, cfgInput, getQuestion, difficultyLevels)` → 卷面（含 `toOriginal` 显示字母→原题键映射）
- `scorePaper(paper, responses)` → 整卷判分；`applyTeacherScores(graded, records, attemptNo)` → 回填阅卷分
- `selectQuestions(rules, pool, seed, difficultyMap)` → 蓝图抽题；池量不足抛 `InsufficientQuestionPoolError`（带 `shortfalls[]`）
- `allocate(total, count, order)` → 分值分配（各项之和精确等于 total）
- `gradeObjective` `gradeShort` `gradeComprehensive` `stepScores` `normalizeText`

### CSV 解析（`@exam/shared/utils`）

- `parseCsv(text)`：分隔符自动识别（逗号 / 制表符 / 分号）、引号包裹、字段内换行、双引号转义、去 BOM、跳空行
- `decodeCsvBuffer(buffer)`：UTF-8 优先，解出替换字符时按 GBK 重解
- 试题导入（FR-CAT-07）与人员名单导入（FR-IAM-05）**共用**这一套实现

### UI 原语（`@exam/shared`）

`Button` `IconButton` `Dialog` `ConfirmDialog` `Badge` `TagChip` `Callout` `Empty` `Stat`
`Meter` `Segmented` `SearchInput` `DataTable` `Pagination` `Skeleton` `Toast` `ToastHost` `Card`
`Field` `TextInput` `SelectInput` `TextArea` `Tabs` `QuestionHead` `OptionList` `AnswerSheet`
`KeypointList` `Analysis` `BarRow` `RuleList` `TagFilter` `PageHead` `Toaster`

提示条：`toast.ok` / `toast.error` / `toast.info`（命令式，不依赖组件树）。

`Tabs` 有两种外观：`variant="tabs"`（缺省，下划线式）与 `variant="seg"`（分段控件，语义仍是 tablist）。
`Field` 的 `htmlFor` 必须指向控件的 `id`（见 §6）。

图表：`LineChart` `BarChart` `DonutChart` `HorizontalBarChart`。

---

## 3. 样式约定

- **优先用 `primitives.css` 的语义类**（`.card` `.card-head` `.btn` `.btn-primary` `.badge`
  `.badge-ok` `.chip` `.tag-chip` `.table` `.field` `.stat` `.meter` `.callout` `.empty`
  `.list-row` `.filter-block` `.todo-card` `.steps` `.checklist` `.mode-card` `.mselect`
  `.pick-row` `.wiz-picked-row` `.q-opts` `.opt` `.answer-sheet` `.sheet-cell` `.exam-bar`
  `.timer` `.kp-list` `.analysis` `.rule-list` `.variant-tag` …）。
- 该文件已从原型 `app.css` 逐条移植，**缺类时补进 `primitives.css`**，不要在组件里写内联样式。
- **颜色 / 间距 / 圆角 / 阴影一律用令牌变量**（`var(--c-primary)`、`var(--sp-4)`、`var(--r-md)`…），
  **禁止写死具体色值**。令牌清单见 `shared/src/design/theme.css` 与 `docs/ui-design/shared/styles/tokens.css`。
- 深色主题必须可用（`data-theme="dark"`），不要写死浅色。

---

## 4. 文案约定

- **原型的中文文案逐字照抄**，包括按钮、弹窗标题、空状态、校验提示、Toast。
  原型文案来源：`docs/ui-design/exam/js/student.js`、`docs/ui-design/admin/js/admin*.js`。
- 校验提示优先用 `catalog.ts` 各写函数返回的 `message`（已与原型逐字对齐）。
- 数字用 `tabular-nums`（`<span className="num">`）；分数保留 1 位小数（用 `formatScore`）；
  时钟用 `formatClock`；日期用 `formatDateTime` / `formatDate` / `formatTime`。

---

## 5. 状态管理

| 数据 | 位置 | 说明 |
|---|---|---|
| 内容（题目/题库/试卷/练习/标签/阅卷） | `useCatalog`（Zustand） | 管理端写、学生端读，同一份 |
| 服务端数据 | TanStack Query | 后端接口就绪后接入 |
| 作答会话 | `student/src/stores/examSessionStore.ts` / `practiceSessionStore.ts` | 考试用绝对 `deadlineAt` 计时 |
| 本地偏好（当前答题者） | `student/src/stores/studentStore.ts` | Zustand persist |
| 主题偏好 | `student/src/app/themeStore.ts` | 独立 store + 裸 localStorage（键 `exam.theme`）：`index.html` 的内联脚本要在 React 起来之前同步读一次，合并进 persist 会导致首屏闪白 |
| 作答持久化与上行 | `student/src/stores/draftQueue.ts` + `student/src/lib/syncEngine.ts` | 四层保障，见设计文档 §4 |
| 成绩归档 | `student/src/stores/resultArchive.ts` | Zustand persist（键 `zhixing.student.results.v1`）：作答记录、练习成绩、错题本落盘，启动时回灌进 mock catalog——mock catalog 是纯内存的，不归档的话刷新后成绩列表会清空 |

**选择器细粒度订阅**：`useCatalog((s) => s.questions)`，不要 `useCatalog()` 整体订阅。

---

## 6. 可访问性（`docs/development/02-conventions.md` §3.4）

- 图标按钮必须有 `aria-label`。
- 表单错误用 `aria-invalid` + `aria-describedby`（`TextInput` / `SelectInput` / `TextArea` 已内置）。
- 模态框用 `Dialog` / `ConfirmDialog`（已实现焦点陷阱、焦点归还、滚动锁定）。
- 动态提示用 `aria-live`（`Toast` 已内置）。
- 表格表头用 `scope="col"`（`DataTable` 已内置；两端页面里手写的 `<th>` 也必须逐个写上）。
- 键盘可达：Tab 组用 `Tabs`，互斥选择用 `Segmented`。
- **`Field` 必须传 `htmlFor`，且与控件的 `id` 一致** —— 否则 label 与控件没有程序化关联，
  屏幕阅读器读不出控件名，点击标签也不会聚焦控件。
  自造控件（如 `TagPicker`）用 `role="group"` + `aria-label` 提供名称。
- `Field` 传 `required` 时，星号只是视觉标记，**必填态由 `aria-required` 传给控件**（`Field` 自动注入）。

---

## 7. 页面实现清单

**已落地**（详见 `docs/development/01-task-breakdown.md` 附录 A）：

| 端 | 路由 | 页面 |
|---|---|---|
| 学生端 | `/` `/practice` `/practice/:id` `/exams` `/exams/:id` `/exams/:id/report` `/reports` `/mistakes` `/profile` | 工作台 / 练习中心 / 练习作答 / 考试安排 / 考试答题 / 单场成绩报告 / 成绩列表 / 错题本 / 个人中心 |
| 管理端 | `/overview` `/tags` `/banks` `/banks/:id` `/papers` `/papers/:id` `/exam-sessions` `/exam-sessions/:id` `/monitoring/:id` `/review` `/analytics` `/users` `/audit-logs` | 概览 / 标签 / 题库 / 题库工作台（三 Tab）/ 组卷列表 / 组卷向导（四步）/ 场次列表 / 场次详情 / 实时监考 / 阅卷中心 / 成绩分析 / 用户 / 审计 |

新增页面时：

1. 路由已在 `router.tsx` 里注册（`React.lazy` 懒加载），**在 `features/<name>/` 下建文件**并更新 `router.tsx` 的 import。
2. 页面骨架用 `.page-head`（`.page-title` + `.page-sub` + `.page-actions`）+ `.card` / `.stat-row` / `.split` / `.grid-2` / `.grid-3`。
3. 空态用 `Empty`；错误提示用 `Callout`；状态用 `Badge`。
4. 操作前用 `ConfirmDialog` 做二次确认（删除类操作必须）。
5. 写操作成功/失败用 `Toast` 提示，文案照抄原型。
6. 写完后 `pnpm --filter @exam/<包> typecheck` 零错误。

---

## 8. 已知的原型缺口（按设计文档补齐，不要照抄原型）

| 缺口 | 设计依据 | 做法 |
|---|---|---|
| 组卷规则引擎 / 一键出卷 | `docs/design/03-domain-model.md` §4.2 | 用 `selectQuestions` + `BlueprintRules`；池量不足必须报错，不静默降级 |
| 监考大屏 | `docs/design/06-frontend.md` §7 | 按 §7.2 的界面与操作实现；实时推送后端未就绪时用 2 秒轮询模拟；表格用 `@tanstack/react-virtual` 虚拟滚动 |
| 用户 / 角色管理 | `docs/design/01-requirements.md` 权限矩阵 | 6 个角色：`system_admin` `content_admin` `author_teacher` `grader_teacher` `student` `general_user`（**角色码以 `03-domain-model.md` §2.2 的 `Role.Code` 为准**） |
| 审计日志 | 同上 | 列表 + 筛选 |
| 表格分页 / 排序 | `docs/design/05-api.md` | `DataTable` 已内置 `sortBy` / `onSortChange`，接真实接口时传服务端分页参数 |
| 导入的真实文件解析与可编辑列映射 | 已确认决策 9 | **已实现**：`admin/src/features/banks/importFile.ts` 零依赖解析 CSV（UTF-8 / GBK）与 XLSX（浏览器内置解压），列映射可编辑，逐行校验、错误行标红 |
| 标签第 5 组「组织」 | 已确认决策 2 | **组织维度只挂用户**，题目只挂前四维 |
| 人员名单批量导入 | FR-IAM-05 | **已实现**：`shared/src/mock/roster.ts` 逐行校验（文件内重复 / 必填缺失 / 角色无法识别 / 密码过弱均标红跳过），已存在账号走更新不重置密码，院系 / 专业 / 班级缺失时自动创建组织标签并按层级挂接，角色留空按「是否有班级」推断，写审计日志；用户页「批量导入」弹窗可预览、查看失败明细与一次性初始密码 |
| 作答四层保障 / 切屏检测 / 服务端时钟 | `docs/design/06-frontend.md` §4 §5 §6 | 已有 `syncEngine` / `FocusGuard` / `useServerTime` / `Watermark` |

---

## 9. 禁止事项

- 禁止把令牌存进 localStorage / sessionStorage（`tokenStore` 是内存变量）。
- 禁止在组件里写死颜色值。
- 禁止跳过校验直接改数据（题目发布、试卷发布都必须走 `preflight`）。
- 禁止在 `shared` 里引入 `student` / `admin` 的业务概念。
- 禁止把中英文文案混写。

---

## 10. 渲染冒烟检查（每次改动后必做）

```bash
cd frontend
pnpm smoke            # dev server 起好后跑
pnpm smoke:preview    # 或者对生产构建跑
```

**为什么单独要一道**：样式漏移植、产物路径撞车这类问题，
typecheck、lint、单元测试**全都发现不了** —— 它们不碰真实浏览器。
管理端曾因两个 SPA 的产物目录撞车而整页空白，`curl` 返回 200，
只有真实渲染才暴露；也有一版侧栏图标被撑成上百像素，因为共享层漏了
原型的一条 `.od-icon` 规则。

检查内容（`frontend/scripts/smoke-render.mjs`，零依赖，直接走 CDP）：

1. 页面是否真的渲染出内容（防白屏）
2. 是否出现控制台错误 / 未捕获异常
3. 是否有失败的资源请求（防 404 导致的局部失效）
4. 关键文案是否出现（防路由串页、守卫失效）

**规矩：改完前端必须跑一次并确认全绿**，把输出贴进交付说明。
新增页面时，同步在脚本的路由表里加一条（路径 + 关键文案 + 正文最小字数）。

### 端到端测试（Playwright）

```bash
cd frontend
pnpm build     # e2e 跑的是生产产物
pnpm e2e
```

- 覆盖 §12 的三条流程：① 练习闭环、② 组卷 / 阅卷 / 发分、③ 切屏强制交卷；
  其中依赖后端的两段用 `test.skip` 标注了原因，后端就绪后打开。
- 跑的是 `dist` 产物，由 `scripts/serve-dist.mjs`（与 nginx 布局一致）托管。
- 新增关键流程时，在 `frontend/e2e/` 加一条用例。
