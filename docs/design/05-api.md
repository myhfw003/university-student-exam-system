# 05 · API 契约

> 关联：`03-domain-model.md`、`04-data-model.md`
> 基址：`/api/v1`　　编码：UTF-8　　内容类型：`application/json`
> 认证：`Authorization: Bearer <accessToken>`；Refresh Token 走 `HttpOnly` Cookie

---

## 1. 通用约定

### 1.1 成功响应

直接返回资源 DTO，无外层包裹。

```json
{ "id": 1024, "name": "高等数学期末考试", "status": "published" }
```

### 1.2 错误响应

RFC 7807 ProblemDetails。

```json
{
  "type": "https://api.example.edu/errors/25001",
  "title": "会话状态不允许该操作",
  "status": 422,
  "detail": "该作答会话已于 2026-11-09T10:41:00Z 提交，无法继续保存答案。",
  "errorCode": 25001,
  "traceId": "0HN7...",
  "instance": "/api/v1/attempts/8821/answers",
  "errors": { "deadline": ["已超过作答截止时间"] }
}
```

| 字段 | 说明 |
|---|---|
| `errorCode` | 领域错误码（见 `03-domain-model.md` 第 11 节），**稳定契约**，前端按此做文案与分支 |
| `traceId` | 链路追踪 ID，同时写入日志，用户报障时提供 |
| `errors` | 字段级校验错误（可选） |

### 1.3 分页

请求参数：`?page=1&size=20&sortBy=updatedAt&sortDir=desc`

响应：

```json
{
  "items": [ /* ... */ ],
  "total": 137,
  "page": 1,
  "size": 20
}
```

`size` 上限 200，超过返回 `400`。

### 1.4 幂等

| 场景 | 机制 |
|---|---|
| 答案保存 | 请求体携带 `clientSeq`（会话内单调递增）；服务端按 `(attempt_id, client_seq)` 唯一索引去重，重复请求返回既有结果 |
| 交卷 | 会话状态已是终态时直接返回既有交卷结果，`200`，不报错 |
| 导入采纳 | 批次状态已是 `adopted` 时返回既有结果并注明"已采纳" |
| 阅卷提交 | 同 `review_task_id` 重复提交为幂等更新，追加一条 `grade_revision` |

### 1.5 限流

| 端点 | 限制 |
|---|---|
| `POST /auth/login` | 10 次/分钟/IP + 5 次/分钟/账号 |
| `POST /attempts/{id}/answers` | 120 次/分钟/用户（正常为 20 次/分钟） |
| `POST /attempts/{id}/focus-events` | 120 次/分钟/用户 |
| 其余写端点 | 60 次/分钟/用户 |

超限返回 `429` + `Retry-After`。Redis 不可用时限流降级为放行并告警（P-07）。

### 1.6 时间

所有时间字段为 ISO 8601 UTC 字符串：`2026-11-09T10:41:00Z`。

---

## 2. 认证与身份

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/auth/login` | 匿名 | 登录 |
| POST | `/auth/refresh` | Refresh Cookie | 刷新令牌（轮换） |
| POST | `/auth/logout` | 登录 | 登出（吊销当前令牌族） |
| POST | `/auth/change-password` | 登录 | 修改本人密码 |
| GET | `/auth/me` | 登录 | 当前用户档案与权限码集合 |
| GET | `/system/time` | 匿名 | 服务端时间，用于客户端时钟同步 |

**`POST /auth/login`**

```json
// 请求（账号不限学号：在校学生可用学号，社会人士可自选）
{ "username": "zhangsan", "password": "••••••••" }

// 200
{
  "accessToken": "eyJhbGci...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {
    "id": 30012,
    "username": "2023120101",
    "displayName": "林知远",
    "organizationTags": [ { "id": 23, "name": "计科 2301 班" } ],   // 社会人士为空数组
    "roles": ["student"],
    "permissions": ["attempt:take", "attempt:read-own"]
  }
}
```

失败：`401` `errorCode=20005`，消息"账号或密码错误"（不区分账号是否存在）。

**`POST /auth/refresh`** — 读取 `HttpOnly` Cookie `rt`，成功返回新的 `accessToken` 与轮换后的 Cookie。检测到复用返回 `401` + `errorCode=20006`（令牌族已吊销，需重新登录）。

---

## 3. IAM

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/users` | `user:read` |
| POST | `/users` | `user:write` |
| GET | `/users/{id}` | `user:read` 或本人 |
| PUT | `/users/{id}` | `user:write` |
| POST | `/users/{id}/reset-password` | `user:write` |
| POST | `/users/{id}/roles` | `role:write` |
| DELETE | `/users/{id}/roles/{roleId}` | `role:write` |
| POST | `/users/import` | `user:import`（multipart CSV） |
| GET | `/roles` | `role:read` |
| POST | `/roles` | `role:write` |
| PUT | `/roles/{id}` | `role:write` |
| GET | `/permissions` | `role:read` |
| GET | `/users/{id}/tags` | `user:read` 或本人 | 用户挂载的组织标签 |
| PUT | `/users/{id}/tags` | `user-tag:assign` | 覆盖用户的组织标签 |
| GET | `/tags?group=organization` | `tag:read` | 组织维度标签树（院系 / 专业 / 班级） |
| GET | `/audit-logs` | `audit:read` |

**`POST /users/import`**（multipart）

CSV 列定义：`account`（必填，登录账号）、`name`（必填，姓名）、`faculty`、`major`、`class`（**可空**，为空即社会人士）、`email`（可空）、`role`（可空，缺省按是否有班级推断）、`password`（可空，缺省生成随机初始密码并要求首次登录修改）。

