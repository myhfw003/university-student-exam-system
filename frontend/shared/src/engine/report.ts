/* ==========================================================================
   知行测评 · 成绩报告 → 判分明细
   --------------------------------------------------------------------------
   成绩由服务端判完再下发：前端**不重算**，只把结果映射成能渲染的形状。

   两条口径要注意：

   1. **选择键**：服务端存的是原题键，考生看到的是显示字母——
      正确答案与考生作答都要经 `fromOriginal` 换回显示字母。
   2. **答案公布策略**：没到公布时机，正确答案与解析一律不给
      （`revealed` 为 false）。前端不能自己把答案补出来。
   ========================================================================== */

import type {
  AttemptReport,
  AttemptScores,
  AttemptSurface,
  ReportDetail,
} from "../domain/attempt";
import type { Question } from "../domain/types";
import { surfaceItem } from "./paper";
import type { GradeStatus, GradedDetail, GradedWithTeacher } from "./scoring";

/** 考生是否作答了。 */
function isAnswered(detail: ReportDetail): boolean {
  const answer = detail.yourAnswer;
  if (!answer) return false;
  if (answer.selectedOptionKeys?.length) return true;
  if (answer.selectedOptionKey) return true;
  if (answer.text?.trim()) return true;
  if (answer.steps?.some((step) => step.text.trim())) return true;
  return false;
}

/**
 * 判分状态。
 *
 * 服务端只给分数，状态由分数与是否作答推出来：
 * 没定分 → 待阅；没作答 → 未作答；满分 → 正确；有分不满 → 部分正确；其余 → 错误。
 */
function statusOf(detail: ReportDetail, answered: boolean): GradeStatus {
  if (detail.score === null) return "pending";
  if (!answered) return "blank";
  if (detail.maxScore > 0 && detail.score >= detail.maxScore) return "correct";
  if (detail.score > 0) return "partial";
  return "wrong";
}

/** 综合题的作答原文：逐步骤「题干：作答」。 */
function comprehensiveText(detail: ReportDetail, surface: AttemptSurface): string | undefined {
  const steps = detail.yourAnswer?.steps ?? [];
  if (steps.length === 0) return undefined;
  const question = surface.questions.find((q) => q.id === detail.questionId);
  return steps
    .map((step) => {
      const meta = question?.steps.find((s) => s.code === step.stepCode);
      return `${meta?.prompt ?? step.stepCode}：${step.text.trim() ? step.text : "未作答"}`;
    })
    .join(" ／ ");
}

/**
 * 由服务端成绩报告构建逐题判分明细。
 *
 * 需要卷面（`AttemptSurface`）：报告里只有题干与得分，
 * 选项、标签、步骤都在卷面里。
 */
export function gradedPaperFromReport(
  surface: AttemptSurface,
  report: AttemptReport,
  scores?: AttemptScores | null,
): GradedWithTeacher {
  const items = new Map(surface.questions.map((question) => [question.id, surfaceItem(question)]));
  // 判分依据（要点命中）按题目取：成绩没发布时服务端不给，这里就是空的。
  const scoreItems = new Map((scores?.items ?? []).map((item) => [item.questionId, item]));

  const details: GradedDetail[] = report.details.map((detail, index) => {
    const item = items.get(detail.questionId);
    const fromOriginal = item?.fromOriginal ?? {};

    const question: Question = item?.question ?? {
      id: detail.questionId,
      type: detail.type,
      score: detail.maxScore,
      status: "published",
      source: "manual",
      tags: [],
      stem: detail.stem,
      answer: [],
      analysis: "",
    };

    const pickedOriginal = detail.yourAnswer?.selectedOptionKeys?.length
      ? detail.yourAnswer.selectedOptionKeys
      : detail.yourAnswer?.selectedOptionKey
        ? [detail.yourAnswer.selectedOptionKey]
        : [];

    const answered = isAnswered(detail);
    const revealed = detail.revealed;

    const answerText =
      detail.type === "comprehensive"
        ? comprehensiveText(detail, surface)
        : (detail.yourAnswer?.text ?? undefined);

    const scoreItem = scoreItems.get(detail.questionId);
    // 综合题的命中项是步骤编码，换成卷面上的步骤题干，学生看得懂。
    const stepPrompts = new Map(
      (item?.question.steps ?? []).map((step) => [step.id, step.prompt]),
    );
    const hitItems = scoreItem?.hitItems.map((text) => stepPrompts.get(text) ?? text);
    const missedItems = scoreItem?.missedItems.map((text) => stepPrompts.get(text) ?? text);

    return {
      qid: detail.questionId,
      slot: index + 1,
      type: detail.type,
      question: {
        ...question,
        // 解析与参考答案同样受公布策略约束：没公布就不给。
        analysis: revealed ? (detail.analysis ?? "") : "",
        ...(revealed && detail.referenceAnswer ? { reference: detail.referenceAnswer } : {}),
      },
      displayKeys: item?.displayKeys ?? [],
      toOriginal: item?.toOriginal ?? {},
      fromOriginal,
      score: detail.score ?? 0,
      max: detail.maxScore,
      status: statusOf(detail, answered),
      // 未公布时正确答案一律不给。
      correct: revealed ? detail.correctKeys : [],
      pickedOriginal,
      pickedDisplay: pickedOriginal.map((key) => fromOriginal[key] ?? key),
      ...(answerText === undefined ? {} : { answerText }),
      // 判分依据：命中了哪些要点、漏了哪些（没有就是没有，不编）。
      ...(scoreItem
        ? {
            hitItems: hitItems ?? [],
            missedItems: missedItems ?? [],
            methodLabel: scoreItem.methodLabel,
          }
        : {}),
    };
  });

  const pendingQuestions = details.filter((d) => d.status === "pending").map((d) => d.qid);

  return {
    objective: { score: report.objectiveScore, max: report.objectiveMax },
    subjective: {
      score: report.subjectiveScore ?? 0,
      max: report.subjectiveMax,
      pending: pendingQuestions.length,
    },
    total: report.totalScore,
    totalMax: report.totalMax,
    details,
    pendingQuestions,
  };
}
