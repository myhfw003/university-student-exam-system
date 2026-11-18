/* ==========================================================================
   知行测评 · 练习反馈 → 判分明细
   --------------------------------------------------------------------------
   练习的反馈由服务端给（`POST /attempts/{id}/feedback`）：正确答案、参考分与解析。
   前端把它映射成引擎的 `GradedPaper`，练习结果页的渲染逻辑就不用改。

   口径照旧：
   - 反馈里的正确答案键是**原题键**，要靠卷面的换算表换回显示字母；
   - 主观题没有「对错」，自动初判有分也仍是「待阅」——最终分以阅卷为准。
   ========================================================================== */

import type { AttemptFeedback, AttemptFeedbackQuestion, AttemptSurface } from "../domain/attempt";
import { surfaceItem } from "./paper";
import type { GradeStatus, GradedDetail, GradedPaper } from "./scoring";

/** 保留两位小数。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 判分状态。 */
function statusOf(question: AttemptFeedbackQuestion, answered: boolean): GradeStatus {
  if (question.type === "short" || question.type === "comprehensive") {
    // 主观题：自动初判有分也仍是「待阅」。
    return answered ? "pending" : "blank";
  }

  if (!answered) return "blank";
  if (question.correct === true) return "correct";
  if (question.score > 0 && question.maxScore > 0 && question.score < question.maxScore) {
    return "partial";
  }
  return "wrong";
}

/**
 * 由练习反馈构建整卷判分结果。
 *
 * @param surface 服务端卷面（选项顺序、标签、步骤）。
 * @param feedback 服务端反馈（正确与否、分数、正确答案、解析）。
 * @param responses 本地作答（选择键是显示字母）。
 */
export function gradedPaperFromFeedback(
  surface: AttemptSurface,
  feedback: AttemptFeedback,
  responses: Record<string, { choice?: string[]; text?: string; steps?: Record<string, string> }> = {},
): GradedPaper {
  const items = new Map(surface.questions.map((question) => [question.id, surfaceItem(question)]));

  let objectiveScore = 0;
  let objectiveMax = 0;
  let subjectiveScore = 0;
  let subjectiveMax = 0;
  let pending = 0;

  const details: GradedDetail[] = feedback.questions.map((question, index) => {
    const item = items.get(question.questionId);
    const fromOriginal = item?.fromOriginal ?? {};
    const response = responses[question.questionId] ?? {};

    const pickedDisplay = response.choice ?? [];
    const pickedOriginal = pickedDisplay.map((key) => fromOriginal[key] ?? key);

    const isSubjective = question.type === "short" || question.type === "comprehensive";
    const answered = question.answered;

    if (isSubjective) {
      subjectiveMax += question.maxScore;
      if (answered) {
        pending += 1;
        subjectiveScore += question.score;
      }
    } else {
      objectiveMax += question.maxScore;
      objectiveScore += question.score;
    }

    const base = item?.question;
    const question_ = base
      ? {
          ...base,
          analysis: question.analysis ?? "",
          ...(question.referenceAnswer ? { reference: question.referenceAnswer } : {}),
        }
      : {
          id: question.questionId,
          type: question.type,
          score: question.maxScore,
          status: "published" as const,
          source: "manual" as const,
          tags: [],
          stem: "",
          answer: [],
          analysis: question.analysis ?? "",
        };

    return {
      qid: question.questionId,
      slot: index + 1,
      type: question.type,
      question: question_,
      displayKeys: item?.displayKeys ?? [],
      toOriginal: item?.toOriginal ?? {},
      fromOriginal,
      score: question.score,
      max: question.maxScore,
      status: statusOf(question, answered),
      // 正确答案保留原题键——展示时再由 fromOriginal 换。
      correct: question.correctKeys,
      pickedOriginal,
      pickedDisplay,
      ...(isSubjective
        ? {
            answerText:
              question.type === "comprehensive"
                ? Object.values(response.steps ?? {}).join("\n")
                : (response.text ?? ""),
          }
        : {}),
    };
  });

  return {
    objective: { score: round2(objectiveScore), max: round2(objectiveMax) },
    subjective: { score: round2(subjectiveScore), max: round2(subjectiveMax), pending },
    total: round2(objectiveScore + subjectiveScore),
    totalMax: round2(objectiveMax + subjectiveMax),
    details,
  };
}
