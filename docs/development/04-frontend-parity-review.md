# 前端还原度审查（对照设计文档与原型）

> 审查对象：`feature/prototype-frontend` 分支上的两个 SPA（学生端 9 路由 + 管理端 13 路由）。
> 对照基准：`docs/design/01-requirements.md`、`docs/design/06-frontend.md`、
> `docs/ui-design/`（原型）。
> 结论：**页面骨架与交互骨架已到位**（路由、守卫、弹窗、空态、Toast、暗色主题、
> 路由级分割、渲染冒烟门禁都具备），但**样式移植、数据接线和若干需求条目**仍有缺口。
> 本文只列**可复现**的差距，每条都给出证据位置。
>
> **修复状态**：批次 A / B / C 已于 2026-11-13 完成，见文末 §7「修复记录」。
> 本文的 P0 / P1 编号保留为审查时的原始编号，便于对照。

---

## 0. 审查方法与已跑的验证

| 手段 | 作用 | 结果 |
|---|---|---|
| `pnpm -r typecheck` | 类型 | 通过，零错误 |
| `pnpm -r test` | 单元 + 组件 | 通过，172 例全绿（shared 105 / student 39 / admin 28） |
| `pnpm build` + `check-build-output` | 生产构建 | 通过，学生端首屏 73 KB gzip（预算 400 KB）、管理端 73 KB gzip（预算 700 KB） |
| `pnpm smoke:preview` | 真实浏览器逐路由渲染 | 22 个路由全绿，无白屏 / 无控制台错误 / 无失败请求 |
| **原型 vs 实现截图对照**（自建脚本，CDP 驱动） | 视觉还原度 | 20 组页面逐页截图对照，**发现 4 处肉眼可见的差异**（见 P1-1、P1-2、P1-5、P1-6） |
| **原型 vs 实现文案逐行 diff**（自建脚本，取 `innerText` 行集合做差） | 文案逐字一致性 | 11 个页面逐行比对，**发现 3 处文案/结构差异**（见 P1-3、P1-4、P2-3） |
| **CSS 规则全量解析比对**（自建脚本，正确解析 `@media` / `@layer`） | 样式移植完整性 | 原型 275 个类**全部有对应实现**，但**18 条 base 规则缺失**，其中 7 条直接导致可见错版 |
| **seed 重新生成并 diff** | 数据层是否与原型一致 | 数据层有**手工偏离**（P1-4、P2-2） |

> 上述三个自建脚本在 `/tmp`（`visual-parity.mjs` / `text-parity.mjs` / `css_parity3.py`），
> 未进仓库；建议把其中的「文案 diff」与「CSS 规则比对」固化进 `frontend/scripts/`，
> 作为和 `smoke-render.mjs` 同级的门禁（见 §5 批次 D）。

---

## 1. 总体结论

### 1.1 相对原型的还原度

| 维度 | 达成 | 说明 |
|---|---|---|
| 路由与页面清单 | 100% | 学生端 9 / 管理端 13 全部落地，路径与原型视图键一一对应 |
| 设计令牌 | 100% | `theme.css` 与原型 `tokens.css` 逐值一致，深浅两套都验证过 |
| 类名覆盖率 | 100% | 原型 275 个类名在实现中全部有对应规则 |
| **类规则完整性** | **97%** | 缺 7 条在用的规则（`.step*` 系列 + `.grid-main` 响应式 + `.wiz-picked-row` 响应式） |
| 交互骨架 | ~95% | 弹窗/确认/Toast/空态/标签页/答题卡都齐；题库工作台缺标签筛选、组卷列表缺标签列 |
| **数据接线** | **~85%** | seed 的 5 条历史成绩、每卷卷型配置、3 个标签、练习配分与原型不一致 |
| 文案逐字一致 | ~99% | 差异集中在 2 处（顶栏身份行、筛选分组标签的冒号） |
| 暗色主题 | 100% | 三处页面抽检无对比度/残留浅色问题 |
| 无障碍 | ~95% | 51 处 label 关联已补；焦点陷阱、`aria-live`、表格 `scope` 都到位；缺 e2e 覆盖 |

### 1.2 相对设计文档的达成度

**已完整落地**（抽样核实，非声称）：

- §4 作答可靠性四层：L1 内存 → L2 IndexedDB（防抖 300ms / 上限 1s）→ L3 上行队列 → L4 服务端；
  `clientSeq` 创建时分配、落盘、重放不变（`student/src/lib/syncEngine.ts`）
- §4.4 指数退避 1s/2s/4s/8s、最多 5 次（`syncEngine.ts:58`）
- §4.5 断点恢复对账：服务端 `lastClientSeq` 为权威，本地更大则重放（`lib/transports.ts:113`）
- §4.6 `beforeunload` 用 `navigator.sendBeacon` 兜底（`syncEngine.ts:398-425`）
- §5 服务端时钟：多采样取中位数，偏移突变 > 5s 置 `driftDetected`（`lib/useServerTime.ts:32-106`）
- §6 防作弊：`blur` / `visibilitychange` / `fullscreenchange` / `copy` / `paste` / `contextmenu`，
  500ms 窗口去重（`FocusGuard.ts`）；水印 `pointer-events: none`
- §3 状态分工：Zustand（内容/会话）+ TanStack Query（`staleTime` 学生 5 分钟 / 管理 1 分钟）
- §8 路由：两个 SPA 全部 `React.lazy`；403 / 404 页都在
- §9 可访问性：`Field` 的 `htmlFor` 与控件 `id` 关联、`ConfirmDialog` 消息容器为 `<div>`
- §10 性能：路由级分割后单页 chunk 均 < 33 KB，首屏 73 KB gzip
- §7 监考大屏：2 秒批量轮询 + 警告 / 备注 / 强制交卷（强制交卷强制填原因）

**未落地或仅骨架**（按设计文档条目）：

| 文档条目 | 现状 | 证据 |
|---|---|---|
| 路由守卫判定真实登录态 / 权限点 | **恒为放行**的骨架 | `student/src/app/guards.tsx:16-17`、`admin/src/app/guards.tsx:17` |
| §1.2 shared 的 `hooks/`（useOnline / useAutosave / useDebounced）、`utils/markdown.tsx`、`utils/download.ts` | 目录整体不存在 | `frontend/shared/src/` 下无 `hooks/`、无 `markdown.tsx`、无 `download.ts` |
| §5 API 客户端接线 | `shared/src/api/**` **零调用方**，全部数据来自 mock | 全仓 grep `httpClient` 只命中 `shared/src/api/` 自身 |
| §7.3 监考表格虚拟滚动（1000 考生） | 未引入 `@tanstack/react-virtual`，整表渲染 | `frontend/*/package.json` 无该依赖 |
| §12 端到端测试（Playwright 三条流程） | **完全缺失** | 仓库无 playwright 配置、无 e2e 目录 |
| FR-IAM-03 修改密码 / 重置密码 | 无任何界面与文案 | grep `修改密码\|changePassword` 零命中 |
| FR-AUD-03 导出单场次成绩 CSV | 无导出入口 | grep `csv\|export` 只命中导入批次 |
| FR-CAT-05 题目图片附件 | 无上传 / 无签名 URL | grep `attachment\|upload` 只命中上传队列 |
| FR-CAT-07 导入列映射**可编辑** | 列映射只读展示 | `admin/src/features/banks/BankWorkbenchPage.tsx:708-720` |
| FR-AUD-02 敏感数据脱敏 | 审计页未见脱敏逻辑 | `admin/src/features/audit/AuditLogPage.tsx` |
| FR-DLV-02 名单「全员开放」 | 未见 open 范围的建模与入口 | `shared/src/mock/catalog.ts:1444` 仅有文案 |

---

## 2. P0 —— 可见的错误状态（用户一眼能看出不对）

### P0-1 学生端「成绩报告」空、学期平均分 0、成绩趋势无曲线

- **现象**：`/reports` 显示「暂无成绩记录」；工作台「学期平均分 0 分（共 0 条记录）」；
  「成绩趋势」显示空状态。原型同页有 5 条成绩、平均分 76、趋势折线。
- **根因**：`shared/src/mock/catalog.ts:194-198` 把 seed 的 5 条 `records` 灌进了 store，
  但 `useStudentRecords()`（`student/src/features/shared/studentData.ts:64-95`）只读
  `attempts` 与 `practiceResults` 两个**空**字典，从不读 `records`。
- **影响**：FR-GRD-05 / FR-GRD-06 / FR-LRN-04 的学生侧视图全部失真；
  `ExamReportPage` 反而读了 `records`（`ExamReportPage.tsx:87`），于是「历史考试报告」有数据、
  「成绩列表」没有，同一个数据源两套口径。

### P0-2 管理端「组卷向导」步骤条渲染错乱

