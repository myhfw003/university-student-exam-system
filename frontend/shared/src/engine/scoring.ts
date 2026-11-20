/* ==========================================================================
   知行测评 · 判分引擎
   --------------------------------------------------------------------------
   对齐原型 shared/js/engine.js §4.5。

   计分口径（不可更改）：
   1. 单选 / 判断：全对得满分，否则 0 分。
   2. 多选：**错选 0 分**；全对满分；**漏选折半**——
      得分 = max × (答对项数 / 正确项数) × 0.5。
   3. 简答：按要点均分，每个要点全或无（命中任一关键词即得该要点分）。
   4. 综合题：步骤分值按权重等比缩放，末步吸收舍入余量，
      保证「各步骤满分之和 == 该题卷面配分」；每个步骤同样全或无。
   5. 主观题即使自动初判有分，状态仍是「待阅」——最终分以阅卷为准。
   ========================================================================== */

import type { Question, QuestionKeypoint, QuestionStep } from "../domain/types";

/** 保留 2 位小数。 */
/** 多选题计分策略（对外文案口径，页面与管理端共用）。 */
export const MULTI_POLICY =
  "多选题计分策略：错选不得分；漏选按答对项占比折半计分（例：正确项 ABD，漏选 A 得该题分值的 1/4）。";

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 判分状态。 */
export type GradeStatus = "blank" | "correct" | "wrong" | "partial" | "pending" | "auto";

/** 客观题判分结果。 */
export interface ObjectiveGrade {
  score: number;
  max: number;
  status: GradeStatus;
  picked: string[];
  correct: string[];
}

/** 简答题要点判分明细。 */
export interface KeypointGrade {
  text: string;
  hit: boolean;
  score: number;
  max: number;
}

/** 简答题判分结果。 */
export interface ShortGrade {
  score: number;
  max: number;
  status: GradeStatus;
  points: KeypointGrade[];
  answered: boolean;
}

/** 综合题步骤判分明细。 */
export interface StepGrade {
  id: string;
  prompt: string;
  score: number;
  max: number;
  hit: boolean;
  answered: boolean;
  answer: string;
}

/** 综合题判分结果。 */
export interface ComprehensiveGrade {
  score: number;
  max: number;
  status: GradeStatus;
  steps: StepGrade[];
}

/**
 * 文本归一化：去空白 + 转小写 + 去中英文标点。
 * 命中判定用它，保证「同义不同形」的宽松匹配。
 */
export function normalizeText(text: string | null | undefined): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    // 字符类与原型 engine.js:290 逐字一致（含 ASCII 逗号）。
    .replace(/[，。、；：？！“”‘’（）()【】\u005B\u005D"'`,.!?;:\-—_/\\|]/g, "");
}

/** 要点 / 步骤是否命中作答文本：任一关键词出现即命中。 */
function hits(text: string, keywords: string[]): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return keywords.some((keyword) => {
    const k = normalizeText(keyword);
    return k.length > 0 && normalized.indexOf(k) !== -1;
  });
}

/** 客观题判分。 */
export function gradeObjective(
  question: Question,
  pickedKeys: string[],
  maxOverride?: number,
): ObjectiveGrade {
  const max = maxOverride === undefined || maxOverride === null ? question.score : maxOverride;
  const correct = question.answer ?? [];
  const picked = [...pickedKeys];

  if (picked.length === 0) {
    return { score: 0, max, status: "blank", picked, correct };
  }

  if (question.type === "single" || question.type === "judge") {
    const ok = picked.length === 1 && picked[0] === correct[0];
    return {
      score: ok ? max : 0,
      max,
      status: ok ? "correct" : "wrong",
      picked,
      correct,
    };
  }

  // 多选：错选不得分。
  const wrongPicked = picked.filter((k) => correct.indexOf(k) === -1);
  const hit = picked.filter((k) => correct.indexOf(k) !== -1);

  if (wrongPicked.length > 0) {
    return { score: 0, max, status: "wrong", picked, correct };
  }
  if (hit.length === correct.length) {
    return { score: max, max, status: "correct", picked, correct };
  }
  // 漏选折半。
  const partial = round2(max * (hit.length / correct.length) * 0.5);
  return { score: partial, max, status: "partial", picked, correct };
}

/** 简答题判分：按要点均分。 */
export function gradeShort(
  question: Question,
  answerText: string,
  maxOverride?: number,
): ShortGrade {
  const max = maxOverride === undefined || maxOverride === null ? question.score : maxOverride;
  const keypoints: QuestionKeypoint[] = question.keypoints ?? [];
  const per = round2(max / (keypoints.length || 1));
  const answered = answerText.trim().length > 0;

  const points: KeypointGrade[] = keypoints.map((kp) => ({
    text: kp.text,
    hit: hits(answerText, kp.keywords ?? []),
    score: 0,
    max: per,
  }));

  for (const point of points) {
    if (point.hit) point.score = point.max;
  }

  const score = round2(points.reduce((sum, p) => sum + p.score, 0));
  return { score, max, status: "auto", points, answered };
}

