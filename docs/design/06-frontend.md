# 06 · 前端设计

> 关联：`docs/ui-design/`（原型）、`05-api.md`（接口契约）
> 目标：像素级还原原型的视觉与交互，同时把原型缺失的可靠性与防作弊能力补齐。

---

## 1. 工程结构

### 1.1 工作区

```
frontend/
├── pnpm-workspace.yaml        # packages: ["shared", "student", "admin"]
├── package.json               # 根脚本：dev / build / test / lint / typecheck
├── tsconfig.base.json         # 严格模式、路径别名 @exam/shared
```

### 1.2 `frontend/shared`（`@exam/shared`）

作为 **源码包** 被两个 SPA 消费（`exports` 指向 `src/index.ts`），避免预构建产物与源码不同步。

```
shared/src/
├── api/
│   ├── httpClient.ts           # fetch 封装：超时、重试、错误规范化
│   ├── authInterceptor.ts      # 401 → 单飞刷新 → 重放原请求
│   ├── problemDetails.ts       # ProblemDetails 解析与错误码映射
│   └── endpoints.ts            # 按上下文分组的端点常量
├── auth/
│   ├── tokenStore.ts           # 内存中的 access token（不落盘）
│   └── useAuth.ts              # 登录、登出、当前用户
├── contracts/                  # 与后端 DTO 对应的 TS 类型
│   ├── identity.ts catalog.ts authoring.ts delivery.ts grading.ts learning.ts analytics.ts
├── design/
│   ├── theme.css               # 由原型 tokens.css 转换的 Tailwind v4 @theme
│   └── primitives.css          # 原型语义化类的基础样式
├── ui/                         # 无业务逻辑的通用组件
│   ├── Button.tsx Dialog.tsx Table.tsx Toast.tsx Empty.tsx Badge.tsx
│   ├── TagChip.tsx SearchInput.tsx Segmented.tsx Meter.tsx Callout.tsx
│   ├── Skeleton.tsx ConfirmDialog.tsx Pagination.tsx
├── hooks/
│   ├── useServerTime.ts        # 服务端时钟偏移同步
│   ├── useOnline.ts            # 在线状态
│   ├── useDebouncedCallback.ts
│   └── useAutosave.ts          # 通用自动保存（缓冲 + 防抖 + 重试）
├── charts/                     # 自研 SVG 图表
│   ├── LineChart.tsx BarChart.tsx HorizontalBarChart.tsx DonutChart.tsx
│   └── chartTheme.ts           # 图表取色（来自令牌）
└── utils/
    ├── format.ts               # 分数、时钟、百分比、日期格式化（与原型 fmt.* 对齐）
    ├── markdown.tsx             # Markdown → React（白名单净化）
    └── download.ts             # CSV 导出
```

### 1.3 `frontend/student`（学生端）

```
student/src/
├── main.tsx App.tsx router.tsx
├── app/
│   ├── AppLayout.tsx           # 顶栏 + 侧栏 + 视图容器
│   ├── nav.ts                  # 导航定义（对齐原型 EX.APP.nav）
│   ├── guards.tsx              # 登录守卫、角色守卫
│   └── providers.tsx           # QueryClient、主题、Toast
├── features/
│   ├── auth/LoginPage.tsx
│   ├── dashboard/DashboardPage.tsx
│   ├── practice/PracticeListPage.tsx PracticeSessionPage.tsx
│   ├── exam-taking/
│   │   ├── ExamSessionPage.tsx        # 答题页容器
│   │   ├── ExamBar.tsx                # 顶栏：标题、计时、标记、交卷
│   │   ├── Timer.tsx                  # 服务端时钟权威倒计时
│   │   ├── QuestionPane.tsx           # 题干 + 选项/作答区
│   │   ├── AnswerSheet.tsx            # 答题卡
│   │   ├── FocusGuard.tsx             # 切屏/全屏/复制检测
│   │   ├── Watermark.tsx              # 姓名 + 账号水印
│   │   ├── SubmitDialog.tsx
│   │   └── OfflineBadge.tsx           # 离线与待同步提示
│   ├── reports/ReportListPage.tsx ReportDetailPage.tsx
│   ├── mistakes/MistakesPage.tsx
│   └── profile/ProfilePage.tsx
├── stores/
│   ├── attemptStore.ts         # 当前作答会话状态（Zustand）
│   ├── draftQueue.ts           # IndexedDB 离线队列（Dexie）
│   ├── themeStore.ts
│   └── uiStore.ts
├── lib/
│   ├── answerDraftStore.ts     # 答案缓冲（本地 + 待同步）
│   └── syncEngine.ts           # 重放与对账
└── styles/app.css
```

