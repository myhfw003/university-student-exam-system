/* ==========================================================================
   知行测评 · 学生端数据助手
   --------------------------------------------------------------------------
   把「当前答题者」这一维度下的内容装配成页面需要的形态：
   可见考试、可见练习、成绩记录、错题、进行中的考试。
   ========================================================================== */

import { useMemo } from "react";
import { isInScope, useCatalog } from "@exam/shared/mock/catalog";
import type { ExamPaper, Mistake, Practice } from "@exam/shared/domain/types";
import { useStudentStore } from "@/stores/studentStore";

/** 问候语（按小时）。 */
export function greetingFor(hour: number): string {
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

/** 星期几。 */
export function weekdayOf(date: Date): string {
  return ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()] ?? "";
}

/** 一条成绩记录（考试与练习合并）。 */
export interface StudentRecord {
  /** 记录类型。 */
  kind: "exam" | "practice";
  /** 对象 ID。 */
  id: string;
  /** 名称。 */
  name: string;
  /** 日期（YYYY-MM-DD）。 */
  date: string;
  /** 得分。 */
  score: number;
  /** 满分。 */
  total: number;
  /** 是否还有主观题待阅。 */
  pending: boolean;
  /** 卷型标签（考试有，练习无）。 */
  variantLabel?: string;
}

/** 当前答题者可见的考试。 */
export function useVisibleExams(): ExamPaper[] {
  const studentId = useStudentStore((state) => state.studentId);
  const exams = useCatalog((state) => state.exams);
  return useMemo(
    () =>
      exams.filter(
        (e) => e.status !== "draft" && e.published && isInScope(e.scope, studentId),
      ),
    [exams, studentId],
  );
}

/** 当前答题者可见的练习。 */
export function useVisiblePractices(): Practice[] {
  const studentId = useStudentStore((state) => state.studentId);
  const practices = useCatalog((state) => state.practices);
  return useMemo(
    () =>
      practices.filter(
        (p) => p.status === "published" && p.published && isInScope(p.scope, studentId),
      ),
    [practices, studentId],
  );
}

/** 当前答题者的成绩记录（考试 + 练习，按日期倒序）。 */
export function useStudentRecords(): StudentRecord[] {
  const studentId = useStudentStore((state) => state.studentId);
  const attempts = useCatalog((state) => state.attempts);
  const practiceResults = useCatalog((state) => state.practiceResults);
  const history = useCatalog((state) => state.records);
  const exams = useCatalog((state) => state.exams);
  const practices = useCatalog((state) => state.practices);

  return useMemo(() => {
    const examRecords: StudentRecord[] = Object.values(attempts)
      .filter((attempt) => attempt.studentId === studentId)
      .map((attempt) => {
      const exam = exams.find((e) => e.id === attempt.examId);
      return {
        kind: "exam" as const,
        id: attempt.examId,
        name: exam?.name ?? attempt.examId,
        date: attempt.submittedAt.slice(0, 10),
        score: attempt.score,
        total: attempt.total,
        pending: attempt.pendingSubjective,
        variantLabel: attempt.variantLabel,
      };
      });

    const practiceRecords: StudentRecord[] = Object.values(practiceResults)
      .filter((result) => result.studentId === studentId)
      .map((result) => {
      const practice = practices.find((p) => p.id === result.practiceId);
      return {
        kind: "practice" as const,
        id: result.practiceId,
        name: practice?.name ?? result.practiceId,
        date: result.submittedAt.slice(0, 10),
        score: result.score,
        total: result.total,
        pending: false,
      };
      });

    // 历史成绩（seed 的 records）：已经考过的场次与练习。
    // 同一对象若又产生了实时作答记录，以实时记录为准（它更细：含卷型与待阅标记）。
    const historyRecords: StudentRecord[] = history
      .filter((record) => record.studentId === studentId)
      .map((record) => {
      const exam = exams.find((e) => e.id === record.examId);
      return {
        kind: exam ? ("exam" as const) : ("practice" as const),
        id: record.examId,
        name: record.name,
        date: record.date,
        score: record.score,
        total: record.total,
        pending: record.status === "pending",
      };
      });

    const live = [...examRecords, ...practiceRecords];
    const liveIds = new Set(live.map((record) => record.id));
    const merged = [
      ...live,
      ...historyRecords.filter((record) => !liveIds.has(record.id)),
    ];

    return merged.sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    );
  }, [studentId, attempts, practiceResults, history, exams, practices]);
}

/** 当前答题者的错题。 */
export function useStudentMistakes(): Mistake[] {
  const studentId = useStudentStore((state) => state.studentId);
  const mistakes = useCatalog((state) => state.mistakes);
  return useMemo(
    () => mistakes.filter((m) => m.studentId === studentId || m.studentId === ""),
    [mistakes, studentId],
  );
}

/** 当前答题者「进行中」的考试。 */
export function useOngoingExam(): ExamPaper | undefined {
  const exams = useVisibleExams();
  return useMemo(() => exams.find((e) => e.status === "ongoing"), [exams]);
}

/** 标签筛选：按分组返回，供 TagFilter 使用。 */
export interface TagFilterGroup {
  group: string;
  label: string;
  tags: Array<{ id: string; name: string; group: "domain" | "knowledge_point" | "ability" | "difficulty" }>;
}