```json
{
  "total": 120, "succeeded": 116, "created": 110, "updated": 6,
  "failed": [
    { "rowNumber": 17, "username": "2023120099", "reason": "班级路径不存在：/未知学院/未知专业/" }
  ]
}
```

---

## 4. 标签

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/tags` | `tag:read` | 按维度分组返回全部标签（含引用计数） |
| GET | `/tags/{id}` | `tag:read` | |
| POST | `/tags` | `tag:write` | |
| PUT | `/tags/{id}` | `tag:write` | |
| DELETE | `/tags/{id}` | `tag:write` | 被已发布组卷方案引用时 `422 / 22101` |
| GET | `/tags/{id}/descendants` | `tag:read` | 展开子标签树 |

```json
// GET /tags
{
  "groups": [
    { "group": "domain", "label": "领域", "allowsHierarchy": true, "tags": [
      { "id": 1, "code": "math", "name": "高等数学", "parentId": null, "level": null, "usageCount": 12 }
    ]},
    { "group": "difficulty", "label": "难度", "allowsHierarchy": false, "tags": [
      { "id": 30, "code": "difficulty.basic", "name": "基础", "parentId": null, "level": 1, "usageCount": 14 }
    ]}
  ]
}
```

---

## 5. 题目与题库

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/questions` | `question:read` | 列表（服务端分页与过滤） |
| GET | `/questions/{id}` | `question:read` | 详情 |
| POST | `/questions` | `question:write` | 新建（`draft`） |
| PUT | `/questions/{id}` | `question:write` | 修改 |
| DELETE | `/questions/{id}` | `question:write` | 仅 `draft` 可删 |
| POST | `/questions/{id}/publish` | `question:publish` | 发布 |
| POST | `/questions/{id}/disable` | `question:publish` | 停用 |
| POST | `/questions/{id}/restore` | `question:publish` | 恢复 |
| POST | `/questions/batch-status` | `question:publish` | 批量状态变更 |
| POST | `/questions/attachments` | `question:write` | 上传附件（multipart） |
| GET | `/questions/filters` | `question:read` | 可用筛选项（题库、题型、标签、难度的取值集合） |
| GET | `/question-banks` | `bank:read` | |
| POST | `/question-banks` | `bank:write` | |
| GET | `/question-banks/{id}` | `bank:read` | 详情与统计 |
| PUT | `/question-banks/{id}` | `bank:write` | |
| DELETE | `/question-banks/{id}` | `bank:write` | |
| POST | `/question-banks/{id}/items` | `bank:write` | 批量加入题目 |
| DELETE | `/question-banks/{id}/items` | `bank:write` | 批量移除 |

**`GET /questions` 查询参数**

| 参数 | 说明 |
|---|---|
| `bankId` | 题库筛选 |
| `type` | 题型 |
| `status` | `draft` / `published` / `disabled` |
| `tagIds` | 逗号分隔 |
| `includeDescendants` | 是否含子标签，默认 `true` |
| `matchMode` | `any` / `all`，默认 `any` |
| `difficultyTagIds` | 难度筛选 |
| `keyword` | 题号或题干 |
| `page` / `size` / `sortBy` / `sortDir` | 分页排序 |

**`POST /questions` 请求体**

```json
{
  "code": "Q-2026-00123",
  "type": "multi",
  "stem": "下列关于 TCP 三次握手的说法，正确的是？",
  "defaultScore": 6,
  "tagIds": [1, 12, 25],
  "difficultyTagId": 31,
  "options": [
    { "key": "A", "text": "第三次握手可以携带数据", "isCorrect": true },
    { "key": "B", "text": "第三次握手必须携带数据", "isCorrect": false }
  ],
  "analysis": "第三次握手本身不携带数据……",
  "attachments": []
}
```

简答题用 `keypoints: [{ "text": "...", "keywords": ["..."] }]`；综合题用 `steps: [{ "code": "s1", "prompt": "...", "referenceAnswer": "...", "keywords": ["..."], "score": 5 }]`。

校验失败返回 `422` + `errorCode=23001`，`errors` 逐字段说明（如"多选题至少需要两个正确答案"）。

