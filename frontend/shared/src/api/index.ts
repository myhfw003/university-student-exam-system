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
  toDomainPayload,
  toServerAnswerBatch,
  toServerPayload,
  type ServerAnswerBatch,
  type ServerAnswerPayload,
  type ServerAnswerStep,
} from "./answerPayload";
export { apiBaseUrl, dataSourceMode, isBackendEnabled, type DataSourceMode } from "./dataSource";
export { loadCatalogSnapshot, type CatalogClient, type CatalogSnapshot } from "./catalogApi";
export {
  loadMyExamSessions,
  type ExamSessionStatus,
  type ExamSessionSummary,
} from "./examSessionApi";