### 1.4 `frontend/admin`（管理端）

```
admin/src/
├── main.tsx App.tsx router.tsx
├── app/  （AppLayout、nav、guards、providers）
├── features/
│   ├── auth/LoginPage.tsx
│   ├── overview/OverviewPage.tsx
│   ├── tags/TagsPage.tsx TagDialog.tsx
│   ├── banks/BanksPage.tsx BankWorkbenchPage.tsx QuestionDialog.tsx
│   │        ImportPanel.tsx GenerationPanel.tsx
│   ├── authoring/PaperListPage.tsx PaperWizardPage.tsx
│   │            BlueprintPanel.tsx PublishChecklist.tsx PaperPreviewDialog.tsx
│   ├── exams/ExamSessionListPage.tsx ExamSessionDetailPage.tsx ParticipantsPanel.tsx
│   ├── proctoring/ProctoringPage.tsx   # 实时监考大屏
│   ├── review/ReviewCenterPage.tsx
│   ├── analytics/AnalyticsPage.tsx
│   ├── users/UsersPage.tsx ImportUsersDialog.tsx
│   └── audit/AuditLogPage.tsx
├── stores/ （主题、UI、监考实时状态）
└── styles/app.css
```

---

## 2. 设计令牌落地

### 2.1 从原型到 Tailwind v4

原型 `shared/styles/tokens.css` 的变量直接转为 Tailwind v4 的 `@theme`：

```css
@import "tailwindcss";

@theme {
  --color-canvas: #eef2f3;
  --color-surface: #ffffff;
  --color-surface-2: #f6f9fa;
  --color-surface-3: #e9eff1;
  --color-border: #d9e2e5;
  --color-border-strong: #b9c8cd;
  --color-text: #14242b;
  --color-text-2: #3f535c;
  --color-text-3: #5b6d75;
  --color-primary: #0e5b68;
  --color-primary-hover: #0a4a56;
  --color-primary-soft: #e2eff1;
  --color-primary-line: #a8cbd1;
  --color-on-primary: #ffffff;
  --color-success: #1c6f47;
  --color-danger: #ad2a22;
  --color-warn: #855a06;
  --color-info: #1a5a9c;
  --font-sans: "PingFang SC", "HarmonyOS Sans SC", ...;
  --font-serif: "Source Han Serif SC", ...;
  --font-mono: "JetBrains Mono", ...;
  --radius-sm: 3px; --radius-md: 5px; --radius-lg: 8px;
  --shadow-1: 0 1px 2px rgba(13,30,36,.07), 0 1px 1px rgba(13,30,36,.04);
  --shadow-2: 0 4px 14px rgba(13,30,36,.09);
  --shadow-3: 0 16px 40px rgba(13,30,36,.16);
}
```

用法：`<Button variant="primary">` → `bg-primary text-on-primary`，`<span className="text-text-2">`。

**Tailwind v4 命名空间映射（实测确认，非推测）**：

| 原型变量 | Tailwind v4 命名空间 |
|---|---|
| `--c-*` | `--color-*` |
| `--fs-*` | `--text-*`（配套 `--text-*--line-height`） |
| `--lh-*` | `--leading-*` |
| `--sp-*` | `--spacing-*` |
| `--r-*` | `--radius-*` |
| `--sh-*` | `--shadow-*` |
| `--ease-*` | `--ease-*` |
| `--font-*` | `--font-*` |
| `--dur-*` | **`--transition-duration-*`**（v4 **没有** `--duration-*`） |
| `--z-*` | **`--z-index-*`**（v4 **没有** `--z-*`） |
| `--topbar-h` / `--sidebar-w` / `--rail-w` / `--content-max` / `--reading-max` | 无对应命名空间，保留为 `--layout-*` 自定义命名空间 |

