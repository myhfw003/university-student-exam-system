export {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  HttpError,
  createHttpClient,
  httpClient,
  type HttpClientConfig,
  type HttpMethod,
  type RequestOptions,
} from "./httpClient";
export {
  ERROR_MESSAGE_MAP,
  NETWORK_ERROR_MESSAGE,
  STATUS_MESSAGE_MAP,
  messageForErrorCode,
  normalizeProblem,
  parseProblemDetails,
  type NormalizedProblem,
  type ProblemDetails,
} from "./problemDetails";
export {
  clearTokens,
  getAccessToken,
  getTokens,
  isExpired,
  setTokens,
  subscribeTokens,
  type TokenPair,
} from "./tokenStore";
export {
  isRefreshing,
  isUnauthorized,
  refreshOnce,
  withAuthRetry,
  type AuthInterceptorConfig,
  type OnAuthFailureFn,
  type RefreshTokenFn,
} from "./authInterceptor";
export { ENDPOINTS } from "./endpoints";
export { refreshAccessToken } from "./authRefresh";
export {
  toDisplayKeys,
  toDomainPayload,
  toOriginalKeys,
  toServerAnswerBatch,
  toServerPayload,
  type OptionKeyMap,
  type ServerAnswerBatch,
  type ServerAnswerPayload,
  type ServerAnswerStep,
} from "./answerPayload";
export { apiBaseUrl, dataSourceMode, isBackendEnabled, type DataSourceMode } from "./dataSource";
export {
  loadCatalogSnapshot,
  toPaperMode,
  type CatalogClient,
  type CatalogSnapshot,
} from "./catalogApi";
export {
  cancelAdminSession,
  closeAdminSession,
  createAdminSession,
  loadAdminSession,
  loadAdminSessions,
  loadExamSession,
  loadMyExamSessions,
  loadSessionAssignments,
  loadSessionGrades,
  loadSessionParticipants,
  publishAdminSession,
  setSessionAssignments,
  updateAdminSession,
  type AdminSessionCreate,
  type AdminSessionWrite,
  type ExamSessionAdminClient,
  type ExamSessionDetail,
  type ExamSessionStatus,
  type ExamSessionSummary,
} from "./examSessionApi";
export {
  assignUserRoles,
  assignUserTags,
  countUsers,
  importUserRoster,
  loadAdminUser,
  loadAuditLogs,
  loadOrgTags,
  loadRoles,
  loadUserOrganization,
  loadUserPage,
  revokeUserRole,
  toAdminUser,
  toUserStatus,
  updateAdminUser,
  type AdminAuditPage,
  type AdminClient,
  type AdminUserPage,
} from "./adminApi";
export {
  loadDashboardSummary,
  loadMistakes,
  redoMistake,
  resolveMistake,
  toMistakeEntry,
  type LearningClient,
} from "./learningApi";
export {
  loadAttemptFeedback,
  loadMyPractices,
  toPracticeSummary,
  type PracticeClient,
} from "./practiceApi";
export {
  loadAttemptReport,
  loadMyResults,
  toAttemptReport,
  type ReportClient,
} from "./reportApi";
export {
  buildOptionKeyMap,
  getAttempt,
  heartbeatAttempt,
  listMyAttempts,
  reportFocusEvents,
  startExamAttempt,
  startPracticeAttempt,
  submitAttempt,
  toAttemptSurface,
  type AttemptClient,
  type FocusEventInput,
  type FocusEventsResult,
  type HeartbeatResult,
  type SubmitResult,
} from "./attemptApi";