- **现象**：桌面宽度下四步向导竖排成四行文字，没有卡片、没有步骤序号圆点、没有当前步高亮。
- **根因**：`shared/src/design/primitives.css` **缺少** 7 条原型 base 规则：
  `.step` / `.step-btn` / `.step-btn:hover` / `.step-btn:focus-visible` / `.step-index` /
  `.step-label` / `.step.is-done .step-index`；同时原型 `@media (max-width:1023px)` 与
  `@media (max-width:767px)` 里的 `.steps { grid-template-columns: … }` 被**展平进 base 层**，
  覆盖掉四列布局，最终生效的是「一列」。
- **影响**：组卷向导（管理端最核心的 4 步流程）第一屏就破版；
  同批次丢的还有 `@media` 里的 `.grid-main`（概览页、场次详情页在用）与
  `.wiz-picked-row`（向导选题列表在用）的响应式规则。

### P0-3 管理端「成绩分析」把卷型显示成「标准卷」

- **现象**：`/analytics` 页头显示「高等数学期末考试 · 标准卷」，原型为「· 小梅花」。
- **根因**：`shared/src/mock/catalog.ts:198` 初始化 `plumCfg: {}`，
  从未用 seed 里每份试卷的 `plum` 填充；而 `plumCfgOf()`（`catalog.ts:854-856`）
  读不到就**兜底成 standard**。同一份试卷在答题页读的是 `exam.plum`（显示大梅花正确），
  在分析页读的是 `plumCfg`（显示标准卷）—— 两套卷型口径。

### P0-4 题库工作台缺「客观题 / 主观题**分值**拆分」（FR-CAT-06）

- **现象**：题库工作台两个统计卡显示「客观题 6 道 / 主观题 2 道」（**题量**）；
  原型显示「客观题分值 31 分 / 主观题分值 26 分」（**分值合计**）。
- **依据**：`docs/design/01-requirements.md` FR-CAT-06 明确要求
  「统计展示总数、已发布 / 草稿 / 已停用三态计数、**客观题与主观题分值拆分**」。
- **根因**：`admin/src/features/banks/BankWorkbenchPage.tsx:269-270` 统计的是题量，
  未按题目分值求和；原型 `admin-workbench.js:307-308` 求的是分值合计。

---

## 3. P1 —— 可见的偏差（不算破版，但与基准不一致）

| # | 现象 | 证据 |
|---|---|---|
| P1-1 | 答题页「标记」按钮显示为豆腐块（缺字形） | 用 emoji `🚩` 代替原型 SVG 图标：`ExamSessionPage.tsx:159`、`PracticeSessionPage.tsx:140`；渲染实测为方框 |
| P1-2 | 侧栏「错题本」角标写死 12，实际错题 5 条；管理端「阅卷中心」写死 7，概览页统计 10 | `student/src/app/nav.ts:31`（`count: 12`）、`admin/src/app/nav.ts:33`（`count: 7`）；原型是动态计算 |
| P1-3 | 顶栏身份行「2023120101 · 计算机科学 2023 级 1 班」，原型为「2023120101 · 名单组 A」 | `student/src/app/AppLayout.tsx:16` 硬编码字符串；班级名应取 `classes`（c2301 = 名单组 A） |
| P1-4 | 练习总分口径不同：原型「7 题 · 约 25 分钟 · 总分 39 分」（= 各题分值之和），实现「总分 70 分」（= 题数 × 10）；答题页同一题原型 5 分、实现 10 分 | `PracticeListPage.tsx:146` 用 `practice.totalScore`；`seed.ts` 练习无 `items`，配分靠兜底 10 |
| P1-5 | 题库工作台缺「标签筛选」整块（原型有领域/知识点/能力/难度 四组多选 chips） | 原型 `admin-workbench.js:189`；实现 `BankWorkbenchPage.tsx` 无该筛选块 |
| P1-6 | 题库工作台的 Tab 条退化成纯文字（原型是带边框的分段控件） | 截图对照；`.seg` / `.tabs` 变体在实现里未用于此处 |
| P1-7 | 筛选分组标签多了中文冒号：「领域：」「知识点：」，原型为「领域」「知识点」 | `shared/src/ui/TagFilter.tsx:42`（`{group.label}：`） |
| P1-8 | 练习总分的题量分组文案缺「· 知识点」后缀、组卷列表少了「标签」操作按钮、多了一列标签 chips | 文案 diff：`s-practice` / `a-papers` |
| P1-9 | 顶栏身份在窄屏折成两行（原型单行） | 截图对照（`user-chip` 宽度约束） |

---

## 4. P2 —— 已知取舍与可打磨项

| # | 项 | 说明 |
|---|---|---|
| P2-1 | 实现比原型多 3 个内容标签（数学基础 / 公式与计算 / 树与二叉树） | 标签页显示「共 37 个标签 / 161 次挂载」，原型「34 个 / 155 次」；是为一键出卷补的样例题标签，需在文档里记一笔 |
| P2-2 | `scripts/gen-seed.mjs` 与仓库里的 `seed.ts` 已经不同步 | 实跑生成器会**整份重写** `seed.ts`（65 KB vs 64 KB、格式与内容均不同）；而任务书称其「可复跑」 |
| P2-3 | 生成器路径是相对 CWD 的 `../../docs/...` | 必须在 `frontend/scripts` 下执行，仓库根执行直接报错 |
| P2-4 | `shared/src/api/**`（httpClient / authInterceptor / problemDetails）零调用方 | 后端就绪后才有意义，但目前属于「写了没接」 |
| P2-5 | 监考大屏表格无虚拟滚动 | 1000 考生时整表渲染 |
| P2-6 | 缺 Playwright 端到端测试（设计文档 §12 明确要求三条流程） | 仓库无 e2e 目录 |
| P2-7 | 原型遗留类 `.mcell` / `.matrix` 被部分移植，代码里无人使用 | 属原型死 CSS，可删可留 |
| P2-8 | 题目分值显示口径：实现显示试卷配分（10 分），原型显示题目自身分值（5 分） | **实现更正确**（FR-AUT-06 要求总分 = 各题分值之和，seed 试卷配分 10×10 = 100 = 总分）；原型自身 95 ≠ 100 是不一致。建议保留实现，在文档注明 |

---

## 5. 修改方案（分四批，每批独立可交付）

### 批次 A · 修错误状态（对应 P0，1 批改动，风险低）

| 改动 | 文件 | 说明 |
|---|---|---|
| A1 成绩记录接线 | `student/src/features/shared/studentData.ts` | `useStudentRecords()` 合并 store 里的 `records`（历史成绩）与 `attempts` / `practiceResults`（实时作答），按日期倒序；成绩列表、工作台平均分与趋势随之恢复 |
| A2 卷型配置接线 | `shared/src/mock/catalog.ts` | 初始化时用 `SEED.exams[].plum` 填充 `plumCfg`；或让 `plumCfgOf()` 直接读试卷的 `plum` 字段（推荐后者，少一处状态） |
| A3 题库统计口径 | `admin/src/features/banks/BankWorkbenchPage.tsx` | 「客观题分值 / 主观题分值」按题分值求和（原型 31 / 26） |
| A4 样式规则补齐 | `shared/src/design/primitives.css` | 补 7 条缺失 base 规则；把 `.steps` 的 2 列 / 1 列规则**放回** 1023px / 767px 媒体查询；补 `.grid-main` 与 `.wiz-picked-row` 的响应式规则 |

> A4 的验收口径很硬：截图对照必须与原型一致。
> 建议**同时补一条冒烟断言**：`/papers/exam-net-mid` 必须出现 4 个 `.step-btn` 且
> `.steps` 的 `grid-template-columns` 为 4 列。

### 批次 B · 修文案与数据偏差（对应 P1，改动小、面广）

| 改动 | 文件 | 说明 |
|---|---|---|
| B1 标记图标 | `ExamSessionPage.tsx` / `PracticeSessionPage.tsx` | 去掉 emoji，改用 `shared` 的 SVG 图标（原型 `EX.icon("flag")`） |
| B2 动态角标 | `student/src/app/nav.ts` / `admin/src/app/nav.ts` | 角标改为从 store 派生（错题数、待阅卷数），不再写死 |
| B3 顶栏身份 | `student/src/app/AppLayout.tsx` | 身份信息由「当前答题者 + 其班级组」派生，不再硬编码 |
| B4 练习配分 | `shared/src/mock/seed.ts` / `engine/paper.ts` | 练习卷分值改按题目自身分值（与原型一致），`totalScore` 同步为 Σ 分值；或给练习补显式 `items` 并同步前端展示，两种口径**二选一**，需拍板 |
| B5 筛选冒号 | `shared/src/ui/TagFilter.tsx` | 去掉分组标签后的「：」 |
| B6 题库标签筛选 | `admin/src/features/banks/BankWorkbenchPage.tsx` | 补回原型「标签筛选」四组多选（含 FR-CAT-02 的「包含子标签」开关与 OR/AND 语义） |
| B7 Tab 条外观 | `BankWorkbenchPage.tsx` | 三 Tab 改用原型分段控件外观 |
| B8 组卷列表标签列 | `admin/src/features/papers/PaperListPage.tsx` | 标签列与「标签」操作按钮对齐原型 |