**必须用 `@theme static`**：Tailwind v4 默认会"摇树"掉未被工具类引用的主题变量。若用普通 `@theme`，`--color-primary` 可能被摇掉，而 `--c-primary` 别名通过 `var()` 引用它 → 别名静默失效。`static` 保证全部令牌无条件输出。

**深色主题的层级**：未分层样式的优先级高于任何 `@layer`。因此 `:root[data-theme="dark"]` 必须写在**未分层**规则里，才能稳定压过 `@layer theme` 输出的浅色值。

**保留原型变量名**：`--c-primary` 等原名保留为别名（`:root { --c-primary: var(--color-primary); }`），避免设计稿标注与代码脱节。别名只引用令牌、不复制字面量，因此深色主题只需覆盖 `--color-*`，别名自动跟随。

### 2.2 深色主题

```css
:root[data-theme="dark"] {
  --color-canvas: #0d1417;
  --color-surface: #141d21;
  /* ...原型深色取值... */
  color-scheme: dark;
}
```

深浅两套为**独立取色**（原型承诺"深色主题使用独立取色，保证正文对比度不低于 4.5:1"）。主题切换写入 `localStorage`（键 `exam.theme`），首屏内联脚本预置避免闪白。

### 2.3 语义化组件类

原型的手写类在 `shared/ui` 中实现为组件，**保留原型类名**便于逐屏比对：

| 原型类 | React 组件 | 差异 |
|---|---|---|
| `.btn .btn-primary .btn-sm .btn-danger .icon-btn` | `<Button>` / `<IconButton>` | 增加 `loading` 态与焦点管理 |
| `.card .card-head .card-body` | `<Card>` | — |
| `.badge.badge-primary|info|neutral|warn|ok|danger` | `<Badge tone>` | — |
| `.tag-chip.is-<group>` | `<TagChip group>` | 五维分组样式 |
| `.callout.is-ok|warn|danger|info` | `<Callout tone>` | 增加 `role="status"` |
| `.stat .stat-value .meter .bar-row` | `<Stat>` / `<Meter>` | — |
| `.empty .empty-title .empty-body` | `<Empty>` | — |
| `.table .table-wrap` | `<DataTable>` | 增加服务端分页与排序 |
| `.dialog` | `<Dialog>` | 原生 `<dialog>` + 焦点陷阱 + 滚动锁定 |
| `.toast` | `<Toast>` | `role="status"`，错误用 `role="alert"` |
| `.sheet-cell.is-answered.is-current` | `<AnswerSheet>` | 增加 `aria-current` |
| `.timer.is-warn` | `<Timer>` | 服务端时钟权威 |

---

## 3. 状态管理分工

| 状态类别 | 方案 | 例子 |
|---|---|---|
| 服务端数据（列表、详情、成绩） | **TanStack Query** | 题目列表、成绩报告、统计 |
| 客户端 UI 态 | **Zustand** | 主题、侧栏折叠、弹窗开关 |
| 作答会话态 | **Zustand**（`attemptStore`） | 当前题号、答案缓冲、标记集合、计时状态 |
| 离线队列 | **Dexie（IndexedDB）** | 待同步的答案批次 |
| 令牌 | **内存变量**（`tokenStore`），不落盘 | access token |

### 3.1 为什么不用 React Query 管作答

作答是**高频本地写**（每题一次）+ **低频批量上行**。把它放进 Query 缓存会导致每次按键触发失效与重取。用 Zustand 持有本地真值，自研同步引擎负责上行，更可控。

### 3.2 令牌安全

- `accessToken` 只存在 JS 内存（模块级变量 + Zustand），**不写 localStorage、不写 sessionStorage**。刷新页面后由 `/auth/refresh`（HttpOnly Cookie）静默换发。
- 刷新请求**单飞**（single-flight）：并发 401 只触发一次刷新，其余请求排队等待同一个 Promise。
- 刷新失败（401）→ 清除本地态 → 跳转登录页并携带原路由。
- 令牌过期时间在 `useAuth` 中以 `expiresAt` 计时，到期前 60 秒主动刷新。

---

## 4. 作答可靠性设计（核心）

