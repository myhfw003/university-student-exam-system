/* ==========================================================================
   知行测评 · 管理端阅卷队列数据通路
   --------------------------------------------------------------------------
   阅卷中心有一份 mock / HTTP 实现，页面只认这里定义的形状。

   两处口径差异要注意（页面不知道，数据通路知道）：

   1. **初判在服务端**：真实后端给出建议分（suggestedScore）、要点命中、
      步骤命中；mock 模式没有后端，就用同一套判分引擎在本地算一遍——
      两边都是「按关键词命中给分」，口径一致。
   2. **状态有三档**：后端是 `pending` / `in_review` / `reviewed`，
      mock 只有待阅与已阅两档；页面的筛选按后端的三档走。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assignReviewTask,
  batchAdoptReviewTasks,
  claimReviewTask,
  gradeReviewTask,
  isBackendEnabled,
  loadReviewCounts,
  loadReviewTaskDetail,
  loadReviewTasks,
} from "@exam/shared/api";
import type {
  BatchAdoptResult,
  ReviewCounts,
  ReviewTask,
  ReviewTaskStatus,
} from "@exam/shared/domain/review";
import { gradeShort, gradeStep, stepScores } from "@exam/shared/engine/scoring";
import { itemScoreOf } from "@exam/shared/engine/paper";
import {
  getExam,
  getQuestion,
  updateReview,
  useCatalog,
} from "@exam/shared/mock/catalog";

/** 评分要点的命中情况。 */
export interface ReviewPoint {
  text: string;
  hit: boolean;
  /** 该要点的得分；后端不给要点分时为空。 */
  score?: number;
  max?: number;
}

/** 综合题步骤的命中情况。 */
export interface ReviewStepView {
  code: string;
  prompt: string;
  score: number;
  hit: boolean;
}

/** 卷宗详情（mock 与 HTTP 同一形状）。 */
export interface ReviewDetailView {
  id: string;
  /** 所属作答（监考处置按这个维度）。 */
  attemptId: string;
  /** 作答次序；重考不串号。 */
  attemptNo: number;
  examName: string;
  studentName: string;
  studentUsername: string;
  questionId: string;
  questionCode: string;
  /** 题型码（`short` / `comprehensive` …）。 */
  questionType: string;
  questionTypeLabel: string;
  /** 综合题按步骤拆分时的步骤码。 */
  stepCode: string | null;
  /** 题干。 */
  stem: string;
  /** 标签 ID（领域 / 知识点 / 难度）；后端不返回时为空。 */
  tags: string[];
  /** 参考答案。 */
  reference: string;
  /** 解析。 */
  analysis: string;
  /** 作答原文。 */
  answerText: string;
  /** 建卷 / 交卷时间。 */
  submittedAt: string;
  status: ReviewTaskStatus;
  statusLabel: string;
  /** 指派的阅卷人；未指派为空。 */
  assigneeId: string | null;
  /** 该题（步骤）的满分。 */
  maxScore: number;
  /** 系统初判建议分。 */
  suggestedScore: number | null;
  /** 评分要点命中。 */
  points: ReviewPoint[];
  /** 综合题步骤命中。 */
  steps: ReviewStepView[];
  /** 最终分数。 */
  finalScore: number | null;
  /** 评语。 */
  comment: string;
}

/** 空计数（mock 与 HTTP 共用的初值）。 */
const EMPTY_COUNTS: ReviewCounts = { pending: 0, inReview: 0, reviewed: 0, mine: 0 };

/** 阅卷队列。 */
export interface ReviewQueue {
  /** 队列条目。 */
  items: ReviewDetailView[];
  /** 计数（待领取 / 阅卷中 / 已阅完 / 我的）。 */
  counts: ReviewCounts;
  loading: boolean;
  /** 重新拉取队列。 */
  refresh: () => void;
  /** 保存评分。 */
  saveGrade: (id: string, score: number, comment: string) => Promise<void>;
  /** 批量采纳初判建议。 */
  batchAdopt: (pendingIds: string[]) => Promise<BatchAdoptResult>;
  /** 领取任务（HTTP 模式；mock 没有抢占语义）。 */
  claim: (id: string) => Promise<void>;
  /** 指派任务给指定阅卷人（HTTP 模式）。 */
  assign: (id: string, userId: string) => Promise<void>;
  /** 取回单份卷宗的完整细节（题干、参考答案、命中情况）。 */
  loadDetail: (id: string) => Promise<ReviewDetailView | null>;
}

/**
 * 阅卷队列。
 *
 * @param filter 状态筛选：`pending` / `in_review` / `reviewed` / `all`。
 */