### 5.1 导入

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/imports` | `import:run` | 上传文件，返回解析结果与列映射建议 |
| GET | `/imports/{id}` | `import:run` | 批次详情（含逐行结果） |
| PUT | `/imports/{id}/mapping` | `import:run` | 调整列映射并重新解析 |
| POST | `/imports/{id}/adopt` | `import:adopt` | 采纳为候选题 |
| GET | `/imports` | `import:run` | 批次列表 |

**`POST /imports`**（multipart，字段 `file`）

```json
{
  "batchId": 55,
  "fileName": "2026秋季期中试题汇总.csv",
  "fileType": "csv",
  "detectedMapping": { "stem": "题干", "type": "题型", "options": "选项", "answer": "答案", "analysis": "解析", "tags": "知识点", "score": "分值" },
  "columns": ["题干", "题型", "选项", "答案", "解析", "知识点", "分值"],
  "totalRows": 3, "validRows": 2, "invalidRows": 1,
  "rows": [
    { "rowNumber": 1, "valid": true, "errors": [], "parsed": { "type": "single", "optionCount": 4 } },
    { "rowNumber": 2, "valid": false, "errors": [{ "field": "answer", "reason": "答案 A 不在选项范围内" }] }
  ]
}
```

---

## 6. 试卷、组卷与模板

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/papers` | `paper:read` | 列表，`kind=exam\|practice` 过滤 |
| POST | `/papers` | `paper:write` | 新建空卷 |
| GET | `/papers/{id}` | `paper:read` | 详情（含题位） |
| PUT | `/papers/{id}` | `paper:write` | 修改元信息 |
| DELETE | `/papers/{id}` | `paper:write` | 删除（`draft`） |
| PUT | `/papers/{id}/items` | `paper:write` | 整体替换题位集合 |
| POST | `/papers/{id}/items` | `paper:write` | 追加题位 |
| PUT | `/papers/{id}/items/{itemId}` | `paper:write` | 调整分值/顺序 |
| DELETE | `/papers/{id}/items/{itemId}` | `paper:write` | 移除题位 |
| POST | `/papers/{id}/validate` | `paper:read` | 发布校验（不改变状态） |
| POST | `/papers/{id}/publish` | `paper:publish` | 发布并生成快照 |
| POST | `/papers/{id}/unpublish` | `paper:publish` | 撤回 |
| POST | `/papers/{id}/archive` | `paper:publish` | 归档/下架 |
| GET | `/papers/{id}/preview` | `paper:read` | 预览某考生的实际卷面 |
| GET | `/paper-templates` | `paper:read` | |
| POST | `/paper-templates` | `paper:write` | 由试卷另存为模板 |
| POST | `/paper-templates/{id}/apply` | `paper:write` | 套用模板到目标试卷 |

### 6.1 组卷方案（Blueprint）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/papers/{paperId}/blueprint` | `paper:read` | 当前方案 |
| PUT | `/papers/{paperId}/blueprint` | `blueprint:generate` | 保存规则 |
| POST | `/papers/{paperId}/blueprint/generate` | `blueprint:generate` | 执行抽题 |
| GET | `/papers/{paperId}/blueprint/diff` | `blueprint:read` | 与当前题位的差异 |

**`PUT /papers/{paperId}/blueprint` 请求体**

```json
{
  "seed": "B-20261109-001",
  "rules": {
    "tagSelector": { "tagIds": [1, 12], "includeDescendants": true, "matchMode": "any" },
    "difficultyQuota": { "30": 5, "31": 3, "32": 2 },
    "typeQuota": { "single": 6, "multi": 2, "judge": 2 },
    "targetTotalScore": 100,
    "orderRule": "by_type",
    "scoreAllocation": "even"
  }
}
```

**`POST /papers/{paperId}/blueprint/generate` 响应**

```json
{
  "blueprintId": 88,
  "status": "generated",
  "seed": "B-20261109-001",
  "generatedItemCount": 10,
  "items": [
    { "questionId": 501, "questionCode": "Q-2026-00123", "type": "single", "score": 10, "difficulty": "基础",
      "matchReason": ["命中标签：高等数学", "命中难度：基础"] },
    { "questionId": 512, "questionCode": "Q-2026-00134", "type": "multi", "score": 10, "difficulty": "中等",
      "matchReason": ["命中标签：计算机网络"] }
  ],
  "totalScore": 100
}
```

池量不足时返回 `422` + `errorCode=23101`：

```json
{
  "errorCode": 23101,
  "title": "组卷题池不足",
  "detail": "以下配额无法满足，请调整规则或补充题目。",
  "shortfalls": [
    { "type": "single", "difficulty": "较难", "required": 3, "available": 1,
      "reason": "题库中同时满足标签[1,12]且难度为较难的单选题仅有 1 道" }
  ]
}
```

---

## 7. 考试场次

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/exam-sessions` | `exam:read` | 管理端列表 |
| POST | `/exam-sessions` | `exam:write` | 由试卷创建场次 |
| GET | `/exam-sessions/{id}` | `exam:read` | 详情 |
| PUT | `/exam-sessions/{id}` | `exam:write` | 修改 |
| POST | `/exam-sessions/{id}/publish` | `exam:publish` | 发布并物化名单 |
| POST | `/exam-sessions/{id}/close` | `exam:publish` | 关闭 |
| POST | `/exam-sessions/{id}/cancel` | `exam:publish` | 取消 |
| PUT | `/exam-sessions/{id}/participants` | `exam:write` | 设置名单（组织标签） |
| POST | `/exam-sessions/{id}/participants/import` | `exam:write` | 名单 CSV 导入 |
| GET | `/exam-sessions/{id}/participants` | `exam:read` | 名单与状态 |
| GET | `/exam-sessions/{id}/monitoring` | `proctor:monitor` | 监考快照（首次加载） |
| GET | `/exam-sessions/{id}/statistics` | `analytics:read` | 成绩统计 |

**`POST /exam-sessions`**

```json
{
  "paperId": 12,
  "name": "计算机网络期中考试",
  "openAt": "2026-11-09T00:30:00Z",
  "closeAt": "2026-11-09T04:00:00Z",
  "durationMinutes": 90,
  "participantMode": "tags",
  "participantTagIds": [23, 24],
  "variantRule": "large_plum",
  "rules": { "maxFocusLoss": 3, "onMaxFocusLoss": "force_submit", "requireFullScreen": true,
             "blockCopyPaste": true, "showWatermark": true },
  "note": "开考 20 分钟后不允许中途离场。"
}
```

名单三种纳入方式（`participantMode`）：

| 取值 | 配套字段 | 语义 |
|---|---|---|
| `tags` | `participantTagIds` | 按组织维度标签批量纳入（含子标签），发布时展开并物化 |
| `direct` | `participantUserIds` | 逐个指定用户，可含社会人士，发布时物化 |
| `open` | 无 | 全员开放，所有已注册用户可见 |

---

## 8. 作答会话（学生端核心）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/attempts` | 登录 | 我的会话列表 |
| POST | `/attempts` | `attempt:take` | 开始作答（考试或练习） |
| GET | `/attempts/{id}` | 本人 | 恢复作答状态 |
| POST | `/attempts/{id}/answers` | 本人 | **批量保存答案** |
| POST | `/attempts/{id}/focus-events` | 本人 | 上报焦点事件 |
| POST | `/attempts/{id}/heartbeat` | 本人 | 心跳 |
| POST | `/attempts/{id}/submit` | 本人 | 交卷 |
| POST | `/attempts/{id}/feedback` | 本人 | 练习即时反馈查询 |
| GET | `/attempts/{id}/scores` | 本人 | 成绩汇总与逐题明细 |
| GET | `/attempts/{id}/grade-revisions` | 本人 | **改分流水**（改过几次分、谁改的） |