原型把答案存在 `localStorage`，刷新与换设备即丢。本设计用四层保障。

### 4.1 四层保障

| 层 | 位置 | 作用 |
|---|---|---|
| L1 内存缓冲 | Zustand `attemptStore` | 作答立即反映到 UI |
| L2 IndexedDB 持久化 | Dexie `attemptDraft` | 刷新、崩溃、换标签页不丢 |
| L3 上行队列 | Dexie `pendingBatches` | 断网时排队，恢复后重放 |
| L4 服务端持久化 | PostgreSQL | 最终权威 |

### 4.2 写入时机

```
用户作答
  → L1 立即更新（UI 响应，无网络）
  → L2 防抖 300ms 写 IndexedDB（防抖上限 1s）
  → L3/L4 触发上行：
      - 防抖 3s（题目变更时立即触发，不等防抖）
      - 页面 visibilitychange → hidden 时立即触发
      - beforeunload 时用 navigator.sendBeacon 触发
      - 每 15s 心跳时顺带携带未同步的答案
```

### 4.3 批量协议

每次上行一个批次：

```ts
interface AnswerBatch {
  attemptId: number;
  clientSeq: number;          // 会话内单调递增，从 1 开始
  items: Array<{ questionId: number; payload: AnswerPayload }>;
  createdAt: string;          // ISO
}
```

- `clientSeq` 在**批次创建时**分配并持久化到 IndexedDB，**重放时保持不变**。这是幂等的关键：重放同一批不会重复计数，也不会丢。
- 服务端返回 `acceptedClientSeq`；本地删除 `clientSeq <= acceptedClientSeq` 的批次。

### 4.4 离线处理

```
检测到 offline（navigator.onLine + 请求失败双重判定）
  → 批次不删除，标记 queued
  → UI 显示「离线 · 待同步 N 条」
  → 恢复在线
  → 按 clientSeq 顺序重放
  → 失败（网络抖动）→ 指数退避重试（1s/2s/4s/8s，最多 5 次）
  → 重试耗尽 → 保留在队列，下次触发时继续
```

### 4.5 断点恢复

刷新页面后：

1. 从 Dexie 读 `attemptDraft`（含当前题号、答案、标记、clientSeq）。
2. 调用 `GET /attempts/{id}` 拿服务端状态与 `lastClientSeq`。
3. 对账：本地 `clientSeq > 服务端 lastClientSeq` 的批次保留待重放；服务端有而本地无的答案以服务端为准（并回填本地）。
4. 合并后恢复 UI。

> 对账方向很重要：**服务端是权威**。若本地有服务端没有的内容，说明上次没传上去，必须重放；若服务端有本地没有的内容，说明本地被清掉了，以服务端为准。

### 4.6 关闭页面

`beforeunload` 用 `navigator.sendBeacon('/api/v1/attempts/{id}/answers', blob)` 发送最后一批。`sendBeacon` 不支持自定义 `Authorization` 头，因此该端点额外接受 `?access_token=` 查询参数（仅限此端点，且令牌有效期短）。若 beacon 不可用，则依赖 L2 的 IndexedDB —— 刷新后依然不丢。

---

## 5. 服务端时钟权威

原型用本地倒计时，改系统时间即可绕过。本设计：

```
GET /api/v1/system/time  →  { serverTime, monotonicTime }
多次采样（间隔 1s，取 3 次）→ offset = median(serverTime - clientTime)
倒计时剩余 = (deadlineAt - (clientNow + offset)) / 1000
```

- `useServerTime` Hook 每 60 秒重新同步一次；切换考试时立即同步。
- 偏移突变超过 5 秒 → 提示用户"检测到本机时间异常，已以服务器时间为准"，并把 `driftDetected` 置真。
- 倒计时归零时**不信任本地判断**，调用交卷接口由服务端裁决（服务端会判定是 `time_up` 还是 `manual`）。
- 每 15 秒的心跳请求同时带回服务端时间，实现持续校准。

---

## 6. 防作弊交互

原型完全没有防作弊。本设计新增 `FocusGuard` 组件。

### 6.1 采集