/**
 * 步骤分值分配：按权重等比缩放，末步吸收舍入余量，
 * 保证各步骤满分之和恰等于该题卷面配分。
 */
export function stepScores(question: Question, itemScore?: number): number[] {
  const steps: QuestionStep[] = question.steps ?? [];
  if (steps.length === 0) return [];

  const max =
    itemScore === undefined || itemScore === null ? Number(question.score) || 0 : Number(itemScore);

  let weights = steps.map((st) => Number(st.score) || 0);
  let totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    weights = steps.map(() => 1);
    totalWeight = steps.length;
  }

  const out: number[] = [];
  let acc = 0;
  steps.forEach((_step, i) => {
    let m = i === steps.length - 1 ? round2(max - acc) : round2((max * weights[i]!) / totalWeight);
    if (m < 0) m = 0;
    acc = round2(acc + m);
    out.push(m);
  });
  return out;
}

/** 单个步骤判分：全或无。 */
export function gradeStep(
  step: QuestionStep,
  answerText: string,
  maxOverride?: number,
): { score: number; max: number; hit: boolean; answered: boolean } {
  const max = maxOverride === undefined || maxOverride === null ? step.score || 0 : maxOverride;
  const answered = answerText.trim().length > 0;
  const hit = hits(answerText, step.keywords ?? []);
  return { score: hit ? max : 0, max, hit, answered };
}

/** 综合题判分。 */
export function gradeComprehensive(
  question: Question,
  stepAnswers: Record<string, string>,
  maxOverride?: number,
): ComprehensiveGrade {
  const max = maxOverride === undefined || maxOverride === null ? question.score : maxOverride;
  const steps = question.steps ?? [];
  const maxima = stepScores(question, max);

  const graded: StepGrade[] = steps.map((st, i) => {
    const text = stepAnswers[st.id] ?? "";
    const stepMax = maxima[i] ?? 0;
    const result = gradeStep(st, text, stepMax);
    return {
      id: st.id,
      prompt: st.prompt,
      score: result.score,
      max: stepMax,
      hit: result.hit,
      answered: result.answered,
      answer: text,
    };
  });

  const score = round2(graded.reduce((sum, s) => sum + s.score, 0));
  return { score, max, status: "auto", steps: graded };
}

/* ==========================================================================
   整卷判分
   ========================================================================== */

import type { BuiltPaper, BuiltPaperItem } from "./paper";

/** 作答内容。choice 存**卷面显示字母**。 */
export interface PaperResponses {
  [qid: string]: {
    choice?: string[];
    text?: string;
    steps?: Record<string, string>;
  };
}

/** 单题判分明细。 */
export interface GradedDetail {
  qid: string;
  slot: number;
  type: Question["type"];
  question: Question;
  displayKeys: string[];
  toOriginal: Record<string, string>;
  fromOriginal: Record<string, string>;
  score: number;
  max: number;
  status: GradeStatus;
  /** 正确答案（选项键）。 */
  correct?: string[];
  /** 考生所选的**原题**选项键。 */
  pickedOriginal?: string[];
  /** 考生所选的**显示**字母。 */
  pickedDisplay?: string[];
  /** 简答题要点命中情况。 */
  points?: KeypointGrade[];
  /** 综合题步骤命中情况。 */
  steps?: StepGrade[];
  /**
   * 判分依据：命中的要点 / 步骤（服务端给的原文）。
   *
   * 成绩报告页用这一组显示「命中了什么、漏了什么」——
   * 要点的分值分布前端算不出来（阅卷教师可能改过分），所以只给命中与否。
   */
  hitItems?: string[];
  /** 判分依据：漏掉的要点 / 步骤。 */
  missedItems?: string[];
  /** 判分方式（自动判分 / 自动初判 / 人工定分）。 */
  methodLabel?: string;
  /** 考生作答原文。 */
  answerText?: string;
  /** 自动初判得分（主观题）。 */
  autoScore?: number;
}

/** 整卷判分结果。 */
export interface GradedPaper {
  objective: { score: number; max: number };
  subjective: { score: number; max: number; pending: number };
  total: number;
  totalMax: number;
  details: GradedDetail[];
}

/**
 * 整卷判分。
 *
 * 关键：**显示字母必须先还原为原题键再判分**——
 * 梅花卷置换后卷面上看到的 A/B/C 对应的原题选项可能完全不同。
 */