### 8.1 `POST /attempts`

```json
// 请求
{ "examSessionId": 30 }          // 或 { "practiceAssignmentId": 5 }

// 200
{
  "attemptId": 8821,
  "attemptNo": 1,
  "targetType": "exam",
  "serverTime": "2026-11-09T02:00:00.123Z",
  "startedAt": "2026-11-09T02:00:00.100Z",
  "deadlineAt": "2026-11-09T03:30:00.100Z",
  "remainingSeconds": 5400,
  "variantKey": "STD",
  "rules": { "maxFocusLoss": 3, "onMaxFocusLoss": "force_submit", "requireFullScreen": true,
             "blockCopyPaste": true, "showWatermark": true, "heartbeatIntervalSeconds": 15 },
  "questions": [
    {
      "questionId": 501,
      "code": "Q-2026-00123",
      "type": "multi",
      "stem": "下列关于 TCP 三次握手的说法，正确的是？",
      "options": [
        { "key": "B", "text": "第三次握手可以携带数据" },
        { "key": "A", "text": "第三次握手必须携带数据" },
        { "key": "D", "text": "无任何关系" },
        { "key": "C", "text": "无关选项" }
      ],
      "score": 10,
      "difficulty": "中等",
      "sectionTitle": "第一部分 · 单选与多选",
      "attachments": []
    }
  ],
  "answers": [ { "questionId": 501, "payload": { "selectedOptionKeys": ["B"] }, "clientSeq": 12 } ],
  "lastClientSeq": 12
}
```

> `options` 已按**该考生的置换顺序**返回；`correctKeys` **不返回**（考试进行中绝不泄露答案）。

**恢复作答**：`POST /attempts` 在该考生已有进行中的会话时返回**同一个会话**（幂等），不新建。

**练习会话与考试会话的差异**

| 行为 | 考试 | 练习 |
|---|---|---|
| 计时 | 按场次时长计时，到点按 `time_up` 交卷 | **不计时**，`timed` 为 `false`，不会被超时强制交卷 |
| 切屏 | 按场次规则的切屏上限处置（警告或强制交卷） | **不限制切屏**，也不会强制交卷 |
| 次数 | 按场次规则 | 按练习规则的 `maxAttempts`，次数用尽拒绝再开新会话并提示 |
| 反馈 | 不给反馈 | 按 `feedbackTiming`：`immediate` 边做边看，`after_submit` 交卷后给 |
| 错题回流 | 回流 | 按练习规则的 `reflowMistakes`，可以关掉 |

`POST /attempts` 的练习入口：`{ "practiceAssignmentId": 5 }`。练习单不在该考生的可见范围内时返回 404。

**`POST /attempts/{id}/feedback`**（练习即时反馈）

```json
// 200
{
  "attemptId": 8802, "feedbackTiming": "immediate", "generatedAt": "2026-11-15T10:00:00Z",
  "questions": [
    { "questionId": 501, "code": "Q-2026-00123", "type": "single", "typeLabel": "单选题",
      "answered": true, "correct": true, "score": 10, "maxScore": 10,
      "correctKeys": ["A"], "referenceAnswer": null, "analysis": "看选项 B 的说法",
      "details": ["✓ A"] },
    { "questionId": 502, "code": "Q-2026-00124", "type": "short", "typeLabel": "简答题",
      "answered": false, "correct": null, "score": 0, "maxScore": 10,
      "correctKeys": [], "referenceAnswer": "三次握手…", "analysis": null, "details": [] }
  ]
}
```

> 主观题没有「对错」这一说，`correct` 为 `null`，只给参考分与解析。
> `feedbackTiming` 为 `after_submit` 时，交卷前调用返回 422。

### 8.2 `POST /attempts/{id}/answers`（最高频）

```json
// 请求
{
  "clientSeq": 15,
  "items": [
    { "questionId": 501, "payload": { "selectedOptionKeys": ["B"] } },
    { "questionId": 502, "payload": { "text": "我的作答内容" } }
  ]
}
```

```json
// 200
{
  "acceptedClientSeq": 15,
  "serverTime": "2026-11-09T02:03:15.004Z",
  "remainingSeconds": 5265,
  "rejected": []
}
```

规则：
- `clientSeq` 必须大于服务端已记录的 `lastClientSeq`，否则整体忽略并返回当前状态（幂等重放）。
- 单批最多 50 条。
- 超出截止时间返回 `409` + `errorCode=25002`，前端应立即触发交卷。
- `payload` 结构随题型：`selectedOptionKeys`（单选/多选/判断）、`text`（简答）、`steps: [{code,text}]`（综合题）。