| 事件 | 触发 | 是否计入切屏 |
|---|---|---|
| `window.blur` | 窗口失焦 | 是 |
| `visibilitychange → hidden` | 标签页隐藏 / 切到其他应用 | 是 |
| `fullscreenchange` | 退出全屏 | 是（仅当要求全屏） |
| `copy` | 复制 | 否（仅记录） |
| `paste` | 粘贴 | 否（仅记录） |
| `contextmenu` | 右键 | 否（仅记录） |

**关键实现约束**：

1. `blur` 与 `visibilitychange` 在切标签页时**会同时触发**，会造成重复计数。对策：合并到 500ms 窗口内去重（同一时间窗内的同类事件只计一次）。
2. 页面内 `alert`/`confirm`/开发者工具切换会触发 `blur`，属正常行为；因此计数需要服务端确认，客户端只上报不做判定。
3. 心跳超时（45s 未收到）由**服务端**判定为断连，计入断连次数而非切屏次数。

### 6.2 反馈与处置

```
切屏 1 次 → 顶部横幅「检测到切屏（第 1/3 次），请勿离开考试页面」
切屏 2 次 → 横幅升级为警告色 + 弹出模态提醒
达到 3 次  → 按 ExamRules.OnMaxFocusLoss：
             ForceSubmit → 服务端强制交卷，会话跳到成绩报告页，并显示强制交卷原因
             Warn        → 记录警告，继续作答（不再计数或计入 warning_count）
```

- 学生端每 3 秒轮询（或通过 SignalR 接收）服务端的切屏计数，避免客户端被篡改。
- 强制交卷时，`Attempt.SubmitReason = 'proctor_force'`，并在成绩报告标注原因。

### 6.3 水印

`Watermark` 组件在答题区叠加半透明文字水印（姓名 + 账号 + 时间戳），用 CSS `repeating-linear-gradient` 或绝对定位的重复文本节点实现，不影响交互（`pointer-events: none`）。

### 6.4 全屏

要求全屏时：
- 进入答题页提示"请进入全屏以开始考试"，提供"进入全屏"按钮。
- 全屏退出 → 计一次切屏 + 提示。
- 全屏 API 在部分环境不可用（iframe 限制），此时降级为提示模式并记录一次告警。

---

## 7. 实时监考大屏（管理端）

### 7.1 数据流

```
考生心跳（15s）→ 后端更新 Redis 活跃状态 → ProctoringBroadcaster 每 2s 聚合
  → SignalR 推送 ExamStatusBatch → 管理端 Zustand 更新 → 表格局部刷新
```

### 7.2 界面

- 顶部：场次信息、开始/结束时间、在线人数、已交卷人数、异常人数。
- 主表格：考生（姓名、账号、班级或"未分班"）、状态、切屏次数、断连次数、最后心跳、已答题数/总题数、最近动作。
- 异常高亮：切屏次数达上限、断连超限、心跳超时的行以警告色标出。
- 操作：警告（填消息）、备注、强制交卷（二次确认，必须填写原因）。
- 断线重连：SignalR 自动重连，重连后重新 `SubscribeExam` 并拉取一次全量快照。

### 7.3 性能

1000 考生时每 2 秒推送一批（约 1000 行 JSON，约 100 KB/2s = 50 KB/s），可接受。表格使用虚拟滚动（`@tanstack/react-virtual`）避免全量渲染 1000 行。

---

## 8. 路由与守卫

### 8.1 学生端路由（对齐原型）

| 路由 | 页面 | 守卫 |
|---|---|---|
| `/login` | 登录 | 匿名 |
| `/` | 工作台 | 登录 + student |
| `/practice` | 练习中心 | 登录 |
| `/practice/:assignmentId` | 练习作答 | 登录 |
| `/exams` | 考试安排 | 登录 |
| `/exams/:sessionId` | 考试答题 | 登录 + 在名单内 |
| `/exams/:sessionId/report` | 成绩报告 | 登录 |
| `/reports` | 成绩列表 | 登录 |
| `/mistakes` | 错题本 | 登录 |
| `/profile` | 个人中心 | 登录 |

### 8.2 管理端路由

`/overview`、`/tags`、`/banks`、`/banks/:bankId`、`/papers`、`/papers/:paperId`、`/exam-sessions`、`/exam-sessions/:id`、`/monitoring/:sessionId`、`/review`、`/analytics`、`/users`、`/audit-logs`。