### 批次 C · 补设计文档要求（对应 P1/P2 的功能缺口，工作量最大）

按性价比排序，可拆成独立 PR：

1. **C1 路由守卫真实化**（§8.2）：`guards.tsx` 接入 `/auth/me` 与权限点，未登录跳 `/login`、无权限跳 `/403` 并显示缺哪个权限点
2. **C2 成绩导出 CSV**（FR-AUD-03）：`shared/src/utils/download.ts` + 场次详情页导出按钮
3. **C3 修改密码 / 重置密码**（FR-IAM-03）：学生端个人中心 + 管理端用户页
4. **C4 导入列映射可编辑 + 真实 CSV/XLSX 解析**（FR-CAT-07 / 已确认决策 9）
5. **C5 题目附件上传**（FR-CAT-05）
6. **C6 监考表格虚拟滚动**（§7.3）：`@tanstack/react-virtual`
7. **C7 端到端测试**（§12）：Playwright 三条流程（练习闭环 / 组卷→阅卷→发分 / 切屏三次强制交卷）
8. **C8 API 层接线**：把 `shared/src/api` 接到各页（TanStack Query），后端就绪即生效

### 批次 D · 把本次审查固化成门禁

- `frontend/scripts/compare-prototype.mjs`：复用本次的**原型 ↔ 实现文案 diff** 与 **CSS 规则比对**，
  在 CI 里作为「原型一致性」门禁，防止再次漏移植
- 扩充 `smoke-render.mjs` 的断言：步骤条列数、成绩列表条数、卷型文案、标签筛选块存在性
- 修正 `scripts/gen-seed.mjs` 的路径与输出，使其与仓库内 `seed.ts` 一致（或明确标注「生成器已废弃」）

---

## 6. 建议的执行顺序

1. 先做**批次 A**（P0 全部）—— 4 处改动，其中 A4 是样式，改完立刻用截图对照复验
2. 再做**批次 B**（P1 全部）—— 8 处改动，纯文案 / 数据 / 交互细节
3. **批次 C** 按需求优先级逐项做，每项单独 PR
4. **批次 D** 收尾，把门禁固化

> 每批结束都跑：`pnpm -r typecheck` → `pnpm -r test` → `pnpm build` → `pnpm smoke:preview`，
> 并补一条本次新增的专项断言。

---

## 7. 修复记录（2026-11-13）

按确认的「批次 A + B + C 全部」执行，每批独立验证。

### 批次 A · P0（4 处，全部修完）

| # | 改动 | 位置 | 验证 |
|---|---|---|---|
| A1 | 成绩记录接线：`useStudentRecords()` 合并 seed 的 `records` 与实时 `attempts` / `practiceResults` | `student/src/features/shared/studentData.ts` | `/reports` 恢复 5 条记录，工作台平均分 76、趋势折线回来 |
| A2 | 卷型配置接线：`plumCfgOf()` 先查人工覆盖、再查试卷自身的 `plum` | `shared/src/mock/catalog.ts` | 成绩分析页显示「小梅花」，不再是「标准卷」 |
| A3 | 题库统计按**分值合计**（FR-CAT-06） | `shared/src/mock/catalog.ts`、`admin/.../BankWorkbenchPage.tsx` | 题库工作台显示「客观题分值 31 分 / 主观题分值 26 分」 |
| A4 | 样式补齐：补 `.step` / `.step-btn` / `.step-index` / `.step-label` 等 7 条缺失规则，把被展平的 `.steps` 响应式规则放回 1023px / 767px 媒体查询，补 `.grid-main` 与 `.wiz-picked-row` 的响应式规则 | `shared/src/design/primitives.css` | 组卷向导恢复四列步骤条（截图对照一致） |

### 批次 B · P1（9 处，全部修完）

| # | 改动 | 位置 |
|---|---|---|
| B1 | 标记按钮去掉 emoji `🚩`（渲染成豆腐块），改用原型 `ICON_BODY` 的 flag SVG | `student/src/app/Icon.tsx`、`admin/src/app/Icon.tsx`、`ExamBar.tsx` |
| B2 | 侧栏角标改为动态：错题本取当前答题者的错题数、阅卷中心取待阅卷数，删除写死的 12 / 7 | `student/src/app/AppLayout.tsx`、`admin/src/app/AppLayout.tsx` |
| B3 | 顶栏身份由数据派生（学生 + 名单组 / 登录态），不再硬编码 | 同上 |
| B4 | 练习配分按**题目自身分值**（与原型一致），总分 = Σ 分值 | `shared/src/mock/seed.ts` |
| B5 | 筛选分组标签去掉中文冒号 | `shared/src/ui/TagFilter.tsx` |
| B6 | 题库工作台补「标签筛选」块（领域 + 能力多选，任一命中） | `admin/.../BankWorkbenchPage.tsx` |
| B7 | 分段控件选中态：补 `aria-pressed`（原型 `.seg` 的选择器），三 Tab 恢复高亮 | `shared/src/ui/Tabs.tsx` |
| B8 | 组卷列表补「标签」操作按钮与标签编辑弹窗（文案照抄原型） | `admin/.../PaperListPage.tsx` |
| B9 | 题库清单未复制原型的「覆盖维度」列 —— 该列与「标签」列数据重复，属原型冗余，实现不复制 | — |

### 批次 C · 设计文档要求的功能缺口（8 项）

| # | 改动 | 依据 | 位置 |
|---|---|---|---|
| C1 | 路由守卫真实化：登录态、角色、**权限点**判定；403 页说明缺哪个权限点；登录页真登录；顶栏加登出 | §8.2 / §11 / FR-IAM-01 | `shared/src/auth/**`、两端 `guards.tsx`、`errors.tsx`、`LoginPage.tsx` |
| C2 | 场次成绩导出 CSV（带 BOM，Excel 直接打开） | FR-AUD-03 | `shared/src/utils/download.ts`、`admin/.../ExamSessionDetailPage.tsx` |
| C3 | 修改密码（学生端个人中心）与重置密码（管理端用户页，强制下次登录修改，留审计） | FR-IAM-03 | `ProfilePage.tsx`、`UsersPage.tsx` |
| C4 | 真实文件解析：CSV（含 GBK 兜底）与 XLSX（**零依赖**：浏览器内置解压 + DOMParser）；列映射**可编辑**；逐行校验、错误行标红并给出原因、不阻断整批 | FR-CAT-07 / 已确认决策 9 | `admin/.../importFile.ts`（含 8 个单测）、`BankWorkbenchPage.tsx` |
| C5 | 题目附件：png / jpg / webp、单文件 ≤ 10 MB，缩略图与移除；附件走访问地址（后端为短期签名 URL） | FR-CAT-05 | `shared/src/domain/types.ts`、`shared/src/utils/attachments.ts`、`QuestionEditor.tsx` |
| C6 | 监考表格虚拟滚动（`@tanstack/react-virtual`），1000 考生不整表渲染 | §7.3 | `admin/.../ProctoringPage.tsx` |
| C7 | Playwright 端到端测试：① 练习闭环、② 内容工作台 / 组卷向导 / 阅卷队列、③ 切屏采集与分级反馈（后端相关的两段用 `test.skip` 标注原因） | §12 | `frontend/e2e/**`、`playwright.config.ts` |
| C8 | 数据源开关：`VITE_DATA_SOURCE=http`（或设 `VITE_API_BASE_URL`）后，登录态、答案上行、监考快照、内容目录都走后端，**页面代码不感知** | §3 / 05-api.md | `shared/src/api/dataSource.ts`、`catalogApi.ts`、两端 `providers.tsx`、`useExamSession.ts`、`usePracticeSession.ts`、`useProctorFeed.ts` |


> **2026-11-16 联调补记（修正 C8 的范围）**：http 通路目前覆盖登录/刷新/登出/改密、
> 内容目录读取、监考快照与答案上行；**考试作答主流程仍从 mock 试卷建卷**，
> 未调用 `POST /attempts`，也未上报 focus-events / submit / heartbeat；
> 管理端场次、用户、审计、阅卷与监考的写操作仍走 `useAdminOps`。
> 前端适配层（`ENDPOINTS` / `httpClient` / `catalogApi` / `answerPayload`）
> 与真实后端的契约测试见 `frontend/e2e/frontend-contract.api.spec.ts`。
>
> **2026-11-16 第二轮补记（权限与范围）**：两端新增**强制改密**流程——
> 管理员重置密码或导入名单后，令牌带「必须改密」标记，
> 路由守卫把这类用户送到 `/change-password`（`ChangePasswordForm` 为两端共用组件），
> 改密成功后换发的新令牌立即恢复通行。学生可见的**考试场次**已由后端按对象级范围给出，
> 前端适配层 `shared/src/api/examSessionApi.ts`（`loadMyExamSessions`）就位；
> 但学生端的「考试安排」页仍读 mock 目录，等作答主流程 http 化后一并切换。

