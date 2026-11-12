# 大学生考试系统
- 设计并实现一个大学生考试系统，以大学生为主要使用群体，但呈现为通用的生产级考试系统

## 业务和功能
- 基于标签的考试系统，有领域、知识点、能力、难度等分类的标签
- 管理端可以对指定标签的题目进行组卷，可以是考试卷或练习卷，学生可以在考试端进行考试或练习
- 考试和主流考试系统要求一致，如限制切屏次数等防作弊等手段、防止网络抖动而丢失答题结果的功能等等
- 练习的时候要求比较低一些，不用限制切屏次数等
- 可同时容纳1000人同时稳定进行考试或练习

## 技术要求
- 后端使用net10+DDD+整洁架构+EFCore+pg（当前开发环境有pg）+RBAC
- 前端使用react+tailwindcss
- 全局软删除
- 界面按按原型设计进行：`docs/ui-design`
---

## 设计文档（已产出，待确认后冻结）

`docs/design/` 设计文档集 · `docs/development/` 开发文档集

| 文档 | 内容 |
|---|---|
| `docs/design/00-overview.md` | 文档索引、决策摘要、统一语言、原型差距清单、显式假设 |
| `docs/design/01-requirements.md` | 角色权限矩阵、功能需求（含验收标准）、非功能需求 |
| `docs/design/02-architecture.md` | 架构原则、限界上下文、项目结构、技术选型论证、关键数据流 |
| `docs/design/03-domain-model.md` | 聚合与实体、状态机、抽题/判分/置换算法、领域事件、错误码 |
| `docs/design/04-data-model.md` | 分 Schema 表结构、索引、软删除、追加式表权限、迁移策略 |
| `docs/design/05-api.md` | API 契约、错误格式、幂等、限流、SignalR 契约 |
| `docs/design/06-frontend.md` | 前端架构、设计令牌落地、作答可靠性四层保障、防作弊交互 |
| `docs/design/07-security-compliance.md` | 威胁模型、认证授权、防作弊五层与能力边界声明、合规 |
| `docs/design/08-deployment-operations.md` | 部署拓扑、容量模型、压测阈值、备份恢复、运维手册 |
| `docs/development/01-task-breakdown.md` | P0–P9 阶段、76 条任务、依赖图、完成定义、工作量粗估、各阶段进度 |
| `docs/development/02-conventions.md` | 编码规范、测试策略、Git 规范、评审清单 |
| `docs/development/03-roadmap.md` | 里程碑、并行策略、阶段验收脚本、风险登记册 |
| `docs/development/ops-runbook.md` | 运维手册：故障处置、答卷对账与重建、备份恢复、发布回滚、告警首响 |
| `docs/development/adr/` | 架构决策记录（18 条 ADR，含 MediatR 授权锁定、答案双表、标签替代组织树等） |

### 已确认的关键决策

1. 全新独立实现，本仓库从零开始，不参考任何本地项目（仅参考 GitHub 公开项目）。
2. 标签为**五维**：领域 / 知识点 / 能力 / 难度 / **组织**。院系、专业、班级用组织维度标签表达，不建独立组织树；组织维度只挂用户，题目只挂前四维。
3. 登录为**账号 + 密码**，账号不限学号，**支持社会人士使用**（在校学生可用学号作为账号）。组织标签对用户可选，社会人士不挂组织标签。角色含 `general_user`（社会人士）。考试名单支持按组织标签 / 指定考生 / 全员开放三种纳入方式。
4. 组卷**支持一键出卷**：标签规则自动抽题（确定性种子）+ 手工微调；题池不足明确报错，不静默降级。
5. 防作弊**按诚实标注能力边界**：「可审计 + 可威慑」，非绝对防护；产品文案与手册不得写"杜绝作弊"。
6. 认证：JWT Access + Refresh Token 轮换（复用检测）+ Redis 黑名单；RBAC 用 Policy-Based 授权。
7. 数据库：Docker 独立 `postgres:17-alpine` 容器 + PgBouncer 事务池。
8. 前端：`frontend/student` 与 `frontend/admin` 两个独立 SPA + `frontend/shared` 共享包（pnpm workspace）。
9. 内容生产：CSV/XLSX 导入真实实现；AI 生成只保留 Provider 抽象，不接模型。
10. 监考：SignalR 实时大屏 + 警告/备注/强制交卷处置。

### 当前进度

| 阶段 | 状态 |
|---|---|
| P0 基础设施 | ✅ 完成（后端 80 个测试 + 前端 41 个测试全绿；compose 11 服务全栈容器端到端验收通过：迁移 → 授权 → 种子 → 登录 → 刷新轮换 → 登出 → 复用检测 422 → SPA 首屏 200 → 指标输出） |
| P1–P9 | 未开始，按 `docs/development/01-task-breakdown.md` 顺序推进 |

### 本期预留不启用

- 学生申诉工单
- 成绩发布流程细化
- 试卷回放（申诉举证）UI