### 8.3 `POST /attempts/{id}/focus-events`

```json
{
  "events": [
    { "type": "window_blur", "questionId": 501, "clientAt": "2026-11-09T02:10:00.000Z" },
    { "type": "fullscreen_exit", "questionId": 501, "clientAt": "2026-11-09T02:10:05.000Z" }
  ]
}
```

```json
{
  "focusLossCount": 2,
  "limit": 3,
  "limitReached": false,
  "disconnectCount": 0,
  "warningCount": 0
}
```

### 8.4 `POST /attempts/{id}/submit`

```json
// 请求
{ "reason": "manual" }    // 客户端只能传 manual；其它原因由服务端判定
```

```json
// 200
{
  "attemptId": 8821,
  "status": "submitted",
  "submittedAt": "2026-11-09T03:29:41.220Z",
  "submitReason": "manual",
  "objectiveScore": 60,
  "objectiveMax": 70,
  "subjectivePending": true,
  "totalScore": 60,
  "totalMax": 100,
  "gradeVisibility": "pending_review"
}
```

### 8.5 成绩查询（学生端）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/attempts/{id}/report` | 成绩报告（受 `answerPolicy` 约束） |
| GET | `/my/results` | 我的成绩列表 |

```json
// GET /attempts/8821/report
{
  "attemptId": 8821,
  "examName": "计算机网络期中考试",
  "submittedAt": "2026-11-09T03:29:41Z",
  "objectiveScore": 60, "objectiveMax": 70,
  "subjectiveScore": null, "subjectiveMax": 30,
  "totalScore": 60, "totalMax": 100,
  "status": "pending_review",
  "answersRevealed": false,
  "details": [
    { "questionId": 501, "type": "multi", "yourAnswer": { "selectedOptionKeys": ["A"] },
      "correctAnswer": null, "score": 0, "maxScore": 10, "analysis": null, "revealed": false }
  ]
}
```

`answersRevealed` 由场次的 `answerPolicy` 与考生状态共同决定：开考即公布（`immediately`）、本人交卷后（`after_submit`）、场次关闭后（`after_close`）。没到公布时机，`correctAnswer` / `analysis` 一律为空。

**`GET /my/results`**：我的成绩列表（每场考试的总分、总分上限、待阅标记与可见性）。

---

## 9. 监考

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/exam-sessions/{id}/monitoring` | `proctor:monitor` | 监考初始快照 |
| POST | `/attempts/{id}/proctor-actions` | `proctor:act` | 警告/备注/强制交卷 |
| GET | `/attempts/{id}/proctor-actions` | `proctor:monitor` | 处置历史 |

**实时通道**：`ws://host/hubs/proctoring?access_token=...`（SignalR）

| 方法 | 参数 | 说明 |
|---|---|---|
| `SubscribeExam` | `examSessionId` | 加入场次分组 |
| `UnsubscribeExam` | `examSessionId` | 离开 |
| `JoinAsProctor` | `examSessionId` | 鉴权（需 `proctor:monitor`） |

服务端推送事件：

| 事件 | 载荷 |
|---|---|
| `ExamStatusBatch` | `{ examSessionId, serverTime, candidates: [{ attemptId, userId, displayName, status, focusLossCount, disconnectCount, lastHeartbeatAt, answeredCount, totalCount }] }` |
| `ProctorActionIssued` | `{ attemptId, actionType, message, operatorName }` |
| `SessionStateChanged` | `{ attemptId, from, to }` |

推送频率：每 2 秒聚合一批。断线后客户端自动重连并重新拉取快照。

**`POST /attempts/{id}/proctor-actions`**

```json
{ "actionType": "force_submit", "message": "多次切屏，系统强制交卷", "reason": "切屏超限" }
```

---

## 10. 阅卷与成绩

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/review-tasks` | `review:grade` | 阅卷队列 |
| GET | `/review-tasks/{id}` | `review:grade` | 详情（含评分要点命中） |
| POST | `/review-tasks/{id}/claim` | `review:grade` | 领取 |
| POST | `/review-tasks/{id}/assign` | `review:grade` | 指派 |
| POST | `/review-tasks/{id}/grade` | `review:grade` | 评分 |
| POST | `/review-tasks/batch-adopt` | `review:batch-adopt` | 批量采纳初判 |
| GET | `/exam-sessions/{id}/grades` | `analytics:read` | 成绩列表 |
| POST | `/exam-sessions/{id}/publish-grades` | `grade:publish` | 发布成绩 |

**`GET /review-tasks` 查询参数**：`examSessionId`、`questionId`、`status`（`pending`/`in_review`/`reviewed`）、`assigneeId`、`mine`（只看指派给我的）。

**`POST /review-tasks/{id}/grade`**

```json
{ "score": 7.5, "comment": "要点 1、2 覆盖到位，要点 3 缺失" }
```

```json
// 200
{ "reviewTaskId": 501, "status": "reviewed", "finalScore": 7.5, "maxScore": 10,
  "scoreResultStatus": "final", "revision": 1 }
```

**`POST /review-tasks/batch-adopt`**

```json
// 请求：点名任务，或按场次批量（两者至少给一个）
{ "taskIds": [501, 502], "examSessionId": 30, "questionId": 12,
  "comment": "系统初判，已批量采纳", "maxCount": 200, "confirm": true }