### 顺带修掉的门禁问题

- `pnpm lint` 在根级脚本（`scripts/*.mjs`）上一直报 `console` / `process` 未定义 —— **CI 的 lint 门禁此前是红的**。已在 `eslint.config.js` 给 `.mjs` 补上 node 环境。
- 抽出 `scripts/serve-dist.mjs`：渲染冒烟与端到端共用同一份「与 nginx 布局一致」的静态服务器。

### 修复后的门禁状态

#### 第三轮 · 修复后的门禁状态

| 门禁 | 结果 |
|---|---|
| `pnpm -r typecheck` | 零错误 |
| `pnpm lint` | 零错误（5 条既有的 fast-refresh 警告） |
| `pnpm -r test` | 214 例全绿（shared 119 / student 50 / admin 45） |
| `pnpm build` | 通过，学生端首屏 73 KB gzip、管理端 73 KB gzip |
| `pnpm smoke:preview` | 22 个路由全绿 |
| `pnpm e2e` | 6 例通过、2 例按原因跳过（新增「人员名单批量导入」一例） |

#### 第四轮 · 修复后的门禁状态

| 门禁 | 结果 |
|---|---|
| `pnpm -r typecheck` | 零错误 |
| `pnpm lint` | 零错误（5 条既有的 fast-refresh 警告） |
| `pnpm -r test` | 225 例全绿（shared 119 / student 60 / admin 46） |
| `pnpm build` | 通过 |
| `pnpm smoke:preview` | 22 个路由全绿 |
| `pnpm e2e` | 6 例通过、2 例按原因跳过 |

### 第二轮 · 复审发现的缺口（追加修复）

第一轮修完后又做了一轮复审（重新跑截图 + 文案 diff + 数据流核对），发现并修掉以下问题。

#### 学生端

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| S1 | 错题重做落到「练习不存在」：`/practice/single-{qid}` 没有对应会话 | `usePracticeSession` 识别 `single-` 前缀，就地造一个只含该题的练习（立即反馈、可重做、答对即移出错题本） | `student/src/features/exam-taking/usePracticeSession.ts` |
| S2 | 练习没有即时反馈：`feedback = "immediate"` 的练习答完不给判定 | `PracticeSessionPage` 补 `ImmediateFeedback`：正确 / 部分正确 / 错误 / 未作答 + 你的答案 / 正确答案 / 得分 / 作答要点 / 参考答案 / 解析 | `student/src/features/exam-taking/PracticeSessionPage.tsx` |
| S3 | 倒计时归零不自动交卷 | `useExamSession` 在 `blocked === "time_up"` 时自动交卷（首帧守卫，避免一进页面就交） | `student/src/features/exam-taking/useExamSession.ts` |
| S4 | 「重新作答 / 再考一次」没有真正重开一次 | `examSessionStore` 补 `resetForRetake()`：清作答、清标记、清已交卷与截止时间，保留试卷与题号 | `student/src/stores/examSessionStore.ts` |
| S5 | 尝试次数恒为 1 | `attemptNo` 改为按 catalog 的 attempts 推算 | `student/src/features/exam-taking/useExamSession.ts` |

#### 管理端

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| M1 | 组卷向导「按蓝图生成」直接覆盖卷面，没有差异确认 | 先算差异（新增 / 移除 / 分值变化），用弹窗列出后确认才替换 | `admin/src/features/papers/PaperWizardPage.tsx` |
| M2 | 发布校验的「提醒项」（主观题分值占比、时长匹配）被当成错误拦住发布，且没有覆盖理由 | 校验项分级为「未通过 / 警告」，警告项可填写覆盖理由后发布；理由随试卷一起存（`ExamPaper.overrideReasons`） | `admin/src/features/papers/PaperWizardPage.tsx`、`shared/src/mock/catalog.ts` |
| M3 | 套用模板时把已停用题目也带进新卷 | 跳过非「已发布」题目，并提示跳过了几道 | `admin/src/features/papers/PaperWizardPage.tsx` |
| M4 | 场次发布时用的是**页面上正在填的表单**名单（跨场次串号） | 发布时物化**目标场次自己的** scope / directUserIds | `admin/src/features/sessions/ExamSessionListPage.tsx` |
| M5 | 场次名单只有「组织标签 / 全员开放」，缺「指定考生」 | 补第三种纳入方式，逐个勾选考生（含社会人士） | `admin/src/features/sessions/ExamSessionListPage.tsx` |
| M6 | 场次详情页的「名单来源」不显示指定考生 | 名单来源按「指定考生 → 组织标签 → 全员开放」顺序显示 | `admin/src/features/sessions/ExamSessionDetailPage.tsx` |
| M7 | 批量发布 / 批量丢弃只给一个总数，失败原因看不到 | 改用 `setQuestionsStatus` / `discardQuestions`，逐条列出成功与失败原因 | `admin/src/features/banks/BankWorkbenchPage.tsx`、`shared/src/mock/catalog.ts` |
| M8 | 题目状态流转的批量结果不完整 | `setQuestionsStatus` 返回逐条结果；新增 `discardQuestions` | `shared/src/mock/catalog.ts` |

#### 设计文档缺口（第二轮追加）

| # | 需求 | 修复 | 位置 |
|---|---|---|---|
| C9 | **FR-IAM-05 人员名单批量导入**：CSV 逐行校验、账号重复跳过、已存在账号走更新、组织维度标签自动创建、角色按班级推断、写审计 | 新增 `shared/src/mock/roster.ts`（解析 / 校验 / 导入三段）+ 用户页「批量导入」弹窗（预览标红、失败明细、初始密码一次性回显）；组织标签改为进 store，可按层级自动扩充 | `shared/src/mock/roster.ts`、`shared/src/mock/adminOps.ts`、`admin/src/features/users/UsersPage.tsx` |
| C10 | **CSV 解析复用**：试题导入与名单导入应共用一套解析（含 GBK 兜底） | 抽出 `shared/src/utils/csv.ts`（`parseCsv` / `decodeCsvBuffer`），两处都走它 | `shared/src/utils/csv.ts` |

> 名词口径澄清（FR-IAM-05 原文「账号重复…跳过」与「已存在的账号执行更新」并存）：
> **文件内重复**的行标红跳过；**系统中已存在**的账号走更新，不报错、不重置密码。

#### 顺带修正

- `shared/src/design/theme.css` 头部注释把动效时长工具类写成 `duration-120`，实际是 `duration-1`（`--transition-duration-1`），已改。
- `shared/src/mock/adminOps.ts` 的组织维度标签从模块常量改为 store 里的数据，才能「自动创建并按层级挂接」。

### 第三轮 · 三份并行审计后的共享层修复（2026-11-13）

本轮把「共享设计层 + 前端契约」「管理端」「学生端」三份审计报告的发现集中落到代码里。
共享层（`frontend/shared`）是三份报告的公共底座，因此先修它，再由两个应用各自的报告补页面。