export function useReviewQueue(filter: { status: string; mine?: boolean }): ReviewQueue {
  const remote = isBackendEnabled();
  const mockReviews = useCatalog((state) => state.reviews);
  const mockStudents = useCatalog((state) => state.students);

  const [remoteItems, setRemoteItems] = useState<ReviewDetailView[]>([]);
  const [remoteCounts, setRemoteCounts] = useState<ReviewCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [page, counts] = await Promise.all([
          loadReviewTasks({
            status: filter.status,
            // 「只看我的」是后端的「指派给我」——前端不自己筛。
            ...(filter.mine ? { mine: true } : {}),
          }),
          loadReviewCounts().catch(() => EMPTY_COUNTS),
        ]);
        if (cancelled) return;
        // 队列条目先按列表摘要铺上，卷宗细节（题干、命中情况）按需再取。
        setRemoteItems(page.items.map((task) => toDetailView(task)));
        setRemoteCounts(counts);
      } catch {
        if (!cancelled) {
          setRemoteItems([]);
          setRemoteCounts(EMPTY_COUNTS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, filter.status, filter.mine, token]);

  /** 取回单份卷宗的完整细节（题干、参考答案、命中情况）。 */
  const loadDetail = useCallback(
    async (id: string): Promise<ReviewDetailView | null> => {
      if (!remote) return null;
      try {
        const detail = await loadReviewTaskDetail(id);
        return toDetailView(detail.task, detail);
      } catch {
        return null;
      }
    },
    [remote],
  );

  const mockItems = useMemo<ReviewDetailView[]>(() => {
    if (remote) return [];
    return mockReviews
      .filter((review) => {
        if (filter.status === "all") return true;
        if (filter.status === "reviewed") return review.status === "reviewed";
        if (filter.status === "in_review") return false;
        return review.status === "pending";
      })
      .map((review) => toMockDetail(review, mockStudents));
  }, [remote, mockReviews, mockStudents, filter.status]);

  const mockCounts = useMemo<ReviewCounts>(() => {
    if (remote) return remoteCounts;
    return {
      pending: mockReviews.filter((r) => r.status === "pending").length,
      inReview: 0,
      reviewed: mockReviews.filter((r) => r.status === "reviewed").length,
      mine: 0,
    };
  }, [remote, remoteCounts, mockReviews]);

  const saveGrade = useCallback(
    async (id: string, score: number, comment: string) => {
      if (!remote) {
        const result = updateReview(id, { teacherScore: score, comment, status: "reviewed" });
        if (!result.ok) throw new Error(result.message ?? "保存失败");
        return;
      }
      await gradeReviewTask(id, { score, comment });
    },
    [remote],
  );

  const batchAdopt = useCallback(
    async (pendingIds: string[]): Promise<BatchAdoptResult> => {
      if (!remote) {
        // mock 模式：本地逐份采纳初判分数。
        const adopted: BatchAdoptResult["items"] = [];
        for (const id of pendingIds) {
          const review = mockReviews.find((r) => r.id === id);
          if (!review) continue;
          const suggestion = mockSuggestion(review);
          if (!suggestion) continue;
          updateReview(id, {
            teacherScore: suggestion.score,
            comment: "系统初判，已批量采纳",
            status: "reviewed",
          });
          adopted.push({
            taskId: id,
            status: "reviewed",
            statusLabel: "已阅完",
            finalScore: suggestion.score,
            message: "",
          });
        }
        return {
          total: pendingIds.length,
          adopted: adopted.length,
          skipped: pendingIds.length - adopted.length,
          items: adopted,
        };
      }
      return batchAdoptReviewTasks({ taskIds: pendingIds });
    },
    [remote, mockReviews],
  );

  const claim = useCallback(
    async (id: string) => {
      if (!remote) return;
      await claimReviewTask(id);
    },
    [remote],
  );

  const assign = useCallback(
    async (id: string, userId: string) => {
      if (!remote) return;
      await assignReviewTask(id, userId);
    },
    [remote],
  );

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return {
    items: remote ? remoteItems : mockItems,
    counts: remote ? remoteCounts : mockCounts,
    loading,
    refresh,
    saveGrade,
    batchAdopt,
    claim,
    assign,
    loadDetail,
  };
}

/* ------------------------------------------------------------------ 映射 */

