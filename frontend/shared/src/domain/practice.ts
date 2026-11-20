/* ==========================================================================
   知行测评 · 练习开放单
   --------------------------------------------------------------------------
   练习开放单（后端 `PracticeAssignment`）是**独立于练习卷**的聚合：
   开放给谁、开放多久、当前是什么状态，都记在开放单上；
   而次数上限、反馈时机、错题回流这些**练习规则**记在练习卷上。
   两者不要混：开放单是「给谁开、开多久」，练习卷是「怎么练」。

   状态词表与后端 `PracticeAssignmentStatuses` 一一对应
   （`draft` / `published` / `archived`）。两边不一致时 CI 会报错
   （`scripts/check-practice-status-codes.py`）：状态码是前后端共享的词表，
   前端写错一个码，后端会直接判定「练习状态取值不合法」。
   ========================================================================== */

/** 开放单状态。 */
export type PracticeAssignmentStatus = "draft" | "published" | "archived";

/** 状态中文名（与后端 `PracticeAssignmentStatuses.Label` 一致）。 */
export const PRACTICE_ASSIGNMENT_STATUS_LABEL: Record<PracticeAssignmentStatus, string> = {
  draft: "草稿",
  published: "已上架",
  archived: "已下架",
};

/** 状态中文名；认不出来的状态码原样返回，不吞掉。 */
export function practiceAssignmentStatusLabel(status: string): string {
  return PRACTICE_ASSIGNMENT_STATUS_LABEL[status as PracticeAssignmentStatus] ?? status;
}

/** 管理端练习开放单的一行（列表与详情共用）。 */
export interface AdminPracticeAssignment {
  /** 开放单 ID。 */
  id: string;
  /** 开放单标题。 */
  title: string;
  /** 挂着的练习卷 ID。 */
  paperId: string;
  /** 练习卷名。 */
  paperName: string;
  /** 练习卷的题量。 */
  questionCount: number;
  /** 练习卷的总分。 */
  totalScore: number;
  /** 状态码。 */
  status: PracticeAssignmentStatus;
  /** 状态中文名。 */
  statusLabel: string;
  /** 开放范围：组织维度标签 ID；空表示全员开放。 */
  scopeTagIds: string[];
  /** 开放范围的中文名。 */
  scopeTagNames: string[];
  /** 开放开始时间；null 表示不限。 */
  openAt: string | null;
  /** 开放结束时间；null 表示不限。 */
  closeAt: string | null;
  /** 上架时间；从未上架过为 null。 */
  publishedAt: string | null;
  /** 创建时间。 */
  createdAt: string | null;
  /** 已产生的作答次数。 */
  attemptCount: number;
}
