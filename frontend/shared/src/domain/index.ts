/* ==========================================================================
   知行测评 · 共享领域类型出口
   ========================================================================== */

/* 内容域：题目 / 题库 / 试卷 / 练习 / 标签 / 学生等（design 03 §3–§4）。 */
export * from "./types";

/* 管理域：场次、名单、成绩与组织标签。 */
export {
  type AdminAuditLog,
  type AdminRole,
  type AdminSessionDetail,
  type AdminSessionRules,
  type AdminSessionSummary,
  type AdminUser,
  type AdminUserImportResult,
  type AdminUserOrganization,
  type AdminUserStatus,
  type OrgTag,
  type SessionAssignment,
  type SessionGrade,
  type SessionParticipant,
} from "./admin";

/* 阅卷与监考域：阅卷任务、卷宗详情与监考处置。 */
export {
  type BatchAdoptItem,
  type BatchAdoptResult,
  type ProctorActionEntry,
  type ProctorActionKind,
  type ReviewCounts,
  type ReviewGradeResult,
  type ReviewKeypoint,
  type ReviewStep,
  type ReviewTask,
  type ReviewTaskDetail,
  type ReviewTaskStatus,
} from "./review";

/* 学习域：错题本与学生工作台（design 03 §6）。 */
export {
  type DashboardSummary,
  type MistakeDistribution,
  type MistakeEntry,
  type OngoingExam,
  type RecentResult,
  type RecommendedPractice,
  type RedoMistake,
  type ScoreTrendPoint,
} from "./learning";

/* 作答域：答案载荷、作答批次、切屏事件（design 03 §5.3–§5.7）。 */
export {
  isFocusLoss,
  isPayloadEmpty,
  type AnswerBatch,
  type AnswerBatchItem,
  type AnswerPayload,
  type AttemptFeedback,
  type AttemptFeedbackQuestion,
  type AttemptReport,
  type AttemptRules,
  type AttemptStatus,
  type AttemptSummary,
  type AttemptSurface,
  type MyResult,
  type PracticeSummary,
  type ReportDetail,
  type FocusEventType,
  type SubmitReason,
  type SurfaceAttachment,
  type SurfaceOption,
  type SurfaceQuestion,
  type SurfaceStep,
} from "./attempt";