export function scorePaper(paper: BuiltPaper, responses: PaperResponses): GradedPaper {
  let objectiveScore = 0;
  let objectiveMax = 0;
  let subjectiveScore = 0;
  let subjectiveMax = 0;
  let pending = 0;

  const details: GradedDetail[] = paper.items.map((item: BuiltPaperItem) => {
    const question = item.question;
    const response = responses[question.id] ?? {};
    const base: GradedDetail = {
      qid: question.id,
      slot: item.slot,
      type: question.type,
      question,
      displayKeys: item.displayKeys,
      toOriginal: item.toOriginal,
      fromOriginal: item.fromOriginal,
      score: 0,
      max: item.score,
      status: "blank",
    };

    if (question.type === "short" || question.type === "comprehensive") {
      if (question.type === "short") {
        const result = gradeShort(question, response.text ?? "", item.score);
        subjectiveMax += result.max;
        // 主观题即使自动初判有分，状态仍是「待阅」——最终分以阅卷为准。
        if (result.answered) {
          pending += 1;
          subjectiveScore += result.score;
        }
        return {
          ...base,
          status: result.answered ? "pending" : "blank",
          score: result.score,
          max: result.max,
          points: result.points,
          answerText: response.text ?? "",
          autoScore: result.score,
        };
      }

      const result = gradeComprehensive(question, response.steps ?? {}, item.score);
      subjectiveMax += result.max;
      const answered = result.steps.some((s) => s.answered);
      if (answered) {
        pending += 1;
        subjectiveScore += result.score;
      }
      return {
        ...base,
        status: answered ? "pending" : "blank",
        score: result.score,
        max: result.max,
        steps: result.steps,
        answerText: Object.values(response.steps ?? {}).join("\n"),
        autoScore: result.score,
      };
    }

    // 客观题：显示字母 → 原题键。
    const pickedDisplay = response.choice ?? [];
    const pickedOriginal = pickedDisplay.map((k) => item.toOriginal[k] ?? k);
    const result = gradeObjective(question, pickedOriginal, item.score);

    objectiveMax += result.max;
    objectiveScore += result.score;

    return {
      ...base,
      status: result.status,
      score: result.score,
      max: result.max,
      correct: result.correct,
      pickedOriginal,
      pickedDisplay,
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

/**
 * 回填阅卷分数。
 *
 * 只计入 `status === "reviewed"` 且 `teacherScore != null` 且 **attempt 匹配**的记录——
 * 重考不串号。综合题逐步骤回填；只要还有步骤未阅卷，整题仍为「待阅」。
 */
export interface TeacherScoreRecord {
  qid: string;
  stepId: string | null;
  attempt: number;
  teacherScore: number | null;
  status: "pending" | "reviewed";
}

/** 回填阅卷分数后的结果。 */
export interface GradedWithTeacher extends GradedPaper {
  /** 仍有步骤未阅卷的题号。 */
  pendingQuestions: string[];
}

/** 把阅卷分数回填到判分结果。 */
export function applyTeacherScores(
  graded: GradedPaper,
  teacherScores: readonly TeacherScoreRecord[],
  attemptNo: number,
): GradedWithTeacher {
  const details = graded.details.map((detail) => ({ ...detail }));

  for (const detail of details) {
    if (detail.type !== "short" && detail.type !== "comprehensive") continue;

    const related = teacherScores.filter(
      (r) =>
        r.qid === detail.qid &&
        r.attempt === attemptNo &&
        r.status === "reviewed" &&
        r.teacherScore != null,
    );

    // 原型（student.js:1410）：没有阅卷记录时**直接返回**，保留初判状态——
    // 已作答是「待阅」，未作答是「空白」。空白题不计入待阅。
    if (related.length === 0) continue;

    const manual = round2(related.reduce((sum, r) => sum + (r.teacherScore ?? 0), 0));

    if (detail.type === "comprehensive" && related.some((r) => r.stepId)) {
      // 综合题：逐步骤回填；还有步骤未阅卷时整题仍记为待阅。
      const steps = (detail.steps ?? []).map((step) => {
        const record = related.find((r) => r.stepId === step.id);
        if (record) {
          return { ...step, score: record.teacherScore!, hit: record.teacherScore! > 0 };
        }
        return step;
      });
      const allReviewed = steps.every((st) => related.some((r) => r.stepId === st.id));
      const score = round2(steps.reduce((sum, st) => sum + st.score, 0));
      detail.steps = steps;
      detail.score = score;
      detail.status = allReviewed
        ? score === detail.max
          ? "correct"
          : score > 0
            ? "partial"
            : "wrong"
        : "pending";
      continue;
    }

    // 简答 / 整题给分：按阅卷分定状态。
    detail.score = manual;
    detail.status =
      detail.score >= detail.max ? "correct" : detail.score > 0 ? "partial" : "wrong";
  }

  // 主观分按各题最终分汇总（原型 student.js:1444 同样从 details 汇总）。
  const subjectiveScore = round2(
    details.reduce(
      (sum, d) => (d.type === "short" || d.type === "comprehensive" ? sum + d.score : sum),
      0,
    ),
  );

  // 待阅清单：状态仍为「待阅」的题（原型按状态统计，空白题不算）。
  const pendingQuestions = details.filter((d) => d.status === "pending").map((d) => d.qid);

  return {
    objective: graded.objective,
    subjective: {
      score: subjectiveScore,
      max: graded.subjective.max,
      pending: pendingQuestions.length,
    },
    total: round2(graded.objective.score + subjectiveScore),
    totalMax: graded.totalMax,
    details,
    pendingQuestions,
  };
}