守卫按权限点判定：`requirePermission('paper:publish')`。无权限时跳转到 403 页（不隐藏菜单后留空白页）。

### 8.3 路由级代码分割

每个 feature 目录 `React.lazy` 懒加载；考试答题页与管理端监考页单独 chunk，保证学生端首屏体积可控。

---

## 9. 可访问性

原型已有一批可访问性基础（skip link、`aria-live` toast、`:focus-visible`、图标 `aria-hidden`）。实现时补齐缺口：

| 缺口 | 修正 |
|---|---|
| 表格 `<th>` 无 `scope` | 加 `scope="col"` |
| 答题卡无当前项标识 | `aria-current="true"` |
| 模态框无焦点陷阱 | 原生 `<dialog>` + 初始焦点 + 焦点陷阱 + 关闭后焦点归还 |
| 倒计时不播报 | 视觉倒计时 `aria-hidden`，另设 `aria-live="polite"` 的分钟级播报（每 60 秒一次，避免刷屏） |
| 错误 toast 用 `role="status"` | 错误用 `role="alert"` |
| 图标按钮无文字 | 全部带 `aria-label` |
| 表单错误未关联 | `aria-describedby` + `aria-invalid` |

对比度：深浅主题下正文对比度 ≥ 4.5:1（原型承诺，落地时用脚本校验令牌组合）。

---

## 10. 性能预算与优化

| 指标 | 预算 |
|---|---|
| student 首屏 JS | ≤ 400 KB gzip |
| admin 首屏 JS | ≤ 700 KB gzip |
| LCP | < 2.0 s（本地） |
| 交互延迟 INP | < 200 ms |

手段：

- 路由级代码分割 + `React.lazy`。
- 图表组件自研，不引入 ECharts（省 ~300 KB gzip）。
- Zustand 选择器细粒度订阅，避免整表重渲染（原型已有该做法）。
- 答题页作答后**只做局部更新**（答题卡单元格 + 已答计数），不整页重渲染 —— 沿用原型的 `updateSessionUI` 思路，改为 React 状态订阅。
- TanStack Query 设置 `staleTime`：`student.reports` 5 分钟，`analytics` 1 分钟。
- 图片附件用 `loading="lazy"` + 缩略图。

---

## 11. 错误处理与提示

| 场景 | 表现 |
|---|---|
| 令牌过期 | 静默刷新 → 重放请求；刷新失败 → 跳登录页 |
| 无权限 | 403 页，说明缺少哪个权限点 |
| 业务规则失败（如组卷池不足） | 弹窗展示 `errorCode` 对应的结构化明细（缺口列表） |
| 字段校验失败 | 表单内联错误，聚焦第一个错误字段 |
| 网络失败（作答） | 顶部提示「保存失败，正在重试」，答案不丢 |
| 网络失败（其他） | Toast「网络异常，请稍后重试」+ 重试按钮 |
| 5xx | Toast + 显示 `traceId`，引导用户报障时提供 |

错误文案集中在 `shared/src/api/problemDetails.ts` 的错误码映射表，**不在组件里散落文案**。

---

## 12. 测试策略

| 层次 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | 格式化、图表计算、Markdown 净化、同步引擎的队列逻辑 |
| 组件 | Vitest + Testing Library | 题目渲染、答题卡状态、组卷规则表单、发布校验清单 |
| 集成 | Vitest + MSW | API 拦截，验证错误处理与重试 |
| 端到端 | Playwright | ① 登录 → 进入练习 → 作答 → 提交 → 看解析　② 教师组卷（规则抽题 → 发布）→ 阅卷 → 发布成绩 → 学生看到成绩　③ 考试中切屏 3 次 → 被强制交卷 |

端到端测试使用独立的测试数据库（Testcontainers）与独立的 Redis。

---

## 13. 与原型的差异清单

