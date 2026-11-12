/* ==========================================================================
   知行测评 · ProblemDetails 解析与错误码文案
   契约来源：docs/design/05-api.md §1.2 与 docs/design/03-domain-model.md §11。
   错误文案集中在此表，组件内不散落文案。
   ========================================================================== */

/** RFC 7807 ProblemDetails 响应体。 */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  /** 领域错误码（稳定契约），前端按此做文案与分支。 */
  errorCode?: number;
  /** 链路追踪 ID，用户报障时提供。 */
  traceId?: string;
  instance?: string;
  /** 字段级校验错误。 */
  errors?: Record<string, string[]>;
}

/**
 * 领域错误码 → 中文文案映射表骨架。
 * 键取自 03-domain-model.md §11 的错误码表；值按需补充更具体的表述。
 */
export const ERROR_MESSAGE_MAP: Readonly<Record<number, string>> = Object.freeze({
  20001: "请求参数校验失败",
  20002: "数据已被他人修改，请刷新后重试",
  20003: "资源不存在或已被删除",
  20004: "没有执行该操作的权限",
  20005: "操作不符合业务规则",
  21001: "当前状态不允许该操作",
  22001: "编码已存在，请换一个",
  22101: "标签已被引用，不可删除",
  23001: "题目内容不合法",
  23101: "组卷题池量不足",
  24001: "发布校验未通过",
  24101: "试卷已发布，不可修改题位",
  25001: "会话状态不允许该操作",
  25002: "已超过作答截止时间",
  25003: "已交卷",
  25004: "超过可提交次数",
  25101: "切屏次数超限",
  26001: "判分异常，请联系管理员并提供 traceId",
  27001: "导入行数据非法",
  28001: "标签层级成环",
  28002: "标签被引用，不可删除",
});

/** 兜底文案：按 HTTP 状态码给出通用提示。 */
export const STATUS_MESSAGE_MAP: Readonly<Record<number, string>> = Object.freeze({
  400: "请求有误，请检查后重试",
  401: "登录已失效，请重新登录",
  403: "没有执行该操作的权限",
  404: "资源不存在或已被删除",
  409: "数据存在冲突，请刷新后重试",
  422: "提交的内容未通过校验",
  429: "操作过于频繁，请稍后再试",
  500: "服务器异常，请稍后重试",
  502: "网关异常，请稍后重试",
  503: "服务暂时不可用，请稍后重试",
  504: "网关超时，请稍后重试",
});

/** 网络层通用文案。 */
export const NETWORK_ERROR_MESSAGE = "网络异常，请稍后重试";

/** 归一化后的错误对象，供 UI 展示与分支判断。 */
export interface NormalizedProblem {
  /** 领域错误码，无则为空。 */
  errorCode?: number;
  /** HTTP 状态码，无则为空。 */
  status?: number;
  /** 面向用户的中文主文案。 */
  message: string;
  /** 服务端返回的详细说明（可为空）。 */
  detail?: string;
  /** 字段级校验错误。 */
  errors?: Record<string, string[]>;
  /** 链路追踪 ID。 */
  traceId?: string;
  /** 原始 ProblemDetails 载荷。 */
  problem?: ProblemDetails;
}

/** 从错误码取文案；未登记的错误码回落到标题 / 详情。 */
export function messageForErrorCode(
  errorCode: number | undefined,
  fallback?: string | undefined,
): string | undefined {
  if (errorCode === undefined) return fallback;
  return ERROR_MESSAGE_MAP[errorCode] ?? fallback;
}

/** 把 ProblemDetails 归一化为统一的错误结构。 */
export function normalizeProblem(problem: ProblemDetails | null | undefined): NormalizedProblem {
  const status = problem?.status;
  const mapped =
    messageForErrorCode(problem?.errorCode) ??
    (problem?.title ? problem.title : undefined) ??
    (status !== undefined ? STATUS_MESSAGE_MAP[status] : undefined) ??
    NETWORK_ERROR_MESSAGE;

  const normalized: NormalizedProblem = { message: mapped };
  if (problem?.errorCode !== undefined) normalized.errorCode = problem.errorCode;
  if (status !== undefined) normalized.status = status;
  if (problem?.detail !== undefined) normalized.detail = problem.detail;
  if (problem?.errors !== undefined) normalized.errors = problem.errors;
  if (problem?.traceId !== undefined) normalized.traceId = problem.traceId;
  if (problem) normalized.problem = problem;
  return normalized;
}

/** 解析响应体为 ProblemDetails；解析失败时返回 null。 */
export async function parseProblemDetails(response: Response): Promise<ProblemDetails | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as ProblemDetails;
  } catch {
    return null;
  }
}
