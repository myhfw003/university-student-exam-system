/* ==========================================================================
   知行测评 · 作答载荷的线格式转换
   --------------------------------------------------------------------------
   前端领域载荷（04 设计 §A.4）与后端 `SaveAnswersRequest` 的字段名不同：

   - 单选/判断：前端 `selectedOptionKey`（单值）↔ 后端 `selectedOptionKeys`（数组）
   - 综合题步骤：前端 `steps[].stepCode` ↔ 后端 `steps[].code`
   - 批次时间：前端 `createdAt` ↔ 后端 `clientSentAt`

   转换只在这一层发生，同步引擎与传输层都复用这里，避免两处各写一套。
   ========================================================================== */

import type { AnswerBatch, AnswerPayload } from "../domain/attempt";

/** 后端分步作答。 */
export interface ServerAnswerStep {
  code?: string | null;
  text?: string | null;
}

/** 后端答案载荷（字段与 `AnswerPayloadRequest` 一致）。 */
export interface ServerAnswerPayload {
  selectedOptionKeys?: string[] | null;
  text?: string | null;
  steps?: ServerAnswerStep[] | null;
}

/** 后端一条答案。 */
export interface ServerAnswerItem {
  questionId: number | string;
  payload: ServerAnswerPayload;
}

/** 后端批量保存请求体。 */
export interface ServerAnswerBatch {
  clientSeq: number;
  items: ServerAnswerItem[];
  clientSentAt: string;
}

/**
 * 题目前端 ID 转后端主键。
 * 后端主键是 long；纯数字 ID 必须发数字，JSON 字符串不会隐式转 long。
 */
function toServerQuestionId(questionId: string): number | string {
  const numeric = Number(questionId);
  return Number.isInteger(numeric) && String(numeric) === questionId ? numeric : questionId;
}

/** 前端载荷 → 后端载荷。 */
export function toServerPayload(payload: AnswerPayload): ServerAnswerPayload {
  const keys = payload.selectedOptionKeys?.length
    ? payload.selectedOptionKeys
    : payload.selectedOptionKey
      ? [payload.selectedOptionKey]
      : [];

  const out: ServerAnswerPayload = {
    selectedOptionKeys: [...new Set(keys)].sort(),
  };

  if (typeof payload.text === "string") out.text = payload.text;

  if (payload.steps && payload.steps.length > 0) {
    out.steps = payload.steps.map((step) => ({
      code: step.stepCode,
      text: step.text,
    }));
  }

  return out;
}

/** 一批答案 → 后端批量保存请求体。 */
export function toServerAnswerBatch(batch: AnswerBatch): ServerAnswerBatch {
  return {
    clientSeq: batch.clientSeq,
    items: batch.items.map((item) => ({
      questionId: toServerQuestionId(item.questionId),
      payload: toServerPayload(item.payload),
    })),
    clientSentAt: batch.createdAt,
  };
}

/** 后端载荷 → 前端载荷（断点恢复时回填本地）。 */
export function toDomainPayload(payload: ServerAnswerPayload): AnswerPayload {
  const keys = payload.selectedOptionKeys ?? [];
  const out: AnswerPayload = {};

  if (keys.length === 1) out.selectedOptionKey = keys[0] ?? null;
  else if (keys.length > 1) out.selectedOptionKeys = [...keys];

  if (typeof payload.text === "string") out.text = payload.text;

  if (payload.steps && payload.steps.length > 0) {
    out.steps = payload.steps.map((step) => ({
      stepCode: step.code ?? "",
      text: step.text ?? "",
    }));
  }

  return out;
}
