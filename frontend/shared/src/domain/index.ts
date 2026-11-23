/* ==========================================================================
   知行测评 · 共享领域类型出口
   ========================================================================== */

/* 内容域：题目 / 题库 / 试卷 / 练习 / 标签 / 学生等（design 03 §3–§4）。 */
export * from "./types";

/* 审计域：动作码、中文名与业务分组（与后端写出的动作码一一对应）。 */
export {
  AUDIT_ACTION_GROUPS,
  AUDIT_ACTION_LABEL,
  AUDIT_ENTITY_TYPE_LABEL,
  auditActionGroupOf,
  auditActionLabel,
  type AuditActionGroup,
} from "./audit";

/* 练习域：练习开放单的状态词表与管理端行（与后端 PracticeAssignment 对齐）。 */
export {
  PRACTICE_ASSIGNMENT_STATUS_LABEL,
  practiceAssignmentStatusLabel,
  type AdminPracticeAssignment,
  type PracticeAssignmentStatus,
} from "./practice";

/* 试卷域：服务端的试卷状态词表（与后端 PaperStatuses 对齐）。 */
export {
  PAPER_STATUS,
  type PaperStatus,
} from "./paper";

/* 管理域：场次、名单、成绩与组织标签。 */
export {
  type AdminAuditLog,
  type AdminPermission,
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

/* 能力画像域：按能力维度聚合的掌握情况（design 03 §7.2）。 */
export {
  MASTERY_LABEL,
  type AbilityProfile,
  type AbilityProfileItem,
  type AbilityProfileSeed,
  type MasteryLabel,
} from "./ability";

/* 系统设置域：全局生效的开关与前后端共用的取值词表。 */
export {
  DEFAULT_MISTAKE_RESOLUTION_POLICY,
  MISTAKE_RESOLUTION_POLICY,
  MISTAKE_RESOLUTION_POLICY_HINT,
  MISTAKE_RESOLUTION_POLICY_LABEL,
  toMistakeResolutionPolicy,
  type MistakeResolutionPolicy,
  type SystemSettings,
} from "./settings";

/* 标签域：维度与内容维度（内容维度之间可以跨维度成树，FR-CAT-02）。 */
export { CONTENT_TAG_GROUPS, type TagGroup } from "./types";

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