```

```json
// 200：逐条给出采纳与跳过
{ "total": 2, "adopted": 1, "skipped": 1,
  "items": [
    { "taskId": 501, "status": "adopted", "statusLabel": "已采纳", "finalScore": 7.5, "message": null },
    { "taskId": 502, "status": "skipped", "statusLabel": "已跳过", "finalScore": null,
      "message": "任务已不在待领取状态。" }
  ] }
```

**`POST /exam-sessions/{id}/publish-grades`**

```json
// 请求：范围 all（全部成绩）或 objective_only（只发布客观题）；
// includeAttemptIds 不给就按发布那一刻已经交卷的作答来
{ "scope": "all", "includeAttemptIds": [8821, 8822] }
```

```json
// 200
{ "id": 17, "examSessionId": 30, "scope": "all", "scopeLabel": "全部成绩",
  "publishedAt": "2026-11-14T09:00:00Z", "publishedBy": 5,
  "includedAttemptIds": [8821, 8822], "affectedAttempts": 2 }
```

发布之前，学生端只拿得到客观题分与「待阅」；发布之后才给完整成绩与改分流水。

---

## 11. 学习与分析

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/mistakes` | 登录 | 错题本（过滤：标签、题型、时间范围） |
| POST | `/mistakes/{questionId}/resolve` | 登录 | 重做正确后标记已掌握 |
| POST | `/mistakes/{questionId}/redo` | 登录 | 生成单题重做练习 |
| GET | `/abilities/profile` | 登录 | 能力画像（样本不足的不参与排序） |
| GET | `/practices` | 登录 | 可见练习列表 |
| GET | `/dashboard/summary` | 登录 | 工作台汇总 |
| GET | `/statistics/exam-sessions/{id}` | `analytics:read` | 成绩分析 |
| GET | `/statistics/questions/{id}` | `analytics:read` | 逐题正确率 |

**`GET /abilities/profile`**

```json
// 200
{ "total": 2, "insufficientCount": 1,
  "items": [
    { "abilityTagId": 12, "tagName": "计算能力", "masteryRate": 0.8482,
      "sampleSize": 5, "correctCount": 5, "sampleSufficient": true, "masteryLabel": "掌握" },
    { "abilityTagId": 15, "tagName": "表达能力", "masteryRate": 0.4000,
      "sampleSize": 2, "correctCount": 0, "sampleSufficient": false, "masteryLabel": "样本不足" }
  ] }
```

**`GET /mistakes`**：查询参数 `tagId`、`questionType`、`from`、`to`、`includeResolved`、`page`、`size`。标签过滤含标签子树。

**`POST /mistakes/{questionId}/redo`**

```json
// 200
{ "practiceAssignmentId": 9, "attemptId": 8802, "questionId": 501,
  "questionCode": "Q-2026-00123", "questionType": "single",
  "title": "错题重做：Q-2026-00123", "deadlineAt": "2026-11-15T09:00:00Z" }
```

**`GET /practices`**

查询参数 `keyword`（按标题）、`tagId`（按练习对应试卷的标签，父标签连子标签一起算）、`page`、`size`。
只返回该考生**看得见**的练习：已上架、在开放期内、命中开放范围（组织标签）。

```json
{
  "total": 2, "page": 1, "size": 20,
  "items": [
    { "id": 5, "title": "高等数学 · 极限与连续专项练习", "paperId": 12, "paperName": "极限与连续专项卷",
      "questionCount": 10, "totalScore": 50, "tagNames": ["高等数学"],
      "maxAttempts": 3, "usedAttempts": 1, "remainingAttempts": 2,
      "feedbackTiming": "immediate", "reflowMistakes": true, "suggestedMinutes": 30,
      "openAt": "2026-11-01T00:00:00Z", "closeAt": null, "publishedAt": "2026-10-31T08:00:00Z",
      "canStart": true }
  ]
}
```

**`GET /practices/{id}`**：与列表条目同结构；不在可见范围内的练习返回 404。

**`GET /dashboard/summary`**

```json
{
  "pendingPractices": 3,
  "ongoingExams": 1,
  "termAverageScore": 82.5,
  "pendingMistakes": 12,
  "ongoingExam": { "examSessionId": 30, "name": "计算机网络期中考试",
                   "openAt": "2026-06-18T08:00:00Z", "closeAt": "2026-06-18T10:00:00Z",
                   "note": null, "started": false },
  "recommendedPractices": [ { "id": 5, "title": "高等数学 · 极限与连续专项练习", "tagNames": ["高等数学"] } ],
  "recentResults": [ { "attemptId": 8801, "kind": "exam", "name": "高等数学期末考试",
                       "date": "2026-06-18", "score": 76, "total": 100, "status": "done" } ],
  "scoreTrend": [ { "date": "2026-03-01", "score": 71, "total": 100 } ],
  "mistakeDistribution": [ { "tagName": "极限", "group": "知识点", "count": 5 } ],
  "generatedAt": "2026-11-15T10:00:00Z"
}
```

> 工作台口径：
>
> - `termAverageScore` 是全部成绩记录的**得分率平均值（百分制）**，没有记录时为 `null`；
> - `score` 与 `total` 跟成绩报告同一套可见性规则——**成绩没发布之前，主观题的分不露出来**；
> - `ongoingExams` 只算该考生看得见（全员开放 / 在名单里 / 名单已物化）的进行中场次，`ongoingExam` 取其中最先结束的一场；
> - `mistakeDistribution` 按**知识点标签**分组，没有知识点标签时回退到领域标签，都没有算「未归类」；
> - 空数据时计数为 0、列表为空，`termAverageScore` 为 `null`——前端据此显示空态与引导入口。