#### 共享层 · 语义与口径

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| SH1 | `preflight` 多出一条恒有的「对象存在」行，且 5 条 detail 文案与阈值分母都与原型不同 | 按原型 `catalog.js:1051-1177` 重写：8 项校验、detail 逐字对齐、时长按「每分耗时」用**目标总分**做分母（不再用题分之和）、空卷判失败 | `shared/src/mock/catalog.ts` |
| SH2 | 发布校验的警告项（主观题占比 / 时长匹配）与错误项同级，练习卷也算占比 | 保留设计文档 §4.4 的 `Blocking / Warning` 分级；练习卷的占比豁免照原型 `mixOk = kind === "practice"` | `shared/src/mock/catalog.ts` |
| SH3 | `bankStats` 的客观 / 主观统计是**题量**，原型是**分值合计** | 改为分值合计，题量另有 `total / published / draft / disabled` 三个计数 | `shared/src/mock/catalog.ts` |
| SH4 | `updateTag` 改名后不重算难度等级 | 难度分组改名时按名称重算 `level`（未知名称兜底「中等」） | `shared/src/mock/catalog.ts` |
| SH5 | `upsertQuestion` 忽略传入的 `status`、保留旧解析、允许非整数分值 | 状态按 `input.status` 流转、解析按提交值覆盖（缺省即清空）、分值钳到 1..40 并对齐 0.5 步进 | `shared/src/mock/catalog.ts` |
| SH6 | `createExam` / `createPractice` 名称为空直接报错 | 原型 `catalog.js:998/1025` 是兜底「未命名试卷 / 未命名练习」，改为兜底；练习默认时长由 30 改回原型的 20 分钟 | `shared/src/mock/catalog.ts` |
| SH7 | `validateTags` 的校验顺序与原型不同（先判上限再判重复） | 按原型顺序：去空 → 查重复 → 查无效 → 最后查上限；否则同一份数据会报出不同文案 | `shared/src/mock/catalog.ts` |
| SH8 | 9 处提示文案措辞与原型不一致 | 逐条照抄原型：标签不存在 / 对象不存在 / 请至少勾选一个正确答案 / 单选题只能有一个正确答案 / 多选题至少需要两个正确答案 / 请至少填写一个评分要点 / 请至少填写一个评分步骤 | `shared/src/mock/catalog.ts` |
| SH9 | AI 生成忽略请求的题型与难度 | 按请求的题型过滤样本池，并追加对应难度标签（较难 6 分 / 其余 5 分） | `shared/src/mock/catalog.ts` |
| SH10 | 难度标签改名后等级不跟随 | `createTag` / `updateTag` 统一走 `difficultyLevelByName()` | `shared/src/mock/catalog.ts` |
| SH11 | 缺 `setEntityTags`（试卷 / 练习写标签） | 新增，标签走同一套校验（去重、过滤无效、上限 5） | `shared/src/mock/catalog.ts` |
| SH12 | `AttemptStatus` / `SubmitReason` 与设计文档 §5.3 不符 | 补齐 6 个作答状态（含自动交卷 / 强制交卷 / 放弃）与 5 个交卷原因（含网络超时） | `shared/src/domain/attempt.ts` |
| SH13 | `domain/attempt.ts` 与 `domain/types.ts` 重复导出 8 个同名但形状不兼容的类型 | 删除重复定义，`attempt.ts` 只转出 `QuestionType` | `shared/src/domain/attempt.ts`、`shared/src/domain/index.ts` |
| SH14 | `shared/package.json` 的 exports 只映射 2 个子路径 | 补齐实际被 import 的全部子路径（`/api`、`/domain/types`、`/engine*`、`/mock/*`、`/ui`、`/utils`…） | `shared/package.json` |
| SH15 | `DIFFICULTY_LABEL` 在 catalog 与 engine 各写一份 | 收敛到 `engine/paper.ts` 单一来源，catalog 侧转出 | `shared/src/engine/paper.ts`、`shared/src/mock/catalog.ts` |

#### 共享层 · UI 原语与样式

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| SH16 | 难度片只在有值时渲染，标签不包 `.tag-chips`、无溢出 `+N` | 难度片恒存在（无值取「中等」），标签包进 `.tag-chips` 并按上限溢出为 `+N` | `shared/src/ui/QuestionHead.tsx` |
| SH17 | `OptionList` 的 radio 按**选项键**分组，同屏多题会互相取消选择 | 缺省按组件实例分组；`groupKey` 显式传题目 ID | `shared/src/ui/OptionList.tsx` |
| SH18 | `RuleList` 的编号被 `aria-hidden` 挡住，`.kp-mark` 也被隐藏 | 编号与命中标记恢复可播报 | `shared/src/ui/RuleList.tsx`、`shared/src/ui/KeypointList.tsx` |
| SH19 | `Field` 必填态对屏幕阅读器不可见；无控件时渲染孤儿 `label` | 必填时把 `aria-required` 注入唯一子控件；无 `htmlFor` 时退化为 `span`（原型 `admin.js:261` 同款） | `shared/src/ui/Field.tsx` |
| SH20 | `Callout` 恒为信息蓝、原型的前置图标全丢 | 缺省色调改回原型的主色底，补 `icon` 前置位 | `shared/src/ui/Callout.tsx` |
| SH21 | `Tabs` 的分段控件没有选中态 | seg 分支补 `aria-pressed` | `shared/src/ui/Tabs.tsx` |
| SH22 | `Stat` / `Empty` / `ConfirmDialog` / `AnswerSheet` 的标签元素与原型不一致 | span ↔ div 对齐原型；答题卡回到「`.answer-sheet` + `.sheet-legend`」两个平级节点 | `shared/src/ui/{Stat,Empty,ConfirmDialog,AnswerSheet}.tsx` |
| SH23 | `BarRow` 的 `truncate` 是可选的，原型恒定截断 | 恒挂 `.od-truncate` | `shared/src/ui/BarRow.tsx` |
| SH24 | `IconButton` 的 `size` 产出 `.icon-btn.is-sm`，但样式表里没有这条规则 | 去掉 `size`，恒用 `.icon-btn` | `shared/src/ui/IconButton.tsx` |
| SH25 | 答题卡图例与格子粘连 | `.sheet-legend` 补 `margin-top`（原型的内联样式，CSS 版不写内联样式） | `shared/src/design/primitives.css` |
| SH26 | `.mcell` 系列的孤儿规则 | 删除无原型出处的两条（原型 `.mcell` 本身是死 CSS，不动） | `shared/src/design/primitives.css` |
| SH27 | `theme.css` 头部注释写错工具类名 | `duration-120` 改 `duration-1`，并说明 `--spacing` 基准未被覆盖 | `shared/src/design/theme.css` |
| SH28 | `IMPLEMENTATION.md` 的原语数与领域类型出口与代码对不上 | 27 → 30 个原语；补 `@exam/shared/domain/types` 出口说明 | `frontend/IMPLEMENTATION.md` |
| SH29 | 共享层丢了公共图标所有权：原型只有**一份** `ICON_BODY`，实现拆成学生端 16 个 + 管理端 40 个两份副本，端口径会漂移 | 图标表收敛到共享层 `ui/Icon.tsx`（42 个图标，照抄原型 `app.js:141-191`），两个应用的 `app/Icon.tsx` 改为转出 | `shared/src/ui/Icon.tsx`、`student/src/app/Icon.tsx`、`admin/src/app/Icon.tsx` |

#### 管理端（本轮由两个并行代理协作完成）

