/* ==========================================================================
   知行测评 · API 端点常量
   --------------------------------------------------------------------------
   路径与 `docs/api/openapi.json` 一一对应（后端控制器上的 `[Route]` 是唯一来源）。
   **常量是相对 API 根的路径**：实际前缀由 `apiBaseUrl()` 决定——
   同源部署时是 `/api/v1`（由 nginx 反代），跨域部署时是
   `VITE_API_BASE_URL`（如 `https://api.example.edu/api/v1`）。

   这样两种部署形态共用一套常量，不会出现 `/api/v1/api/v1/...` 的双前缀；
   `frontend/e2e/frontend-contract.api.spec.ts` 会校验这些路径在真实后端存在。
   ========================================================================== */

export const ENDPOINTS = {
  auth: {
    login: "/auth/login",
    refresh: "/auth/refresh",
    logout: "/auth/logout",
    me: "/auth/me",
    changePassword: "/auth/change-password",
  },
  system: {
    time: "/system/time",
  },
  catalog: {
    tags: "/tags",
    /** 试题导入批次：上传 → 调列映射 → 采纳。 */
    imports: "/imports",
    banks: "/question-banks",
    questions: "/questions",
    papers: "/papers",
    /** 卷型模板：套用与另存。 */
    paperTemplates: "/paper-templates",
    questionFilters: "/questions/filters",
  },
  delivery: {
    examSessions: "/exam-sessions",
    /** 学生端可见的练习列表（只列自己看得见的）。 */
    practices: "/practices",
    /** 管理端练习开放单。 */
    practiceAssignments: "/practice-assignments",
    attempts: "/attempts",
    /**
     * 开始作答。
     *
     * 与 `attempts` 同路径：幂等——已有进行中的会话时服务端返回同一个，
     * 不会新建，因此前端刷新后重新进入即可续上。
     */
    startAttempt: "/attempts",
    /** 一次作答的完整视图（卷面 + 已有答案 + 服务端时间）。 */
    attempt: (id: string | number) => `/attempts/${id}`,
    /** 批量保存答案。 */
    attemptAnswers: (id: string | number) => `/attempts/${id}/answers`,
    /** 交卷。 */
    attemptSubmit: (id: string | number) => `/attempts/${id}/submit`,
    /** 上报焦点事件（切屏采集）。 */
    attemptFocusEvents: (id: string | number) => `/attempts/${id}/focus-events`,
    /** 心跳。 */
    attemptHeartbeat: (id: string | number) => `/attempts/${id}/heartbeat`,
    /** 练习即时反馈。 */
    attemptFeedback: (id: string | number) => `/attempts/${id}/feedback`,
    /** 监考快照（轮询；2 秒一批）。 */
    monitoring: (id: string | number) => `/exam-sessions/${id}/monitoring`,
    /** 场次负责人：被指派的人看得到这场考试的作答与成绩。 */
    examSessionAssignments: (id: string | number) => `/exam-sessions/${id}/assignments`,
    /** 发布场次成绩（全部成绩 / 仅客观题）。 */
    examSessionPublishGrades: (id: string | number) =>
      `/exam-sessions/${id}/publish-grades`,
    /** 监考处置：警告 / 备注 / 强制交卷，按**一次作答**维度。 */
    attemptProctorActions: (id: string | number) => `/attempts/${id}/proctor-actions`,
  },
  learning: {
    /** 学生自己的成绩列表。 */
    myResults: "/my/results",
    /** 单次作答的成绩报告。 */
    attemptsReport: (attemptId: string | number) => `/attempts/${attemptId}/report`,
    /** 改分流水（学生端可见：改过几次分、谁改的）。 */
    attemptGradeRevisions: (attemptId: string | number) =>
      `/attempts/${attemptId}/grade-revisions`,
    /** 一次作答的成绩与逐题明细（含要点命中）。 */
    attemptsScores: (attemptId: string | number) => `/attempts/${attemptId}/scores`,
    mistakes: "/mistakes",
    dashboard: "/dashboard/summary",
    /** 我的能力画像（样本不足的不参与排序）。 */
    abilityProfile: "/abilities/profile",
  },
  admin: {
    users: "/users",
    resetPassword: (id: string | number) => `/users/${id}/reset-password`,
    /** 用户的组织归属标签。 */
    userTags: (id: string | number) => `/users/${id}/tags`,
    roles: "/roles",
    permissions: "/permissions",
    auditLogs: "/audit-logs",
    reviewTasks: "/review-tasks",
    /** 阅卷任务计数（待领取 / 阅卷中 / 已阅完 / 我的）。 */
    reviewTaskCount: "/review-tasks/count",
    statisticsBySession: (id: string | number) => `/statistics/exam-sessions/${id}`,
    statisticsByQuestion: (id: string | number) => `/statistics/questions/${id}`,
  },
} as const;
