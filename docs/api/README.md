# API 文档（知行测评 · 考试平台）

## 契约来源

| 来源 | 作用 | 什么时候改 |
|---|---|---|
| [`openapi.json`](openapi.json) | 机器可读的接口契约（OpenAPI 3.0）：路径、方法、参数、响应结构、鉴权要求 | 改接口后重新导出 |
| [《05-api.md》](../design/05-api.md) | 人读的接口设计：语义、约定、字段含义 | 改接口语义时 |
| 控制器上的 XML 注释 | 每个接口的一句话说明，会进 OpenAPI 的 `summary` | 改接口时顺手改 |

**契约与代码必须一致**：CI 会重新导出一次并比对仓库里的 `openapi.json`，
不一致即失败（改了接口忘了导出 = 构建失败）。

```bash
bash scripts/export-openapi.sh              # 重新导出
SKIP_BUILD=1 bash scripts/export-openapi.sh # 用现成构建产物导出
```

运行中的应用会提供在线文档：`/swagger`（UI）与 `/swagger/v1/swagger.json`（机器可读）。

## 通用约定

### 成功响应

- 读取类接口直接返回资源对象或列表；写入类接口返回写入后的对象。
- 列表接口统一分页：请求带 `page`（从 1 开始）与 `size`，响应带
  `total`、`page`、`size`（部分列表接口用 `items` 作为数组字段名）。
- 时间一律 ISO-8601 带时区偏移（`2026-11-15T08:30:00+08:00`）。

### 错误响应

所有错误都是 `application/problem+json`，形状固定：

```json
{
  "type": "https://exam.edu/problems/business-rule",
  "title": "业务规则拒绝",
  "status": 422,
  "errorCode": 25002,
  "detail": "已超过截止时间，请立即交卷。",
  "errors": { "ClientSeq": ["客户端序列号必须大于 0。"] }
}
```

| 字段 | 含义 |
|---|---|
| `status` | HTTP 状态码 |
| `errorCode` | 稳定的业务错误码（前端按它分支，不要按文案分支） |
| `detail` | 给人看的一句话（可能改，前端不要依赖它的措辞） |
| `errors` | 字段级校验错误（仅参数校验失败时出现） |

状态码与错误码的对应：

| 状态码 | 什么时候 | 错误码段 |
|---|---|---|
| 400 | 参数校验失败 | 20001 |
| 401 | 未登录 / 令牌无效 | — |
| 403 | 权限不足 | 20004 |
| 404 | 资源不存在 | 20003 |
| 409 | 状态冲突（并发、交卷超时、重复提交） | 20002、25002、25003 |
| 422 | 业务规则拒绝 | 20005 及其细分（见下表） |
| 429 | 触发限流 | — |
| 500 | 服务端异常（不泄露内部细节） | — |

错误码分段（完整定义见 `backend/src/Exam.Domain/SharedKernel/Exceptions/ErrorCodes.cs`）：

| 段 | 含义 | 常用码 |
|---|---|---|
| 2xxxx | 通用 | 20001 校验失败、20002 并发冲突、20003 不存在、20004 越权、20005 业务规则 |
| 21xxx | 状态流转 | 21001 非法状态流转 |
| 22xxx | 唯一性 | 22001 编码重复、22101 标签被引用 |
| 23xxx | 题目 | 23001 题目不合法、23101 题池不足 |
| 24xxx | 试卷 | 24001 发布被拒、24101 试卷已发布不可改 |
| 25xxx | 会话 | 25001 会话状态非法、25002 已超时、25003 已交卷、25004 超出名额、25101 超出切屏上限 |
| 26xxx | 评分 | 26001 评分失败 |
| 27xxx | 导入 | 27001 行数据不合法 |
| 28xxx | 标签 | 28001 标签成环、28002 标签被引用 |
| 29xxx | 身份 | 29001 凭据无效、29002 账号锁定、29003 账号禁用、29004 刷新令牌复用 |

### 幂等

高频写接口必须幂等，重试不会写坏数据：

| 接口 | 幂等键 |
|---|---|
| `POST /attempts` | 同一目标（场次或练习）重复调用返回同一个会话 |
| `POST /attempts/{id}/answers` | `clientSeq`（客户端单调递增序号）；序号没有前进的整批忽略 |
| `POST /attempts/{id}/submit` | 重复交卷返回同一个交卷结果 |
| `POST /attempts/{id}/focus-events` | 按事件去重 |
| `POST /attempts/{id}/heartbeat` | 心跳天然可重复 |

### 限流

- 全局限流：`RateLimiting:GlobalPerMinute`（默认 6000 次/分钟）。
- `/health/*` 与 `/metrics` 不参与限流：探针与采集不能被限流挡住，否则容器会被误判不健康。
- 触发限流返回 429 与 `Retry-After`。

### 时间

- **服务端权威计时**：剩余时间、截止判定、交卷原因一律以服务端时钟为准（ADR-011）。
- 客户端调 `GET /api/v1/system/time` 拿服务端时间用于显示校准，**多次采样取中位数**更稳。
- 客户端时钟只用于显示，不参与任何判定。

## 认证

```
POST /api/v1/auth/login     { "username": "...", "password": "..." }
  → { "accessToken": "...", "tokenType": "Bearer", "expiresIn": 900, "user": { ... } }

POST /api/v1/auth/refresh   （用刷新令牌换新的访问令牌）
POST /api/v1/auth/logout    （吊销当前刷新令牌）
GET  /api/v1/auth/me        （当前用户档案与权限码）
POST /api/v1/auth/change-password
  { "currentPassword": "...", "newPassword": "..." }
  → { "accessToken": "...", "tokenType": "Bearer", "expiresIn": 900 }
```