/** 列表摘要 → 卷宗视图（细节字段先留空）。 */
function toDetailView(
  task: ReviewTask,
  detail?: {
    stem: string;
    questionTypeLabel: string;
    referenceAnswer: string;
    analysis: string;
    keypoints: Array<{ text: string; hit: boolean }>;
    steps: Array<{ code: string; prompt: string; score: number; hit: boolean }>;
    hitItems: string[];
    missedItems: string[];
    notes: string[];
    studentUsername: string;
    studentDisplayName: string;
  },
): ReviewDetailView {
  return {
    id: task.id,
    attemptId: task.attemptId,
    attemptNo: task.attemptNo,
    examName: task.examName,
    studentName: detail?.studentDisplayName || task.studentDisplayName,
    studentUsername: detail?.studentUsername ?? task.studentUsername,
    questionId: task.questionId,
    questionCode: task.questionCode,
    questionType: task.questionType,
    questionTypeLabel: detail?.questionTypeLabel ?? "",
    stepCode: task.stepCode,
    stem: detail?.stem ?? "",
    tags: [],
    reference: detail?.referenceAnswer ?? "",
    analysis: detail?.analysis ?? "",
    answerText: task.answerText,
    submittedAt: task.reviewedAt ?? task.createdAt,
    status: task.status,
    statusLabel: task.statusLabel,
    assigneeId: task.assigneeId,
    maxScore: task.maxScore,
    suggestedScore: task.suggestedScore,
    points: (detail?.keypoints ?? []).map((point) => ({ text: point.text, hit: point.hit })),
    steps: (detail?.steps ?? []).map((step) => ({
      code: step.code,
      prompt: step.prompt,
      score: step.score,
      hit: step.hit,
    })),
    finalScore: task.finalScore,
    comment: task.comment,
  };
}

/* -------------------------------------------------------------- mock 分支 */

/** mock 模式的系统初判：按题型走判分引擎，与答题端口径一致。 */
function mockSuggestion(review: {
  qid: string;
  stepId: string | null;
  answerText: string;
  examId: string;
}): { score: number; max: number; points?: ReviewPoint[]; steps?: ReviewStepView[] } | null {
  const question = getQuestion(review.qid);
  if (!question) return null;
  const exam = getExam(review.examId);
  const paperMax = exam ? itemScoreOf(exam.items, review.qid, question) : question.score;

  if (review.stepId) {
    const step = (question.steps ?? []).find((s) => s.id === review.stepId);
    if (!step) return null;
    const scales = stepScores(question, paperMax);
    const index = (question.steps ?? []).indexOf(step);
    const stepMax = scales[index] ?? step.score;
    const result = gradeStep(step, review.answerText, stepMax);
    return {
      score: result.score,
      max: result.max,
      steps: [{ code: step.id, prompt: step.prompt, score: result.score, hit: result.hit }],
    };
  }

  if (question.type === "short") {
    const result = gradeShort(question, review.answerText, paperMax);
    return {
      score: result.score,
      max: result.max,
      points: result.points.map((point) => ({
        text: point.text,
        hit: point.hit,
        score: point.score,
        max: point.max,
      })),
    };
  }

  return null;
}

/** mock 卷宗 → 卷宗视图。 */
function toMockDetail(
  review: {
    id: string;
    examId: string;
    studentId: string;
    qid: string;
    stepId: string | null;
    attempt: number;
    answerText: string;
    submittedAt: string;
    status: "pending" | "reviewed";
    teacherScore: number | null;
    comment: string;
  },
  students: Array<{ id: string; name: string }>,
): ReviewDetailView {
  const question = getQuestion(review.qid);
  const exam = getExam(review.examId);
  const student = students.find((s) => s.id === review.studentId);
  const suggestion = mockSuggestion(review);

  return {
    id: review.id,
    attemptId: "",
    attemptNo: Number(review.attempt) || 1,
    examName: exam?.name ?? review.examId,
    studentName: student?.name ?? review.studentId,
    studentUsername: review.studentId,
    questionId: review.qid,
    questionCode: review.qid,
    questionType: question?.type ?? "short",
    questionTypeLabel: question?.type ?? "",
    stepCode: review.stepId,
    stem: question?.stem ?? "",
    tags: question?.tags ?? [],
    reference: question?.reference ?? "",
    analysis: question?.analysis ?? "",
    answerText: review.answerText,
    submittedAt: review.submittedAt,
    status: review.status === "reviewed" ? "reviewed" : "pending",
    statusLabel: review.status === "reviewed" ? "已阅完" : "待领取",
    assigneeId: null,
    maxScore: suggestion?.max ?? question?.score ?? 0,
    suggestedScore: suggestion?.score ?? null,
    points: suggestion?.points ?? [],
    steps: suggestion?.steps ?? [],
    finalScore: review.teacherScore,
    comment: review.comment,
  };
}