三份审计报告的管理端部分共 34 条（P0 11 + P1 23），全部处理完毕。

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| A1 | 题库对话框没有「题目清单」，新建题库无法挑题 | 按题型分组勾选 + 「已选 N 题」实时计数，落 `questionIds` | `admin/src/features/banks/BanksPage.tsx` |
| A2 | 题库编辑没有深链入口 | 支持 `/banks?edit={id}` 直接打开编辑框 | `admin/src/features/banks/BanksPage.tsx` |
| A3 | 题库清单缺「覆盖维度」列 | 补列，标签名以「、」拼接 | `admin/src/features/banks/BanksPage.tsx` |
| A4 | 题目编辑器切换题型后下半区残留旧结构 | 切题型重建选项 / 评分要点 / 评分步骤；判断题固定「正确 / 错误」两项 | `admin/src/features/shared/QuestionEditor.tsx` |
| A5 | 编辑器缺题号校验 | 补「请填写题目编号」与「题号 {id} 已存在，请更换」 | `admin/src/features/shared/QuestionEditor.tsx` |
| A6 | 关键词分隔符与原型不同 | 改 `[,，;；]`（原型 `admin.js:1053`） | `admin/src/features/shared/QuestionEditor.tsx` |
| A7 | 阅卷详情缺「知识点」标签 | 知识点分组优先，无则回退领域 | `admin/src/features/review/ReviewCenterPage.tsx` |
| A8 | 阅卷批量采纳没有二次确认 | 补确认弹窗 | `admin/src/features/review/ReviewCenterPage.tsx` |
| A9 | 上一份 / 下一份到边界不回绕 | 改为 `(index + delta + list.length) % list.length` | `admin/src/features/review/ReviewCenterPage.tsx` |
| A10 | 题目丢失与「没有需要阅卷的作答」共用空态 | 拆出专门的「题目已不存在」 | `admin/src/features/review/ReviewCenterPage.tsx` |
| A11 | 批量发布 / 丢弃没有空选保护 | 补「请先选择候选题」；批量丢弃补二次确认 | `admin/src/features/banks/BankWorkbenchPage.tsx` |
| A12 | 丢弃与删除共用一套确认文案 | 拆成「将丢弃题目…丢弃后不可恢复」与「将删除题目…操作不可撤销」两套 | `admin/src/features/banks/BankWorkbenchPage.tsx` |
| A13 | 组卷向导不分考试 / 练习 | 分两套步骤（原型 `admin-workbench.js:55-68`） | `admin/src/features/papers/PaperWizardPage.tsx` |
| A14 | 「题库」「题型」是单选下拉 | 换 `MultiSelect` 多选 + 原型说明文字 | `admin/src/features/shared/MultiSelect.tsx`（新建）、`admin/src/features/papers/PaperWizardPage.tsx` |
| A15 | 题序规则的选项文案与描述不对 | 照抄 `catalog.js:922-933` 的 label / desc，并补切换 toast | `admin/src/features/papers/PaperWizardPage.tsx` |
| A16 | 套用模板会带进已停用题目 | 过滤未发布题目，并提示跳过几道；同步卷型 | `admin/src/features/papers/PaperWizardPage.tsx` |
| A17 | 卷型卡用了引擎的长描述 | 改原型专用短文案 + 补「置换口径」长文案与粒度说明 | `admin/src/features/papers/PaperWizardPage.tsx` |
| A18 | 第 4 步的「允许重考」「答案公布时机」离开该步就丢 | 离开该步与发布时都回写 | `admin/src/features/papers/PaperWizardPage.tsx` |
| A19 | 概览页「查看」跳到新建页凭空造卷 | 改为 toast「{name}：{modeLabel} · {n} 题 · {m} 分钟」 | `admin/src/features/overview/OverviewPage.tsx` |
| A20 | 成绩分析「卷面」跳通用向导 | 改为打开**该答题者本人**的卷面弹窗 | `admin/src/features/analytics/AnalyticsPage.tsx` |
| A21 | 练习列表列头是考试列头 | 改「开放范围 / 可重复次数」，并按 kind 调列序 | `admin/src/features/papers/PaperListPage.tsx` |
| A22 | 标签删除确认缺挂载明细 | 补总数与题目 / 题库 / 试卷 / 练习四项 | `admin/src/features/tags/TagsPage.tsx` |
| A23 | 三处按钮文案不是「保存 X」 | 改「保存题库」「保存标签」「保存题目」 | `admin/src/features/{banks, tags, shared}/` |
| A24 | 实体标签只在列表页有入口 | 抽出 `EntityTagsDialog`，列表行与**向导页头**共用（原型 `admin-workbench.js:806`） | `admin/src/features/shared/EntityTagsDialog.tsx`（新建） |
| A25 | 题目来源徽标 | 管理端用本地词表「导入」（原型 `admin-workbench.js:78`） | `admin/src/features/shared/bits.tsx` |
| A26 | 侧栏「阅卷中心」角标写死 7 | 改为按待阅卷数动态算 | `admin/src/app/nav.ts`、`admin/src/app/AppLayout.tsx` |
| A27 | 11 处 toast 文案被改写 | 逐条照抄原型 | 管理端各页 |
| A28 | 5 处原型 callout 用了信息蓝、且丢了前置图标 | 改回原型默认主色底 + 补 `info` / `alert` 图标 | 管理端 3 个页面 |
| A29 | 按**步骤**阅卷的卷宗没有评分卡，只渲染了「评分要点命中」卡 | 补「步骤评分」卡：标题「步骤评分」、副标「系统初判 {score} / {max} 分」、列出该步骤的 prompt 与命中标记；`autoScoreOf` 的步骤分支改为返回步骤本体（对齐原型 `admin.js:483`） | `admin/src/features/review/ReviewCenterPage.tsx` |
| A30 | 2 处 toast 不是原型文案 | 发布校验失败改「仍有 {n} 项校验未通过，无法发布」；保存模板补空题库守卫「请先选择题目再保存模板」（原型 `admin-workbench.js:1577` / `:1777`） | `admin/src/features/papers/PaperWizardPage.tsx` |

> **P1-17（`publishAnswer` 值域）不改**：审计说应与原型的 `immediately` 一致，但
> `docs/design/05-api.md:756` 明确写「原型 `immediately` → API `on_open`」——
> `on_open` 才是**符合 API 契约**的值，改成 `immediately` 会让前端与 API 契约脱节。
> 真正待做的是「API `on_open` → DB `immediately`」的翻译层，要等后端有字段才能落地。

#### 学生端（本轮由两个并行代理协作完成 + 主控补尾）

学生端审计 8 条 P0 与 23 条 P1 全部处理完毕。其中代理在完成大部分后因用量上限中断，
剩余部分（会话持久化、重置清成绩、逐题解析口径、题号/卷号、图标与 toast）由主控补齐。

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| S1 | 错题重做落到「练习不存在」 | `single-` 前缀识别，就地造只含该题的练习 | `student/src/features/exam-taking/usePracticeSession.ts` |
| S2 | 练习没有即时反馈 | `feedback = "immediate"` 的练习答完给判定 + 解析 | `student/src/features/exam-taking/PracticeSessionPage.tsx` |
| S3 | 倒计时归零不自动交卷 | `blocked === "time_up"` 时自动交卷（带首帧守卫） | `student/src/features/exam-taking/useExamSession.ts` |
| S4 | 「重新作答 / 再考一次」没真正重开 | `resetForRetake` 清作答、清标记、清已交卷与截止时间，作答次序自增 | `student/src/stores/examSessionStore.ts` |
| S5 | 尝试次数恒为 1 | `attemptNo` 按已有记录推算 | `student/src/features/exam-taking/useExamSession.ts` |
| S6 | 会话状态不持久化，刷新即丢答案、计时器重置 | 会话按「考试 × 答题者」归档并落盘；同一份会话刷新后恢复，倒计时按绝对 `deadlineAt` 续算 | `student/src/stores/examSessionStore.ts` |
| S7 | 练习会话同样不持久化 | 补齐归档 + `persist`（键 `zhixing.student.practiceSessions.v1`） | `student/src/stores/practiceSessionStore.ts` |
| S8 | 切屏强制交卷不落库 | 达到上限改调 `submit()`，attempt 落库并跳成绩报告 | `student/src/features/exam-taking/useExamSession.ts` |
| S9 | 「重置练习」不清成绩 | 同步清 `practiceResults`，列表回到「未开始」 | `shared/src/mock/catalog.ts`（新增 `clearPracticeResult`）、`usePracticeSession.ts` |
| S10 | 已结束且不可重考的考试仍给「进入考试」 | 只在 `allowRetake` 时给补考入口，否则只给「回顾试卷」 | `student/src/features/exam/ExamListPage.tsx` |
| S11 | 练习「待订正」口径偏窄 | 改为 `status !== "correct"`（含空白与待阅），与原型 `student.js:886` 一致 | `student/src/features/exam-taking/PracticeSessionPage.tsx` |
| S12 | 逐题解析显示原始题型 key | 改用 `TYPE_LABEL`（「单选题」而不是 `single`） | 同上 |
| S13 | 未作答题在逐题解析里整行消失 | 作答说明行**恒渲染**，未作答显示「未作答」；正确答案经 `fromOriginal` 映射回显示字母 | `PracticeSessionPage.tsx`、`ExamReportPage.tsx` |
| S14 | 成绩报告的题型得分条宽度跨题型不可比 | 宽度改按**该题型满分**算（原型 `student.js:1334`） | `student/src/features/reports/ExamReportPage.tsx` |
| S15 | 报告「试卷回顾」用题目默认分值 | 改按卷面条目的分值，并按 `itemsOf` 取题（原型 `student.js:1374`） | 同上 |
| S16 | 参考答案 / 解析无内容时也输出占位符 | 仅在存在时出现 | 同上 |
| S17 | 工作台「卷号」写死学号后四位 | 改用变体标签（标准卷 / xx 号卷） | `student/src/features/dashboard/DashboardPage.tsx` |
| S18 | 「待完成练习」统计的是全部已发布练习 | 改为统计**还没有成绩**的练习 | 同上 |
| S19 | 报告列表项目列多出「考试 · 标准卷」副行 | 删掉，只留名称 | `student/src/features/reports/ReportListPage.tsx` |
| S20 | 上一题 / 下一题缺 chevron 图标 | 补 `chevronLeft` / `chevronRight` | `student/src/features/exam-taking/PracticeSessionPage.tsx` |
| S21 | 标记按钮用 emoji 代替 SVG | 改用 `Icon name="flag"` | `student/src/features/exam-taking/ExamBar.tsx` |
| S22 | 顶栏「考试安排」「去练习」缺图标 | 补 `clipboard` / `book` | `student/src/features/dashboard/DashboardPage.tsx` |
| S23 | 交卷 / 重考 / 重置 / 切换答题者缺 toast | 补 4 条原型文案：已交卷，正在生成成绩报告 / 考试时间到，已自动交卷 / 练习已提交 / 已重置练习，可以重新作答 / 已开启重考，成绩按最高分计入 / 已切换为 {姓名} | 学生端各页 |

> **两处表格末列表头**：原型的 `<th></th>` 是空的，React 侧保留同样的空表头，
> 但用 `aria-label="操作"` 保住无障碍名称（原型空表头对读屏用户不友好）。

#### 本轮新补的测试（11 例）

| 用例 | 覆盖 |
|---|---|
| 学生端 · 考试列表 3 例 | 不可重考的已结束考试不给「进入考试」；可重考的给补考入口；操作列表头无可见文案但有 aria-label |
| 学生端 · 练习会话 4 例 | 同练习重进恢复作答；不同答题者互不干扰；重置后不恢复旧作答；归档键与清成绩 |
| 管理端 · 既有 6 例 | 深链开框、题目清单落库、编辑器拒存、mselect 多选、实体标签两处入口 |