| 原型行为 | 本设计 | 原因 |
|---|---|---|
| 答案存 `localStorage` | IndexedDB + 服务端持久化 | 容量小、无法跨设备、无法防丢 |
| 本地倒计时 | 服务端权威时钟 | 改系统时间可绕过 |
| 无切屏检测 | `FocusGuard` 采集 + 服务端计数 | `claude.md` 明确要求 |
| 交卷写本地并本地判分 | 交卷服务端判分 | 公平性 |
| 组卷只有手工勾选 | 规则引擎 + 手工微调 | `claude.md` 明确要求 |
| 练习与考试共用同一存储键 | 分离 | 避免互相污染 |
| 无网络层 | 完整 API 客户端 | — |
| `store.save()` 每个按键都写 | 防抖 300ms 写 IndexedDB，3s 批量上行 | 性能 |
| 无离线处理 | 队列 + 重放 + 对账 | `claude.md` 明确要求 |
| 管理端无用户/角色管理 | 新增模块 | `claude.md` 要求 RBAC |
| 管理端无监考 | 新增实时监考大屏 | 已确认决策 |
| 图表用 `EX.chart` 生成 SVG | 自研 React SVG 组件 | 与 React 状态集成 |
| 深浅主题切换 | 保留，改用 `@theme` | 一致性 |

---

## 14. 本轮实现状态（2026-11-12）

原型已完整实现为两个可运行 SPA，详见 `docs/development/01-task-breakdown.md` 附录 A。

### 14.1 实际落地结构

```
frontend/shared/src/
├── design/theme.css          设计令牌（@theme static，与原型逐值一致）
├── design/primitives.css     语义化类基线（2003 行，含从原型移植的 86 个专有类）
├── domain/types.ts           实体与枚举（字符串 ID 口径）
├── domain/attempt.ts         答案载荷与作答批次
├── engine/random.ts          hash32 / mulberry32 / Fisher–Yates / autoSeed
├── engine/paper.ts           卷面构建（标准卷 / 小梅花 / 大梅花）
├── engine/scoring.ts         判分与阅卷回填
├── engine/blueprint.ts       配额矩阵抽题 + 分值分配
├── mock/seed.ts              示例数据（由原型 seed.js 求值转写）
├── mock/catalog.ts           内容仓库（Zustand + 纯函数读写）
├── mock/adminOps.ts          运维数据（场次 / 账号 / 审计 / 监考，原型无此四模块）
├── ui/                       27 个无业务 UI 原语
└── charts/                   4 张自研 SVG 图表
```

### 14.2 与本文各节的对齐说明

| 本文章节 | 落地位置 | 说明 |
|---|---|---|
| §4 作答可靠性四层 | `student/src/stores/draftQueue.ts`、`student/src/lib/syncEngine.ts` | 客户端未提交即进队列；重放保持 `clientSeq` 不变 |
| §5 服务端时钟权威 | `student/src/lib/useServerTime.ts`、`serverTimeSource.ts` | 采样取中位数；后端 `/api/v1/system/time` 已可用 |
| §6 防作弊交互 | `student/src/features/exam-taking/FocusGuard.ts`、`Watermark.tsx` | 500ms 窗口去重；练习不启用 |
| §7 实时监考大屏 | `admin/src/features/monitoring/ProctoringPage.tsx`、`useProctorFeed.ts` | SignalR 未就绪，暂用 2 秒批量轮询，轮询逻辑单独成 hook |
| §8 路由与守卫 | 两个 SPA 的 `router.tsx` | 全部 `React.lazy` 懒加载；刷新停留当前页。学生端 9 个路由、管理端 13 个路由 |
| §3 组卷向导 | `admin/src/features/papers/PaperWizardPage.tsx` | 四步 + **一键出卷**（配额矩阵确定性抽题，池量不足报错并列出缺口） |
| §9 可访问性 | `shared/src/ui/Field.tsx` | `Field` 的 `htmlFor` 与控件 `id` 程序化关联；51 处表单已补齐 |
| §2 设计令牌落地 | `shared/src/design/theme.css` + `primitives.css` | 与原型逐值一致，深浅主题均已验证 |

### 14.3 ID 口径

前端统一使用**字符串 ID**（`q-m-01` / `t-dom-calc` / `exam-net-mid` / `2023120101`），
与原型 mock 数据一致，也便于与后端 long 主键在 API 边界做映射。前端领域层不感知主键类型。
