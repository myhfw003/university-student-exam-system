/* ==========================================================================
   知行测评 · 作答载荷的线格式转换
   --------------------------------------------------------------------------
   前端领域载荷（04 设计 §A.4）与后端 `SaveAnswersRequest` 的字段名不同：

   - 单选/判断：前端 `selectedOptionKey`（单值）↔ 后端 `selectedOptionKeys`（数组）
   - 综合题步骤：前端 `steps[].stepCode` ↔ 后端 `steps[].code`
   - 批次时间：前端 `createdAt` ↔ 后端 `clientSentAt`

   还要换算**选择键的口径**：卷面上给考生看的是显示字母（A/B/C…），
   服务端判分用的是**原题键**——梅花卷置换过选项，两者不是一回事。
   上行前换算成原题键，对账回填时换算回显示字母，两头都只在这一层发生。

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

/**
 * 选择键换算表：题目 ID → （显示字母 → 原题键）。
 *
 * 由服务端下发的卷面派生：卷面按显示顺序给出选项，位置即显示字母，
 * 选项的 `key` 是原题键。
 */
export type OptionKeyMap = Record<string, Record<string, string>>;

/** 换算表求反向（原题键 → 显示字母）。 */
function invertKeyMap(map: Record<string, string>): Record<string, string> {
  const inverse: Record<string, string> = {};
  for (const [display, original] of Object.entries(map)) inverse[original] = display;
  return inverse;
}

/** 显示字母 → 原题键。表中没有的键原样保留。 */
export function toOriginalKeys(keys: readonly string[], map?: Record<string, string>): string[] {
  if (!map) return [...keys];
  return keys.map((key) => map[key] ?? key);
}

/** 原题键 → 显示字母。表中没有的键原样保留。 */
export function toDisplayKeys(keys: readonly string[], map?: Record<string, string>): string[] {
  if (!map) return [...keys];
  const inverse = invertKeyMap(map);
  return keys.map((key) => inverse[key] ?? key);
}

/**
 * 前端载荷 → 后端载荷。
 *
 * @param payload 前端载荷（选择键是显示字母）。
 * @param keyMap 该题的选择键换算表；给了就把显示字母换成原题键。
 */
export function toServerPayload(
  payload: AnswerPayload,
  keyMap?: Record<string, string>,
): ServerAnswerPayload {
  const keys = payload.selectedOptionKeys?.length
    ? payload.selectedOptionKeys
    : payload.selectedOptionKey
      ? [payload.selectedOptionKey]
      : [];

  const out: ServerAnswerPayload = {
    selectedOptionKeys: [...new Set(toOriginalKeys(keys, keyMap))].sort(),
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

/**
 * 一批答案 → 后端批量保存请求体。
 *
 * @param batch 前端批次（选择键是显示字母）。
 * @param keyMap 各题的选择键换算表；给了就把显示字母换成原题键。
 */
export function toServerAnswerBatch(
  batch: AnswerBatch,
  keyMap?: OptionKeyMap,
): ServerAnswerBatch {
  return {
    clientSeq: batch.clientSeq,
    items: batch.items.map((item) => ({
      questionId: toServerQuestionId(item.questionId),
      payload: toServerPayload(item.payload, keyMap?.[item.questionId]),
    })),
    clientSentAt: batch.createdAt,
  };
}

/**
 * 后端载荷 → 前端载荷（断点恢复时回填本地）。
 *
 * @param payload 后端载荷（选择键是原题键）。
 * @param keyMap 该题的选择键换算表；给了就把原题键换回显示字母。
 */
export function toDomainPayload(
  payload: ServerAnswerPayload,
  keyMap?: Record<string, string>,
): AnswerPayload {
  const keys = toDisplayKeys(payload.selectedOptionKeys ?? [], keyMap);
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