#### 共享层 · 未采纳的差异（记录备查）

| 项 | 原型 | 实现 | 处置 |
|---|---|---|---|
| `Toast` 的 `role` | 一律 `role="status"` | error 用 `role="alert"` | **保留实现**：错误用 assertive 播报对读屏用户更合适，且不涉及中文文案 |
| 练习卷的 `totalScore` | 组卷时不改 `totalScore` | 写入条目时按题分之和同步 | **保留实现**：设计文档 §4.1「`SetItemScore` 改动后 `TotalScore` 同步为各项之和」是领域口径，原型未同步是原型自身的不一致 |
| 主题偏好存放位置 | —— | 主题在 `student/src/app/themeStore.ts` 用裸 localStorage | 契约 §5 写的是 `student/src/stores/studentStore.ts`（Zustand persist）；本次只记差异，不动存储机制（改机制会牵动主题切换的现有用例） |
| `--text-*--line-height` | 原型只有 `--lh-tight/--lh-base/--lh-loose` 三个独立行高令牌 | Tailwind v4 的字号会自带 `--text-*--line-height` | **保留实现**：取值与原型的继承行为视觉等价，属框架产物 |
| `.text-2` / `.text-3` / `.text-sm` / `.text-lg` | —— | 与 Tailwind 生成的同名工具类重名（前者是颜色、后者是字号） | **保留实现但登记为坑**：当前取值恰好一致，后续维护时不要把两类 `.text-*` 混用 |
| 组件内 12 处内联 px | 原型同样用内联 style | 实现同款内联 | **保留实现**：与原型一致 |
| 考试列表的空态 | 原型的考试列表没有空态（只有一张空表），React 给了「没有匹配的考试」 | 保留 | **保留实现**：文案与原型的练习列表空态「没有匹配的练习」同一套说法，属于有用的补齐，不是偏差 |
| `Button` 默认变体 | 原型的普通按钮只有 `.btn`；React 默认 `variant="secondary"` 多渲染一个 `.btn-secondary` | `.btn-secondary` 与 `.btn` 的取值完全相同 | **保留实现**：视觉完全等价，只是多一个类名；改共享层默认变体会牵动两个应用 |
| 组件内联样式 | 原型同样大量用内联 style | 实现同款内联 | **保留实现**：与原型一致 |
| 考试规则的「多选题」条目 | 原型写的是 `"多选题" + MULTI_POLICY`，而 `MULTI_POLICY` 本身就以「多选题计分策略：」开头，渲染出来是「多选题**多选题**计分策略：…」（重复词） | 只输出一次「多选题计分策略：…」 | **保留实现**：原型此处是重复词的笔误，照抄会把重复词带进产品；两处（考试安排的第 4 条、个人中心的第 2 条）口径一致。要改回照抄原型，改 `ExamListPage.tsx` 与 `ProfilePage.tsx` 两行即可 |

### 第四轮 · 逐题明细与成绩落盘（2026-11-13）

第三轮收尾后，学生端还剩两条 P0 没动：**逐题明细缺标签片与评分要点清单**（P0-7）、
**练习记录点「查看」落到空白练习卷**（P0-8）。本轮把这两条补完。

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| S24 | 成绩报告的逐题明细缺标签片、缺评分要点 / 步骤命中清单，副行也没有题号 | 抽出共用的逐题明细行：报告形态 78px 列 + 副行「第 N 题 · 题型」，练习形态 64px 列 + 只有题型；两者都补标签片、作答摘要、评分要点 / 步骤清单；状态徽标按原型 `statusBadge`，练习侧主观题按得分折算（`practiceStatus`） | `student/src/features/shared/GradedDetailRow.tsx`（新）、`ExamReportPage.tsx`、`PracticeSessionPage.tsx` |
| S25 | 「/reports」里练习记录的「查看」跳过去是空白练习卷 | ① 会话归档快照带上判分结果，刷新后结果视图仍在；② 结果缺失时按作答重算并回填；③ 成绩结果（作答记录、练习成绩、错题本）落盘，启动时回灌进 mock catalog——原型是整份 store 落盘的，mock catalog 是纯内存的 | `student/src/stores/practiceSessionStore.ts`、`student/src/features/exam-taking/usePracticeSession.ts`、`student/src/stores/resultArchive.ts`（新）、`student/src/main.tsx`、`student/src/app/providers.tsx` |

> **标签片分组**：`TagChips` 按标签**自身分组**着色（领域 / 知识点 / 能力 / 难度），
> 原型 `tagChips(entity)` 就是这么做的。此前实现一律写死 `group="domain"`，
> 知识点、能力、难度标签都被染成了领域色，本轮一并改掉。

#### 本轮新补的测试（10 例）

| 用例 | 覆盖 |
|---|---|
| 学生端 · 逐题明细行 5 例 | 报告副行带题号、练习副行不带；标签片渲染；评分要点清单；主观题状态按得分折算（正确 / 部分正确 / 错误 / 未作答）；客观题直接用判分状态 |
| 学生端 · 成绩归档 3 例 | 回灌后 catalog 能看到归档成绩与错题；catalog 已有记录不被归档覆盖；catalog 变化后写回归档 |
| 学生端 · 会话与重载 2 例 | 归档快照带上判分结果；会话已提交但没带结果时按作答重算出结果视图 |

### 第五轮 · 管理端侧栏接线（2026-11-13）

批次 D 第 10 条（「考试场次」「实时监考」在侧栏里点不到）经用户确认后处理。
接线时发现一处**更硬的问题**：侧栏的「实时监考」指向 `/monitoring`，
但路由只注册了 `/monitoring/:sessionId`，直接接进侧栏会点出一个 404 页——
所以一并把场次 ID 改成可选，并补了「可监考场次」选择屏。

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| A31 | 两条 React 独有的路由在侧栏里点不到 | 并进侧栏「测评」组末尾，原型那三条的相对顺序不变；删掉零引用的 `ADMIN_SECONDARY_NAV` | `admin/src/app/nav.ts` |
| A32 | 侧栏「实时监考」指向的 `/monitoring` 没有路由，会落到 404 | 路由改为 `/monitoring/:sessionId?`；不带场次时渲染「可监考场次」选择屏，进行中的场次给「进入监考」，其余标注「仅进行中的场次可监考」 | `admin/src/router.tsx`、`admin/src/features/monitoring/ProctoringPage.tsx` |
| A33 | 场次状态徽标在列表页与监考页各写一套色调 | 收进共用组件 `SessionStatusBadge`（列表页、选场次屏共用） | `admin/src/features/shared/bits.tsx`、`admin/src/features/sessions/ExamSessionListPage.tsx` |

> **与原型的偏离**：原型侧栏只有「内容 / 测评 / 系统」3 组 8 条，没有场次与监考。
> React 这两块是设计文档（FR-DLV / FR-ANT）要求的新模块，不进侧栏就完全没有入口，
> 因此偏离原型补了 2 条——这是有意为之，不是漏做。

#### 本轮新补的测试（5 例）

| 用例 | 覆盖 |
|---|---|
| 管理端 · 侧栏 3 例 | 原型那 8 个入口都在；「考试场次」「实时监考」也能点到；侧栏共 10 条、分 3 组 |
| 管理端 · 导航配置 1 例 | 两条 React 独有路由进了 `ADMIN_NAV` |
| 管理端 · 监考选场次 1 例 | 不带场次时给出「可监考场次」选择屏，进行中的场次有「进入监考」 |

#### 第五轮 · 修复后的门禁状态

| 门禁 | 结果 |
|---|---|
| `pnpm -r typecheck` | 零错误 |
| `pnpm lint` | 零错误（5 条既有的 fast-refresh 警告） |
| `pnpm -r test` | 230 例全绿（shared 119 / student 60 / admin 51） |
| `pnpm build` | 通过 |
| `pnpm smoke:preview` | 23 个路由全绿（新增 `/monitoring` 选场次屏） |
| `pnpm e2e` | 6 例通过、2 例按原因跳过 |

### 第六轮 · 学生端文案与口径复核（2026-11-13）

