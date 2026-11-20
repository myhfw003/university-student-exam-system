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

/** 用户状态（后端存储值：`Active` / `Disabled` / `Locked`，前端归一化为小写）。 */
export type AdminUserStatus = "active" | "disabled" | "locked";

/** 管理端的用户条目（列表与详情共用）。 */
export interface AdminUser {
  id: string;
  /** 登录账号（不限学号）。 */
  username: string;
  /** 姓名。 */
  displayName: string;
  email: string;
  phone: string;
  status: AdminUserStatus;
  /** 是否要求下次登录修改密码。 */
  mustChangePassword: boolean;
  /** 角色码（如 `system_admin` / `student`）。 */
  roles: string[];
  /** 角色 ID；只有详情接口给。 */
  roleIds: string[];
  /** 组织维度标签 ID。 */
  organizationTagIds: string[];
  /** 完整组织路径，如「计算机学院 / 计算机科学与技术 / 计科 2301 班」。 */
  organizationPath: string;
  createdAt: string;
  lastLoginAt: string | null;
}

/** 角色。 */
export interface AdminRole {
  id: string;
  /** 角色码。 */
  code: string;
  /** 角色中文名。 */
  name: string;
  description: string;
  /** 系统内置角色不可删除。 */
  isSystem: boolean;
  /** 权限点集合。 */
  permissions: string[];
}

/** 权限点目录里的一条（`GET /permissions`）。 */
export interface AdminPermission {
  /** 权限码，如 `paper:write`。 */
  code: string;
  /** 中文名，如「编辑试卷」。 */
  name: string;
  /** 所属模块（权限码的前缀）。 */
  module: string;
  description: string | null;
}

/** 用户的组织归属（`GET /users/{id}/tags`）。 */
export interface AdminUserOrganization {
  userId: string;
  /** 挂载的组织标签。 */
  tags: Array<{ id: string; code: string; name: string; path: string }>;
  /** 完整组织路径；社会人士为空。 */
  path: string;
}

/** 审计日志条目。 */
export interface AdminAuditLog {
  id: string;
  /** 发生时间。 */
  at: string;
  /** 操作者 ID；日志没有操作者时为空。 */
  operatorId: string | null;
  /** 操作者名。 */
  operator: string;
  /** 动作码（如 `user.assign-roles`）。 */
  action: string;
  /** 目标对象类型。 */
  targetType: string;
  /** 目标对象 ID。 */
  targetId: string;
  /** 变更摘要。 */
  summary: string;
  /** 来源 IP。 */
  ip: string;
  /** 客户端 UA。 */
  userAgent: string;
}

/** 名单批量导入的结果。 */
export interface AdminUserImportResult {
  /** 总行数。 */
  total: number;
  /** 成功数。 */
  succeeded: number;
  /** 新建数。 */
  created: number;
  /** 更新数。 */
  updated: number;
  /** 失败明细（逐行跳过，不阻断整批）。 */
  failures: Array<{ rowNumber: number; username: string; reason: string }>;
  /** 新建账号的初始密码：只在这里回显一次。 */
  generatedPasswords: Array<{ username: string; password: string }>;
}
