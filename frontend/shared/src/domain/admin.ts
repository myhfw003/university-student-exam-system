/* ==========================================================================
   知行测评 · 管理域类型
   --------------------------------------------------------------------------
   管理端看到的口径与学生端不同：场次带名单与规则、成绩带考生信息、
   名单组是**组织维度标签**（院系 → 专业 → 班级），不是班级 ID。
   ========================================================================== */

import type { ExamSessionStatus } from "./types";

/** 管理端的考试场次摘要。 */
export interface AdminSessionSummary {
  id: string;
  name: string;
  paperId: string;
  paperName: string;
  status: ExamSessionStatus;
  statusLabel: string;
  openAt: string;
  closeAt: string;
  durationMinutes: number;
  /** 名单纳入方式：`tags` / `direct` / `open`。 */
  participantMode: string;
  participantModeLabel: string;
  /** 卷型规则：`standard` / `small_plum` / `large_plum`。 */
  variantRule: string;
  variantRuleLabel: string;
  publishedAt: string | null;
  createdAt: string;
}

/** 管理端的考试规则（防作弊策略）。 */
export interface AdminSessionRules {
  /** 切屏上限；null 表示不限制。 */
  maxFocusLoss: number | null;
  /** 超限处置：`force_submit` / `warn`。 */
  onMaxFocusLoss: string;
  requireFullScreen: boolean;
  blockCopyPaste: boolean;
  blockContextMenu: boolean;
  showWatermark: boolean;
  enableHeartbeatCheck: boolean;
  heartbeatIntervalSeconds: number;
  heartbeatTimeoutSeconds: number;
  maxDisconnect: number;
  earlyEntryMinutes: number;
}

/** 管理端的场次详情。 */
export interface AdminSessionDetail {
  summary: AdminSessionSummary;
  rules: AdminSessionRules;
  /** 考生须知。 */
  note: string;
  /** 组织维度标签 ID（名单按标签纳入时）。 */
  participantTagIds: string[];
  /** 指定考生 ID。 */
  participantUserIds: string[];
}

/** 场次名单里的一人（发布时物化）。 */
export interface SessionParticipant {
  userId: string;
  username: string;
  displayName: string;
  status: string;
  statusLabel: string;
  /** 已用次数。 */
  attemptsUsed: number;
}

/** 场次成绩里的一行。 */
export interface SessionGrade {
  attemptId: string;
  attemptNo: number;
  userId: string;
  studentUsername: string;
  studentDisplayName: string;
  objectiveScore: number;
  objectiveMax: number;
  totalScore: number;
  totalMax: number;
  subjectivePending: boolean;
  gradeVisibility: string;
  published: boolean;
  submittedAt: string | null;
}

/** 场次负责人。 */
export interface SessionAssignment {
  userId: string;
  username: string;
  displayName: string;
  assignedAt: string;
}

/** 组织维度标签（名单组的真实形态）。 */
export interface OrgTag {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
}

/** 用户摘要（指定考生时用）。 */
export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roles: string[];
}
