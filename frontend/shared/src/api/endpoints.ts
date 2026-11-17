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
    banks: "/question-banks",
    questions: "/questions",
    papers: "/papers",
    questionFilters: "/questions/filters",
  },
  delivery: {
    examSessions: "/exam-sessions",
    /** 学生端可见的练习列表（只列自己看得见的）。 */
    practices: "/practices",
    /** 管理端练习开放单。 */
    practiceAssignments: "/practice-assignments",
    attempts: "/attempts",
    /** 监考快照（轮询；2 秒一批）。 */
    monitoring: (id: string | number) => `/exam-sessions/${id}/monitoring`,
    /** 场次负责人：被指派的人看得到这场考试的作答与成绩。 */
    examSessionAssignments: (id: string | number) => `/exam-sessions/${id}/assignments`,
  },
  learning: {
    /** 学生自己的成绩列表。 */
    myResults: "/my/results",
    /** 单次作答的成绩报告。 */
    attemptsReport: (attemptId: string | number) => `/attempts/${attemptId}/report`,
    mistakes: "/mistakes",
    dashboard: "/dashboard/summary",
  },
  admin: {
    users: "/users",
    resetPassword: (id: string | number) => `/users/${id}/reset-password`,
    roles: "/roles",
    permissions: "/permissions",
    auditLogs: "/audit-logs",
    reviewTasks: "/review-tasks",
    statisticsBySession: (id: string | number) => `/statistics/exam-sessions/${id}`,
    statisticsByQuestion: (id: string | number) => `/statistics/questions/${id}`,
  },
} as const;