**`GET /statistics/exam-sessions/{id}`**

```json
{
  "examSessionId": 30, "examSessionName": "计算机网络期中考试",
  "participantCount": 120, "submittedCount": 118, "absentCount": 2,
  "averageScore": 76.4, "maxScore": 98, "minScore": 52, "scoreRange": 46,
  "passRate": 0.82, "excellentRate": 0.31,
  "scoreBuckets": [ { "label": "90 分以上", "count": 12 }, { "label": "80–90", "count": 19 } ],
  "typeStatistics": [ { "type": "single", "typeLabel": "单选题", "answeredCount": 120,
                        "averageScore": 8.2, "scoreRate": 0.82 } ],
  "questionStatistics": [ { "questionId": 501, "code": "Q-2026-00123", "type": "multi", "typeLabel": "多选题",
                            "stem": "以下哪些协议可以建立可靠传输？", "maxScore": 10,
                            "answeredCount": 118, "correctCount": 74,
                            "correctRate": 0.63, "averageScore": 6.3, "mastery": 0.63,
                            "suggestion": "正确率低于 60%，建议安排讲评。" } ],
  "roster": [ { "userId": 30012, "username": "linzhiyuan", "displayName": "林知远",
                "objectiveScore": 60, "subjectiveScore": 14, "totalScore": 74, "totalMax": 100,
                "scoreRate": 0.74, "submittedAt": "2026-06-18T09:20:00Z" } ],
  "updatedAt": "2026-11-15T10:00:00Z"
}
```

> `roster` 是逐人成绩明细：每位考生的客观分、主观分、总分与得分率，按总分从高到低排。
> `suggestion` 是逐题讲评建议：正确率或得分率低于 60% 就提示安排讲评，没人作答的题不给建议。

**`GET /statistics/questions/{id}`**

```json
{
  "questionId": 501, "code": "Q-2026-00123", "type": "multi", "typeLabel": "多选题",
  "stem": "以下哪些协议可以建立可靠传输？", "maxScore": 10,
  "sessionCount": 3, "answeredCount": 354, "correctCount": 220,
  "correctRate": 0.6215, "averageScore": 6.2, "mastery": 0.62,
  "suggestion": "正确率低于 60%，建议安排讲评。",
  "sessions": [ { "examSessionId": 30, "examSessionName": "计算机网络期中考试",
                  "answeredCount": 118, "correctCount": 74,
                  "correctRate": 0.6271, "averageScore": 6.3, "mastery": 0.63 } ]
}
```

**统计口径**

| 指标 | 口径 |
|---|---|
| 统计对象 | **已交卷**的作答；重考按最后一次取一份（试卷设了「重考取最好」则取分数最高的一次） |
| 应考 / 缺考 | 应考 = 名单上的考生 ∪ 进过考场的考生；缺考 = 应考 − 交卷 |
| 及格率 | 总分 ≥ 及格分即及格。及格分优先取**试卷设置的及格分**，未设置时按 60% 得分率兜底 |
| 优秀率 | 得分率 ≥ 85% 即优秀 |
| 分数段 | 按**得分率**分档：90 分以上 / 80–90 / 70–80 / 60–70 / 60 分以下（满分是该场考试的试卷总分） |
| 作答应数 | 该题**真正作答（非空白）**的人次；空白答案不进分母 |
| 正确率 | 拿到该题**满分**的人次 ÷ 作答应数 |
| 掌握度 | 该题总得分 ÷ 总满分 |
| 题型得分率 | 该题型总得分 ÷ 该题型总满分 |

统计读模型是派生数据：查询时若读模型落后于原始作答数据会当场重算，保证统计与作答数据始终一致；
`Exam.Worker` 另有定时作业，每隔几分钟增量重算落后的场次、每天一次全量重算。

---

## 12. SignalR 契约

Hub 地址：`/hubs/proctoring`（管理端）与 `/hubs/exam`（学生端，接收警告与强制交卷通知）。

**学生端事件**

| 事件 | 载荷 |
|---|---|
| `ProctorWarning` | `{ attemptId, message, occurredAt }` |
| `ForceSubmitted` | `{ attemptId, reason, occurredAt }` |
| `SessionRevoked` | `{ attemptId, reason }` |

鉴权：SignalR 通过 `access_token` 查询参数或 `Authorization` 头传递 JWT。浏览器 WebSocket 无法自定义头，**同时支持两种方式**，并在服务端校验。

---

## 13. 健康检查与可观测端点

| 路径 | 说明 |
|---|---|
| `/health/live` | 进程存活 |
| `/health/ready` | PG / Redis / 对象存储就绪检查 |
| `/health/startup` | 迁移与种子完成标记 |
| `/metrics` | Prometheus 指标（内部网络暴露） |
| `/swagger` | OpenAPI 文档（开发环境与内网） |

---

## 14. 契约演进

- 路径版本：`/api/v1`。破坏性变更发布 `/api/v2`，`v1` 至少并行维护一个学期。
- 字段新增为**向后兼容**，客户端必须忽略未知字段。
- 字段删除或语义变更必须升版本。
- OpenAPI 文档由代码生成，CI 中与已提交的基线做差异检查，未同步更新即失败。

---

## 附录 A · 前端 mock 模型与 API 的字段映射

> 原型实现阶段，前端数据全部来自本地 mock 层（`frontend/shared/src/mock/`）。
> 本表给出**逐字段**的映射，接后端时按此对照即可，界面层不用改。

### A.1 标识符

