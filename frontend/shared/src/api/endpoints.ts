/* ==========================================================================
   知行测评 · API 端点常量
   按上下文分组；路径前缀见 docs/design/05-api.md。
   骨架阶段仅登记路径，不发起真实请求。
   ========================================================================== */

const BASE = "/api/v1";

export const ENDPOINTS = {
  auth: {
    login: `${BASE}/auth/login`,
    refresh: `${BASE}/auth/refresh`,
    logout: `${BASE}/auth/logout`,
    me: `${BASE}/auth/me`,
    changePassword: `${BASE}/auth/change-password`,
  },
  system: {
    time: `${BASE}/system/time`,
  },
  catalog: {
    tags: `${BASE}/tags`,
    banks: `${BASE}/banks`,
    questions: `${BASE}/questions`,
    papers: `${BASE}/papers`,
  },
  delivery: {
    examSessions: `${BASE}/exam-sessions`,
    assignments: `${BASE}/assignments`,
    attempts: `${BASE}/attempts`,
  },
  learning: {
    reports: `${BASE}/reports`,
    mistakes: `${BASE}/mistakes`,
    practiceResults: `${BASE}/practice-results`,
  },
  admin: {
    users: `${BASE}/admin/users`,
    resetPassword: (id: string) => `${BASE}/admin/users/${id}/reset-password`,
    roles: `${BASE}/admin/roles`,
    auditLogs: `${BASE}/admin/audit-logs`,
    analytics: `${BASE}/admin/analytics`,
    review: `${BASE}/admin/review`,
  },
} as const;