学生端做了一轮**只读复核**（不产出改动），把 8 条 P0 逐条比对当前磁盘代码确认达成，
同时报出 9 条 P1 文案/口径偏差。逐条对照原型核实后，9 条**全部成立**，本轮修完。

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| S26 | 工作台「考试须知」只有 `note`，缺整句卷型说明 | 补成 `{note} 本卷采用{卷型}（{短说明}）：{长说明}`，并按原型给标题加 info 图标；卷型口径统一走 `PAPER_MODES` + `normalizeConfig`（原型的 `plumCfg`） | `student/src/features/dashboard/DashboardPage.tsx` |
| S27 | 练习卡的完成度条画的是**得分率** | 原型 `student.js:659` 的完成度只有「已做 / 没做」两态（`res ? 100 : 0`），得分率另有一行文字；条形改两态，文案改「已完成 N/N 题」（**题数**，不是「得分 / 满分 题」） | `student/src/features/practice/PracticeListPage.tsx` |
| S28 | 4 处标签片写死 `group="domain"`，知识点/能力/难度标签都被染成领域色 | 改用 `TagChips`，按标签**自身分组**着色 | `DashboardPage.tsx`、`PracticeListPage.tsx`、`ExamListPage.tsx`、`MistakesPage.tsx` |
| S29 | 成绩报告副标题缺「姓名 学号」；「试卷回顾」分支还漏了试卷标签片 | 副标题补成 `{批次} · 卷型：{label}（{short}） · {姓名} {学号}`（原型 `student.js:1390`）；两个分支都补上试卷标签片 | `student/src/features/reports/ExamReportPage.tsx` |
| S30 | 练习结果页「提交于」显示的是**当前时间** | 改用会话的 `submittedAt`（原型 `student.js:879`） | `PracticeSessionPage.tsx`、`usePracticeSession.ts` |
| S31 | 「清除本地数据」的确认文案不是原型原文 | 照抄原型 `student.js:1904`：「将清除本机保存的全部作答记录、练习结果与阅卷进度，并恢复为初始示例数据。此操作不可撤销。」 | `student/src/features/profile/ProfilePage.tsx` |
| S32 | 练习提交次数用完时用**常驻提示条**报错 | 改用 `toast.error`（原型 `student.js:1629` / `:1782` 走 `EX.toast`），提示条与 `message` 状态一并撤掉 | `student/src/features/exam-taking/PracticeSessionPage.tsx` |
| S33 | 考试规则第 4 条把共享常量**硬编码**了一份 | 改用 `MULTI_POLICY` 常量，与个人中心的考试须知同源 | `student/src/features/exam/ExamListPage.tsx` |

#### 本轮新补的测试（8 例）

| 用例 | 覆盖 |
|---|---|
| 学生端 · 工作台 2 例 | 考试须知带整句卷型说明；标签片按自身分组着色 |
| 学生端 · 练习中心 2 例 | 有成绩写「已完成 N/N 题」且完成度条满格；没练过写「尚未开始」且条空着 |
| 学生端 · 个人中心 1 例 | 清除本地数据的确认文案与原型一致 |
| 学生端 · 成绩报告 1 例 | 副标题带姓名与学号 |
| 学生端 · 练习作答 2 例 | 「提交于」取会话提交时间；次数用完走 toast 而不是常驻提示条 |

#### 第六轮 · 修复后的门禁状态

| 门禁 | 结果 |
|---|---|
| `pnpm -r typecheck` | 零错误 |
| `pnpm lint` | 零错误（5 条既有的 fast-refresh 警告） |
| `pnpm -r test` | 238 例全绿（shared 119 / student 68 / admin 51） |
| `pnpm build` | 通过 |
| `pnpm smoke:preview` | 23 个路由全绿 |
| `pnpm e2e` | 6 例通过、2 例按原因跳过 |

### 第七轮 · 强制交卷接线与 P2 打磨（2026-11-14）

学生端复核代理报了第 2 部分（视觉 / 交互 / P2）。其中两条是**真问题**，其余是文案与口径打磨。

| # | 问题 | 修复 | 位置 |
|---|---|---|---|
| S34 | **切屏达上限不触发强制交卷**：`forceSubmit` 内部确实调 `submit()`，但没有任何调用方——`useFocusGuard` 只累加计数，`maxFocusLoss` 形同虚设 | 采集回调改为读会话里的切屏计数，达上限即调 `forceSubmit`；处置原因（`切屏次数已达上限（N 次），已强制交卷`）既进 toast，也记进会话的 `forcedReason`，attempt 照常落库 | `student/src/features/exam-taking/useExamSession.ts` |
| S35 | **`attemptNo` 按「作答记录条数 + 1」算**，而记录按 `examId:studentId` 唯一 → 第三次重考仍然得 2 | 改成读记录上的 `attempts` 再 + 1（原型 `prev.attempts + 1`），第 1/2/3 次依次为 1/2/3 | 同上 |
| S36 | 练习卡两段文字之间缺「·」分隔 | 补「·」 | `student/src/features/practice/PracticeListPage.tsx` |
| S37 | 工作台推荐练习卡多「总分」、「上次得分」被拆成两行、缺标签片行 | 改成一行副标题 `{n} 题 · 约 {m} 分钟 · 上次得分 {x}/{y}（{z}%）`（无成绩则「· 尚未开始」），补标签片行 | `student/src/features/dashboard/DashboardPage.tsx` |
| S38 | 趋势卡「最近 N 次」用的是折线图点数 | 改成全部记录数（原型 `student.js:399`） | 同上 |
| S39 | 错题分布只认 `t-pt-` 前缀，缺「领域」回退，也没有分组后缀 | 改成按知识点分组、无知识点回退领域、都没有则「未归类」；标签后补「· {分组}」 | 同上 |
| S40 | 报告「暂未参加该考试」空态多了「返回列表」按钮 | 去掉（原型只有标题与说明） | `student/src/features/reports/ExamReportPage.tsx` |
| S41 | 工作台的考试入口恒为「进入考试」 | 有会话时改「继续考试」（原型 `student.js:443`） | `DashboardPage.tsx` |
| S42 | 报告「交卷时间」是完整日期时间串，卷号 hint 没有兜底 | 交卷时间改 `HH:mm`（原型 `fmt.time`）；卷号改 `{variantLabel || 卷型}` | `ExamReportPage.tsx` |
| S43 | 清除本地数据的 toast 多带了后缀 | 照抄原型「本地数据已清除」 | `student/src/features/profile/ProfilePage.tsx` |

#### 本轮新补的测试（4 例）

| 用例 | 覆盖 |
|---|---|
| 学生端 · 考试答题 2 例 | 切屏达上限强制交卷（落 attempt、记原因、跳报告）；重考时 `attemptNo` 递增到 3 |
| 学生端 · 工作台 2 例 | 趋势卡「最近 N 次」按记录数；错题分布带分组后缀 |

#### 第七轮 · 修复后的门禁状态

| 门禁 | 结果 |
|---|---|
| `pnpm -r typecheck` | 零错误 |
| `pnpm lint` | 零错误（5 条既有的 fast-refresh 警告） |
| `pnpm -r test` | 242 例全绿（shared 119 / student 72 / admin 51） |
| `pnpm build` | 通过 |
| `pnpm smoke:preview` | 23 个路由全绿 |
| `pnpm e2e` | 6 例通过、2 例按原因跳过 |

### 仍未做（批次 D，可另开一轮）

1. 把本次的「原型 ↔ 实现文案 diff」与「CSS 规则比对」固化成 CI 门禁（脚本已验证可用，未进仓库）。
2. `pnpm format:check` 此前就红：仓库代码按 80 列排版，而 `.prettierrc` 写的是 100（79 个文件）。属既有漂移，未在本次一并重排。
3. `scripts/gen-seed.mjs` 与仓库里的 `seed.ts` 已经不同步（实跑会整份重写），需决定是废弃生成器还是以生成器为准。
4. 端到端流程 ② 的「发布成绩 → 学生看到成绩」与 ③ 的「强制交卷」依赖后端接口，就绪后打开 `test.skip`。
5. **FR-CAT-06 批量加入 / 移除题目**：题库工作台目前只支持逐题发布 / 停用，没有「把这一批题加进某份试卷」的动作。
6. **FR-CAT-08 服务端分页**：题目与成绩列表目前是前端全量过滤，接后端时要改成传分页参数。
7. **FR-IAM-04 标签父子树的删除校验**：组织维度标签已能按层级自动创建，但「删除仍有子节点或已关联用户的标签时拒绝删除」尚未实现。
8. **FR-AUT-06 试卷快照**：发布时还没有冻结题目正文 / 选项顺序 / 正确答案的不可变快照；现在是「引用题目 ID」，题目被改后已发布卷面会跟着变。
9. **API → DB 的 `publishAnswer` 翻译层**：前端与 API 契约用 `on_open`（`docs/design/05-api.md:756`），DB 的 CHECK 约束存 `immediately`（`docs/design/04-data-model.md:439`）。前端侧口径已定，翻译层要等后端有字段才能落地。
11. **管理端 mock catalog 不落盘**：原型是**一份** store（管理端与答题端同源），本实现拆成两个应用各持一份内存 catalog，学生端只把自己的成绩结果落盘（`student/src/stores/resultArchive.ts`）。管理端刷新后新建的题库 / 试卷会丢，学生端也看不到管理端新建的内容——两个应用不同源，无法共享 localStorage。彻底解法是让两端共用后端（`VITE_DATA_SOURCE=http`），而不是继续在前端补同步。
