/* ==========================================================================
   知行测评 · 共享领域类型出口
   ========================================================================== */

/* 内容域：题目 / 题库 / 试卷 / 练习 / 标签 / 学生等（design 03 §3–§4）。 */
export * from "./types";

/* 作答域：答案载荷、作答批次、切屏事件（design 03 §5.3–§5.7）。 */
export {
  isFocusLoss,
  isPayloadEmpty,
  type AnswerBatch,
  type AnswerBatchItem,
  type AnswerPayload,
  type AttemptRules,
  type AttemptStatus,
  type AttemptSummary,
  type AttemptSurface,
  type FocusEventType,
  type SubmitReason,
  type SurfaceAttachment,
  type SurfaceOption,
  type SurfaceQuestion,
  type SurfaceStep,
} from "./attempt";