- **强制改密**：管理员重置密码或导入名单后，令牌带「必须改密」标记，
  这期间除改密、`/auth/me` 与登出外一律 403；改密成功返回**新的访问令牌**，
  客户端必须换掉旧令牌（旧令牌上的标记还在，换掉才恢复通行）。

- 访问令牌默认 15 分钟，刷新令牌默认 7 天。
- 之后每个请求带 `Authorization: Bearer <accessToken>`。
- 刷新令牌**一次性**：用过即吊销；重复使用会被判定为盗用并吊销该用户全部令牌
  （错误码 29004）。
- 权限码共 35 个，登录响应与 `/auth/me` 都会带上；前端按权限码显示入口，
  后端仍会独立校验——**前端隐藏按钮不是权限控制**。

## 端点清单

完整契约见 `openapi.json`，这里只列分组与用途。

| 分组 | 前缀 | 用途 |
|---|---|---|
| 认证 | `/api/v1/auth` | 登录、刷新、登出、当前用户 |
| 用户与角色 | `/api/v1/users`、`/api/v1/roles`、`/api/v1/permissions` | 用户管理、名单导入、角色与权限点 |
| 标签 | `/api/v1/tags` | 按维度返回标签、树形展开 |
| 题目 | `/api/v1/questions`、`/api/v1/question-banks` | 题目 CRUD、批量状态、附件、题库 |
| 导入 | `/api/v1/imports` | 上传解析、列映射调整、逐行结果、采纳为草稿 |
| 试卷与组卷 | `/api/v1/papers`、`/api/v1/paper-templates` | 试卷、题位、蓝图抽题、快照、模板 |
| 场次 | `/api/v1/exam-sessions` | 场次、名单、发布、监考快照、成绩发布 |
| 作答 | `/api/v1/attempts` | 开始、保存、焦点事件、心跳、交卷、成绩、报告 |
| 监考 | `/api/v1/attempts/{id}/proctor-actions` | 监考处置与历史 |
| 阅卷 | `/api/v1/review-tasks` | 任务队列、领取、评分、批量采纳 |
| 练习 | `/api/v1/practices`、`/api/v1/practice-assignments` | 可见练习、开放单管理 |
| 学习 | `/api/v1/mistakes`、`/api/v1/abilities` | 错题本、重做、能力画像 |
| 成绩 | `/api/v1/my/results` | 学生端成绩列表 |
| 统计 | `/api/v1/statistics` | 场次成绩分析、逐题正确率 |
| 工作台 | `/api/v1/dashboard` | 汇总卡、进行中的考试、推荐练习、成绩趋势 |
| 审计 | `/api/v1/audit-logs` | 分页查询审计日志 |
| 系统 | `/api/v1/system` | 服务端时间（时钟校准） |

## 前端对接要点

这些是最容易接错的地方，逐条照做：

1. **批量保存协议**：`POST /attempts/{id}/answers` 的请求带 `clientSeq`（单调递增）。
   同一批重复提交整体忽略，不会产生重复记录。服务端按 `clientSeq` 推进，
   **前端必须自己保证序号不回退**。
2. **保存节奏**：按批提交（单批上限 50 题），不要每改一个选项就发一次。
3. **心跳**：考试中按服务端给定的间隔发 `POST /attempts/{id}/heartbeat`。
   断连次数超限会被按断网超时代交。
4. **焦点事件**：切屏 / 失焦要**如实上报**——服务端计数，次数超限触发处置。
   漏报不会让考生受益，只会让处置失去依据。
5. **时钟**：显示倒计时前先做一次时钟校准（取多次采样中位数），避免倒计时跳秒。
6. **附件**：题目附件不直接暴露对象存储地址，用
   `GET /api/v1/questions/{questionId}/attachments/{attachmentId}/url` 换短期签名 URL。
7. **错误分支**：按 `errorCode` 分支，不要按 `detail` 文案分支（文案会改）。
8. **越权**：后端会独立校验权限并返回 403，前端不要依赖「按钮藏起来」。

## 契约里的权限码

每个需要鉴权的接口在契约里带一个扩展字段 `x-required-permission`，值就是它要求的权限码：

```json
"x-required-permission": "attempt:take"
```

- 前端按它判断「这个接口我能不能调」「按钮要不要显示」。
- 端到端测试据此逐条断言：没有权限的令牌必须被拒（401/403），
  不靠人工维护一份接口与权限的对照表。

## 端到端怎么跑

```bash
# UI 组：跑生产产物（先 pnpm build）
cd frontend && pnpm e2e

# API 组：打真实后端（需要 E2E_API_BASE_URL 与管理员账号）
cd frontend && E2E_API_BASE_URL=http://127.0.0.1:5000 \
  E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... pnpm e2e:api
```

## 相关文档

- 接口设计全文：[《05-api.md》](../design/05-api.md)
- 前端契约与实现：[《06-frontend.md》](../design/06-frontend.md)
- 错误处理与审计：[《07-security-compliance.md》](../design/07-security-compliance.md)
- 学生手册：[《student-manual.md》](../guide/student-manual.md)
- 教师手册：[《teacher-manual.md》](../guide/teacher-manual.md)