| 前端 | API | 说明 |
|---|---|---|
| `Question.id`（`"q-m-01"`） | `questionId`（long） | 前端用可读字符串便于 mock 与调试；API 边界做映射 |
| `ExamPaper.id`（`"exam-net-mid"`） | `paperId`（long） | 同上 |
| `Tag.id`（`"t-dom-calc"`） | `tagId`（long） | 同上 |
| `Student.id`（`"2023120101"`） | `userId`（long） | 学号是账号，不是主键 |
| `Student.classId`（`"c2301"`） | `organizationTagId`（long） | **组织维度以标签表达**，不是外键到组织树 |

### A.2 题目

| 前端字段 | API 字段 | 说明 |
|---|---|---|
| `Question.code` | `code` | 题号，全局唯一 |
| `Question.type` | `type` | `single` / `multi` / `judge` / `short` / `comprehensive` |
| `Question.stem` | `stem` | 题干（Markdown） |
| `Question.defaultScore` | `defaultScore` | 默认分值 1..40 |
| `Question.status` | `status` | `draft` / `published` / `disabled` |
| `Question.source` | `source` | `manual` / `import` / `generated`（原型用 `ai`，API 用 `generated`） |
| `Question.tags` | `tagIds` | 最多 5 个；不含难度维度（难度单列） |
| `Question.difficultyTagId` | `difficultyTagId` | 难度维度的冗余列 |
| `Question.options` | `options` | `{ key, text }[]` |
| `Question.answer` | `referenceAnswerKeys` | 客观题的正确选项键数组 |
| `Question.keypoints` | `keypoints` | `{ text, keywords }[]` |
| `Question.steps` | `steps` | `{ id, prompt, answer, keywords, score }[]` |
| `Question.analysis` | `analysis` | 解析 |
| `Question.reference` | `referenceAnswer` | 参考答案（简答题） |

### A.3 卷面与配分

| 前端 | API | 说明 |
|---|---|---|
| `ExamPaper.items`（`{qid, score}[]`） | `paperItems`（`{questionId, score}[]`） | **配分口径的唯一来源**，三处（抽题、判分、发布校验）必须一致 |
| `ExamPaper.questionIds` | 由 `paperItems` 派生 | 前端存两份只为方便，API 只存 items |
| `ExamPaper.plum.mode` | `variantMode` | `standard` / `small` / `large` |
| `ExamPaper.scope`（名单组 ID） | `scopeTagIds` | 组织维度标签 ID 数组，空 = 全员开放 |
| `ExamPaper.publishAnswer` | `publishAnswerPolicy` | `after_close` / `after_submit` / `on_open`（原型 `immediately` → API `on_open`） |
| `ExamPaper.passScore` | `passScore` | 及格分 |

### A.4 答案载荷

| 前端（`AnswerPayload`） | API（`payload`） | 说明 |
|---|---|---|
| `selectedOptionKey` | `{ selectedOptionKeys: [...] }` | 统一用数组承载单选（单值数组） |
| `selectedOptionKeys` | `{ selectedOptionKeys: [...] }` | 多选，去重排序 |
| `text` | `{ text }` | 简答 |
| `steps`（`{stepCode, text}[]`） | `{ steps: [{ code, text }] }` | 综合题逐步作答 |
| — | `{ selectedOptionKeys }` | **存显示字母还是原题键？** |

**待确认（会影响正确性）**：前端当前存**卷面显示字母**，判分时经卷面的 `toOriginal` 还原成原题键。
服务端判分时同样需要「显示字母 → 原题键」的映射。建议服务端存**原题键**（由客户端在提交时用
`toOriginal` 转换），这样服务端不需要知道卷面的置换规则；客户端保留显示字母仅用于回看展示。

> 这条必须在 P4 接后端前定下来，否则会出现「客户端按显示字母判、服务端按原题键判」的口径分裂。

### A.5 作答批次

| 前端 | API | 说明 |
|---|---|---|
| `AnswerBatch.attemptId` | `attemptId` | 会话 ID |
| `AnswerBatch.clientSeq` | `clientSeq` | 会话内单调递增，**批次创建时分配并持久化，重放不变** |
| `AnswerBatch.items` | `items` | `{ questionId, payload }[]` |
| `AnswerBatch.createdAt` | `clientSentAt` | 客户端发送时间 |
| — | `acceptedClientSeq`（响应） | 服务端已接受的最大序号；客户端删除 `clientSeq ≤` 的批次 |

### A.6 阅卷

| 前端 | API | 说明 |
|---|---|---|
| `ReviewItem.qid` | `questionId` | |
| `ReviewItem.stepId` | `stepId` | 综合题按步骤拆分时非空 |
| `ReviewItem.attempt` | `attemptNo` | **必须匹配**，重考不串号 |
| `ReviewItem.teacherScore` | `teacherScore` | |
| `ReviewItem.comment` | `comment` | 答题端成绩报告可见 |

### A.7 标签

| 前端 | API | 说明 |
|---|---|---|
| `Tag.group`（英文枚举） | `group`（枚举 `domain`/`knowledge_point`/`ability`/`difficulty`/`organization`） | 展示时用 `TAG_GROUP_LABEL` 映射中文名 |
| `Tag.level` | `level` | 仅难度分组下有值 1/2/3 |
| `Tag.id`（`"t-dom-calc"`） | `tagId`（long） | |

**组织维度**：前端当前类型 `TagGroup` 只含前四组——组织维度**只挂用户**，不挂题目与试卷。
接后端时给 `User` 增加 `organizationTagIds`，`TagGroup` 补 `organization` 即可。
