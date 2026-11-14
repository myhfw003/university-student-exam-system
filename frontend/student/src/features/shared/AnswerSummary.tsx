/* ==========================================================================
   知行测评 · 逐题作答摘要（学生端）
   --------------------------------------------------------------------------
   对应原型 docs/ui-design/exam/js/student.js 的 answerSummary(d)：
   - 客观题：你的作答（显示字母）+ 正确答案（经 fromOriginal 映射回显示字母）
   - 简答题：你的作答原文
   - 综合题：逐步骤「题干：作答」，以「 ／ 」连接
   未作答一律显示「未作答」，不隐藏整行。
   ========================================================================== */

import type { GradedDetail } from "@exam/shared/engine/scoring";

export interface AnswerSummaryProps {
  detail: GradedDetail;
}

/** 逐题作答摘要。 */
export function AnswerSummary({ detail }: AnswerSummaryProps) {
  const type = detail.question.type;

  if (type === "single" || type === "multi" || type === "judge") {
    const picked = detail.pickedDisplay?.join("、") || "未作答";
    const correct = (detail.correct ?? [])
      .map((key) => detail.fromOriginal?.[key] ?? key)
      .join("、");
    return (
      <div className="list-sub">
        你的作答：<span className="strong">{picked}</span> · 正确答案：
        <span className="strong">{correct}</span>
      </div>
    );
  }

  if (type === "short") {
    return (
      <div className="list-sub">
        你的作答：<span className="strong">{detail.answerText || "未作答"}</span>
      </div>
    );
  }

  if (type === "comprehensive" && detail.steps) {
    const lines = detail.steps.map((step) =>
      `${step.prompt}：${step.answer && step.answer.trim() ? step.answer : "未作答"}`,
    );
    return (
      <div className="list-sub">
        你的作答：<span className="strong">{lines.join(" ／ ")}</span>
      </div>
    );
  }

  return null;
}
