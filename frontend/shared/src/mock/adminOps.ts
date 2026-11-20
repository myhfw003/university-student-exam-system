/* ==========================================================================
   知行测评 · 管理端运维数据（场次 / 用户 / 审计 / 监考）
   --------------------------------------------------------------------------
   这四个模块在原型里不存在（原型只有标签 / 题库 / 组卷 / 阅卷 / 分析），
   是按 docs/design/01-requirements.md §2.4 §2.5 §2.7 §2.8 新建的。

   与内容仓库（mock/catalog.ts）分开：内容仓库是「题目与试卷」，
   这里是「运行态与治理态」。当前为示例数据，接后端后整体换数据源。
   ========================================================================== */

import { create } from "zustand";
import type { PracticeAssignmentStatus } from "../domain/practice";
import type {
  AntiCheatPolicy,
  AppUser,
  AuditLog,
  CandidateStatus,
  ExamSession,
  ExamSessionStatus,
  ProctorAction,
  ProctorActionKind,
  ProctorCandidate,
  UserRole,
  UserStatus,
} from "../domain/types";
import { SEED } from "./seed";

/* ==========================================================================
   示例数据
   ========================================================================== */

/** 缺省防作弊策略。 */
const DEFAULT_POLICY: AntiCheatPolicy = {
  maxFocusLoss: 3,
  onExceeded: "warn",
  requireFullscreen: true,
  disableCopyPaste: true,
  disableContextMenu: true,
  watermark: true,
  heartbeatIntervalSec: 15,
  disconnectThresholdSec: 45,
};

/** 角色中文名。 */
export const USER_ROLE_LABEL: Record<UserRole, string> = {
  system_admin: "系统管理员",
  content_admin: "内容管理员",
  author_teacher: "出题教师",
  grader_teacher: "阅卷教师",
  student: "学生",
  general_user: "社会人士",
};

/** 用户状态中文名。 */
export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  active: "正常",
  disabled: "已停用",
};

/** 场次状态中文名。 */
export const SESSION_STATUS_LABEL: Record<ExamSessionStatus, string> = {
  scheduled: "未开始",
  in_progress: "进行中",
  closed: "已结束",
  cancelled: "已取消",
};

/** 考生状态中文名。 */
export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  not_started: "未开始",
  answering: "作答中",
  submitted: "已交卷",
  forced_submitted: "已强制交卷",
  disconnected: "断连中",
};

/** 监考处置中文名。 */
export const PROCTOR_ACTION_LABEL: Record<ProctorActionKind, string> = {
  warn: "发送警告",
  note: "添加备注",
  force_submit: "强制交卷",
};

/**
 * 组织维度标签（FR-IAM-04）。
 *
 * 院系 / 专业 / 班级用**组织维度标签**表达，不建独立组织树；
 * 组织维度只挂用户，题目只挂前四维。
 */
export interface OrgTag {
  id: string;
  name: string;
  /** 父标签 ID；顶级为 null。 */
  parentId: string | null;
}

/** 组织维度标签**种子**（进 store 后可由人员名单导入自动扩充）。 */
export const ORG_TAGS: OrgTag[] = [
  { id: "org-college", name: "计算机学院", parentId: null },
  { id: "org-major-cs", name: "计算机科学与技术", parentId: "org-college" },
  { id: "org-major-se", name: "软件工程", parentId: "org-college" },
  { id: "org-class-cs-2301", name: "计算机科学 2023 级 1 班", parentId: "org-major-cs" },
  { id: "org-class-cs-2302", name: "计算机科学 2023 级 2 班", parentId: "org-major-cs" },
  { id: "org-class-se-2301", name: "软件工程 2023 级 1 班", parentId: "org-major-se" },
];

/** 组织标签 → 名单组 ID 的映射：名单组是答题端的组织视图，组织标签是管理端的。 */
export const CLASS_TO_ORG: Record<string, string> = {
  c2301: "org-class-cs-2301",
  c2302: "org-class-cs-2302",
};

/** 示例用户：在校学生 + 教师 + 阅卷教师 + 社会人士 + 管理员。 */
function buildUsers(): AppUser[] {
  const users: AppUser[] = [];

  // 管理与教师账号。
  users.push({
    id: "u-admin-01",
    account: "admin",
    name: "陈砚之",
    // 演示账号同时持有内容管理员与系统管理员：
    // 顶栏按首个角色显示「内容管理员」（与原型一致），
    // 而「审计」等只对系统管理员开放的页面也能演示到。
    roles: ["content_admin", "system_admin"],
    orgTags: [],
    status: "active",
    email: "chenyz@example.edu",
    createdAt: "2026-09-01 08:00",
    lastLoginAt: "2026-11-12 08:12",
  });
  users.push({
    id: "u-teacher-01",
    account: "teacher01",
    name: "周砚秋",
    roles: ["author_teacher"],
    orgTags: ["org-major-cs"],
    status: "active",
    email: "zhouyq@example.edu",
    createdAt: "2026-09-03 09:20",
    lastLoginAt: "2026-11-11 19:40",
  });
  users.push({
    id: "u-reviewer-01",
    account: "reviewer01",
    name: "何知微",
    roles: ["grader_teacher"],
    orgTags: ["org-major-cs"],
    status: "active",
    email: "hezw@example.edu",
    createdAt: "2026-09-05 14:05",
    lastLoginAt: "2026-11-12 08:05",
  });

  // 社会人士：无组织标签，权限与在校学生一致。
  users.push({
    id: "u-general-01",
    account: "public001",
    name: "赵行之",
    roles: ["general_user"],
    orgTags: [],
    status: "active",
    email: "zhaoxz@example.com",
    createdAt: "2026-10-12 11:30",
    lastLoginAt: "2026-11-10 21:15",
  });
  users.push({
    id: "u-general-02",
    account: "public002",
    name: "孙乐言",
    roles: ["general_user"],
    orgTags: [],
    status: "disabled",
    email: "sunly@example.com",
    createdAt: "2026-10-12 11:32",
    lastLoginAt: "2026-10-20 08:44",
  });

  // 在校学生：账号即学号，挂班级组织标签。
  for (const student of SEED.students) {
    const orgTag = CLASS_TO_ORG[student.classId];
    users.push({
      id: `u-${student.id}`,
      account: student.id,
      name: student.name,
      roles: ["student"],
      orgTags: orgTag ? [orgTag] : [],
      status: "active",
      email: `${student.id}@example.edu`,
      createdAt: "2026-09-01 08:00",
      lastLoginAt: "2026-11-09 08:24",
    });
  }

  return users;
}

/** 示例场次：由已发布试卷派生。 */
function buildSessions(): ExamSession[] {
  const netExam = SEED.exams.find((e) => e.id === "exam-net-mid");
  const mathExam = SEED.exams.find((e) => e.id === "exam-math-final");
  const dsExam = SEED.exams.find((e) => e.id === "exam-ds-quiz");

  const rosterAll = SEED.students.map((s) => s.id);

  const sessions: ExamSession[] = [];
  if (netExam) {
    sessions.push({
      id: "sess-net-mid",
      name: "计算机网络期中考试 · 第 1 场",
      paperId: netExam.id,
      status: "in_progress",
      openAt: "2026-11-12 08:30",
      closeAt: "2026-11-12 12:00",
      durationMin: 90,
      scope: ["c2301", "c2302"],
      roster: rosterAll,
      allowRetake: false,
      policy: DEFAULT_POLICY,
      note: "开考 20 分钟后不允许中途离场，客观题与主观题同时提交。",
      createdAt: "2026-11-08 10:00",
    });
  }
  if (mathExam) {
    sessions.push({
      id: "sess-math-final",
      name: "高等数学期末考试 · 补考场次",
      paperId: mathExam.id,
      status: "closed",
      openAt: "2026-06-18 09:00",
      closeAt: "2026-06-18 11:00",
      durationMin: 120,
      scope: ["c2301", "c2302"],
      roster: rosterAll,
      allowRetake: false,
      policy: DEFAULT_POLICY,
      note: "试卷按小梅花卷生成，题序统一、选项顺序逐人打乱。",
      createdAt: "2026-06-10 09:00",
    });
  }
  if (dsExam) {
    sessions.push({
      id: "sess-ds-quiz",
      name: "数据结构随堂测验 · 第 2 场",
      paperId: dsExam.id,
      status: "scheduled",
      openAt: "2026-11-20 10:00",
      closeAt: "2026-11-20 10:30",
      durationMin: 30,
      scope: ["c2301"],
      roster: SEED.students.filter((s) => s.classId === "c2301").map((s) => s.id),
      allowRetake: true,
      policy: { ...DEFAULT_POLICY, maxFocusLoss: 5, requireFullscreen: false },
      note: "允许重考，成绩取最高分。",
      createdAt: "2026-11-15 16:20",
    });
  }
  return sessions;
}

/**
 * 练习开放单（mock）。
 *
 * 真实后端里开放单是**独立于练习卷**的聚合：有自己的 ID、状态与开放期，
 * 练习卷只提供题目与练习规则。mock 也照这个形状建，
 * 否则管理端那一页在 mock 模式下会以为「练习卷 == 开放单」。
 */
export interface MockPracticeAssignment {
  id: string;
  /** 开放单标题。 */
  title: string;
  /** 挂着的练习卷 ID。 */
  paperId: string;
  /** 开放范围：组织维度标签 ID；空表示全员开放。 */
  scope: string[];
  status: PracticeAssignmentStatus;
  /** 开放开始时间；null 表示不限。 */
  openAt: string | null;
  /** 开放结束时间；null 表示不限。 */
  closeAt: string | null;
  /** 上架时间；未上架过为 null。 */
  publishedAt: string | null;
  createdAt: string;
}

/**
 * 示例练习开放单。
 *
 * 注意：**不是每个练习卷都有开放单**——没有开放单的练习卷学生是看不见的，
 * 这正是真实后端的行为（学生端读的是开放单，不是练习卷）。
 */
function buildPracticeAssignments(): MockPracticeAssignment[] {
  return [
    {
      id: "pa-math-limit",
      title: "期末冲刺 · 高等数学极限与连续",
      paperId: "prac-math-limit",
      scope: [],
      status: "published",
      openAt: null,
      closeAt: null,
      publishedAt: "2026-11-10 09:00",
      createdAt: "2026-11-09 16:20",
    },
    {
      id: "pa-net-tp",
      title: "计算机网络 · 传输层强化（面向 23 级）",
      paperId: "prac-net-tp",
      scope: ["org-class-cs-2301", "org-class-cs-2302"],
      status: "published",
      openAt: "2026-11-15 08:00",
      closeAt: "2026-12-31 23:59",
      publishedAt: "2026-11-15 08:05",
      createdAt: "2026-11-14 10:12",
    },
    {
      id: "pa-ds-draft",
      title: "数据结构 · 树与查找专题",
      paperId: "prac-ds-draft",
      scope: [],
      status: "draft",
      openAt: null,
      closeAt: null,
      publishedAt: null,
      createdAt: "2026-11-18 09:30",
    },
  ];
}

/** 示例审计日志。 */
function buildAuditLogs(): AuditLog[] {
  const rows: Array<Omit<AuditLog, "id">> = [
    {
      at: "2026-11-12 08:20",
      operator: "linzhiyao",
      action: "auth.login_failed",
      targetType: "user",
      targetId: "u-student-07",
      summary: "密码错误，登录被拒绝",
      ip: "10.12.0.44",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-12 08:12",
      operator: "陈砚之",
      action: "auth.login",
      // 对象是账号本身（后端写登录审计时也是 user + 用户 ID）。
      targetType: "user",
      targetId: "u-admin-01",
      summary: "管理员登录管理端",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-12 08:05",
      operator: "何知微",
      action: "auth.login",
      targetType: "user",
      targetId: "u-reviewer-01",
      summary: "阅卷教师登录管理端",
      ip: "10.12.0.35",
      userAgent: "Chrome 131 / macOS",
    },
    {
      at: "2026-11-11 16:42",
      operator: "陈砚之",
      action: "exam_session.publish",
      targetType: "exam_session",
      targetId: "sess-ds-quiz",
      summary: "发布场次「数据结构随堂测验 · 第 2 场」，物化名单 6 人",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-11 15:10",
      operator: "周砚秋",
      action: "question.publish",
      targetType: "question",
      targetId: "q-n-07",
      summary: "发布题目「TCP 三次握手与四次挥手」",
      ip: "10.12.0.44",
      userAgent: "Firefox 133 / Ubuntu",
    },
    {
      at: "2026-11-11 10:03",
      operator: "陈砚之",
      action: "paper.publish",
      targetType: "paper",
      targetId: "exam-ds-quiz",
      summary: "发布试卷「数据结构随堂测验」，卷型：标准卷",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-10 09:26",
      operator: "陈砚之",
      action: "import.adopt",
      targetType: "import_batch",
      targetId: "imp-2026-11-10-01",
      summary: "采纳导入批次「2026秋季期中试题汇总.csv」，入库 3 道候选题",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-10 10:11",
      operator: "陈砚之",
      action: "import.adopt",
      targetType: "generation_batch",
      targetId: "gen-2026-11-10-01",
      summary: "采纳生成批次「围绕数据结构中的排序与树结构生成基础选择题」，入库 3 道候选题",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-09 11:30",
      operator: "陈砚之",
      action: "exam_session.publish_grades",
      targetType: "exam_session",
      targetId: "exam-math-final",
      summary: "发布「高等数学期末考试」成绩，12 人平均 74.8 分",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-09 10:14",
      operator: "何知微",
      action: "review_task.grade",
      targetType: "review",
      targetId: "rv-1",
      summary: "主观题「连续与可导的关系」评分由 6 调整为 8（附评语）",
      ip: "10.12.0.35",
      userAgent: "Chrome 131 / macOS",
    },
    {
      at: "2026-11-08 09:05",
      operator: "陈砚之",
      action: "user.assign-roles",
      targetType: "user",
      targetId: "u-reviewer-01",
      summary: "为「何知微」授予角色「阅卷教师」",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-07 17:22",
      operator: "陈砚之",
      action: "user.assign-tags",
      targetType: "user",
      targetId: "u-2023120101",
      summary: "为「林知远」挂载组织标签「计算机科学 2023 级 1 班」",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-06 14:48",
      operator: "周砚秋",
      action: "question.disable",
      targetType: "question",
      targetId: "q-p-03",
      summary: "停用题目「综合操作题 · 数据结构实验」，疑似与已发布卷重复",
      ip: "10.12.0.44",
      userAgent: "Firefox 133 / Ubuntu",
    },
    {
      at: "2026-11-05 09:31",
      operator: "陈砚之",
      action: "blueprint.generate",
      targetType: "paper",
      targetId: "exam-ds-quiz",
      summary: "按配额矩阵生成试卷，题量 4 题，总分 30 分，种子自动派生",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
    {
      at: "2026-11-04 20:16",
      operator: "陈砚之",
      action: "paper.unpublish",
      targetType: "paper",
      targetId: "prac-ds-draft",
      summary: "撤回练习「数据结构 · 树与查找专题（草稿）」",
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    },
  ];

  return rows.map((row, index) => ({ ...row, id: `audit-${String(index + 1).padStart(3, "0")}` }));
}

/* ==========================================================================
   Store
   ========================================================================== */

/** 管理端运维数据状态。 */
export interface AdminOpsState {
  /** 考试场次。 */
  sessions: ExamSession[];
  /** 账号。 */
  users: AppUser[];
  /** 审计日志（追加式）。 */
  auditLogs: AuditLog[];
  /** 监考处置记录。 */
  proctorActions: ProctorAction[];
  /** 监考考生状态表：场次 ID → 学生 ID → 状态。 */
  proctorCandidates: Record<string, Record<string, ProctorCandidate>>;
  /** 组织维度标签（院系 → 专业 → 班级，按 parentId 成树）。 */
  orgTags: OrgTag[];
  /** 练习开放单。 */
  practiceAssignments: MockPracticeAssignment[];
}

const initialState = (): AdminOpsState => ({
  sessions: buildSessions(),
  users: buildUsers(),
  auditLogs: buildAuditLogs(),
  proctorActions: [],
  proctorCandidates: {},
  orgTags: ORG_TAGS.map((tag) => ({ ...tag })),
  practiceAssignments: buildPracticeAssignments(),
});

/** 管理端运维数据 store。 */
export const useAdminOps = create<AdminOpsState>(() => initialState());

/* ==========================================================================
   读取器
   ========================================================================== */

/** 取场次。 */
export function getSession(id: string): ExamSession | undefined {
  return useAdminOps.getState().sessions.find((s) => s.id === id);
}

/** 取用户。 */
export function getUser(id: string): AppUser | undefined {
  return useAdminOps.getState().users.find((u) => u.id === id);
}

/** 取组织标签。 */
export function getOrgTag(id: string): OrgTag | undefined {
  return useAdminOps.getState().orgTags.find((t) => t.id === id);
}

/** 取组织标签名。 */
export function orgTagName(id: string): string {
  return useAdminOps.getState().orgTags.find((t) => t.id === id)?.name ?? id;
}

/** 标签名 → 标签 ID。 */
export function orgTagIdByName(name: string, parentId: string | null): string | undefined {
  return useAdminOps
    .getState()
    .orgTags.find((t) => t.name === name && t.parentId === parentId)?.id;
}

/** 稳定散列（用于生成标签 ID）。 */
function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * 取或建组织维度标签（FR-IAM-04 / FR-IAM-05）。
 *
 * 同一父标签下的同名标签复用；不存在则按层级自动创建，
 * **不因标签缺失而让导入失败**。
 */
export function ensureOrgTag(
  name: string,
  parentId: string | null,
): { tag: OrgTag; created: boolean } {
  const trimmed = name.trim();
  const state = useAdminOps.getState();
  const hit = state.orgTags.find((t) => t.name === trimmed && t.parentId === parentId);
  if (hit) return { tag: hit, created: false };

  const tag: OrgTag = {
    id: `org-${shortHash(`${parentId ?? "root"}/${trimmed}`)}`,
    name: trimmed,
    parentId,
  };
  // 散列极小概率撞名，撞名时追加后缀。
  let id = tag.id;
  let n = 1;
  while (state.orgTags.some((t) => t.id === id)) {
    n += 1;
    id = `${tag.id}-${n}`;
  }
  const created: OrgTag = { ...tag, id };
  useAdminOps.setState({ orgTags: [...state.orgTags, created] });
  return { tag: created, created: true };
}

/** 解析角色文本：接受角色码（student）或中文名（学生）。 */
export function parseUserRole(text: string): UserRole | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed in USER_ROLE_LABEL) return trimmed as UserRole;
  const hit = Object.entries(USER_ROLE_LABEL).find(([, label]) => label === trimmed);
  return hit ? (hit[0] as UserRole) : null;
}

/** 用户是否具备某角色。 */
export function hasRole(user: AppUser | undefined, role: UserRole): boolean {
  return Boolean(user?.roles.includes(role));
}

/** 用户是否具备任一给定角色。 */
export function hasAnyRole(user: AppUser | undefined, roles: readonly UserRole[]): boolean {
  return Boolean(user && roles.some((r) => user.roles.includes(r)));
}

/* ==========================================================================
   写入器
   ========================================================================== */

/** 新建场次。 */
export function createSession(input: {
  name: string;
  paperId: string;
  openAt: string;
  closeAt: string;
  durationMin: number;
  scope: string[];
  /** 指定考生（FR-DLV-02）。 */
  directUserIds?: string[];
  allowRetake: boolean;
  note: string;
  policy?: Partial<AntiCheatPolicy>;
}): { ok: boolean; message?: string; session?: ExamSession } {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "请填写场次名称" };
  if (!input.paperId) return { ok: false, message: "请选择来源试卷" };
  if (input.durationMin <= 0) return { ok: false, message: "作答时长必须大于 0" };

  const session: ExamSession = {
    id: `sess-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    paperId: input.paperId,
    status: "scheduled",
    openAt: input.openAt,
    closeAt: input.closeAt,
    durationMin: input.durationMin,
    scope: input.scope,
    ...(input.directUserIds && input.directUserIds.length > 0
      ? { directUserIds: [...input.directUserIds] }
      : {}),
    // 未发布时名单为空；发布时才物化。
    roster: [],
    allowRetake: input.allowRetake,
    policy: { ...DEFAULT_POLICY, ...input.policy },
    note: input.note,
    createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
  };

  useAdminOps.setState({ sessions: [...useAdminOps.getState().sessions, session] });
  return { ok: true, session };
}

/** 更新场次。 */
export function updateSession(
  id: string,
  patch: Partial<
    Pick<
      ExamSession,
      "name" | "openAt" | "closeAt" | "durationMin" | "scope" | "allowRetake" | "note" | "policy" | "status"
    >
  >,
): { ok: boolean; message?: string } {
  const state = useAdminOps.getState();
  if (!state.sessions.some((s) => s.id === id)) return { ok: false, message: "场次不存在" };
  useAdminOps.setState({
    sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  });
  return { ok: true };
}

/**
 * 发布场次：按组织标签**物化**考生名单（FR-DLV-02）。
 *
 * 名单一旦物化，后续改组织标签不影响已生成的名单，除非显式重新生成。
 */
export function publishSession(
  id: string,
  roster: string[],
): { ok: boolean; message?: string; count?: number } {
  const state = useAdminOps.getState();
  const session = state.sessions.find((s) => s.id === id);
  if (!session) return { ok: false, message: "场次不存在" };
  if (session.status === "closed") return { ok: false, message: "已结束的场次不可发布" };
  if (roster.length === 0) return { ok: false, message: "名单为空，请先指定考生" };

  useAdminOps.setState({
    sessions: state.sessions.map((s) =>
      s.id === id ? { ...s, status: "scheduled", roster: [...roster] } : s,
    ),
  });
  return { ok: true, count: roster.length };
}

/** 取消场次。 */
export function cancelSession(id: string, reason: string): { ok: boolean; message?: string } {
  const state = useAdminOps.getState();
  const session = state.sessions.find((s) => s.id === id);
  if (!session) return { ok: false, message: "场次不存在" };
  if (session.status === "closed") return { ok: false, message: "已结束的场次不可取消" };
  useAdminOps.setState({
    sessions: state.sessions.map((s) => (s.id === id ? { ...s, status: "cancelled", note: reason || s.note } : s)),
  });
  return { ok: true };
}

/** 推进场次状态。非法流转拒绝（FR-DLV-01）。 */
export function advanceSession(id: string): { ok: boolean; message?: string; status?: ExamSessionStatus } {
  const session = getSession(id);
  if (!session) return { ok: false, message: "场次不存在" };

  const next: Record<ExamSessionStatus, ExamSessionStatus | null> = {
    scheduled: "in_progress",
    in_progress: "closed",
    closed: null,
    cancelled: null,
  };
  const target = next[session.status];
  if (!target) return { ok: false, message: "当前状态不可推进" };

  updateSession(id, { status: target });
  return { ok: true, status: target };
}

/* ==========================================================================
   练习开放单
   --------------------------------------------------------------------------
   校验与状态流转照抄后端 `PracticeAssignment`（`Exam.Domain/Learning`），
   连报错的措辞都一样：mock 与 HTTP 模式下管理员看到的提示相同。
   ========================================================================== */

/** 开放单的时间设置。 */
export interface PracticeAssignmentSettings {
  title: string;
  /** 开放范围：组织维度标签 ID；空表示全员开放。 */
  scope: string[];
  /** 开放开始时间；null 表示不限。 */
  openAt: string | null;
  /** 开放结束时间；null 表示不限。 */
  closeAt: string | null;
}

/** 新建练习开放单（草稿）。 */
export function createPracticeAssignment(input: {
  title: string;
  paperId: string;
  scope: string[];
  openAt: string | null;
  closeAt: string | null;
}): { ok: boolean; message?: string; assignment?: MockPracticeAssignment } {
  const title = input.title.trim();
  if (!input.paperId) return { ok: false, message: "练习试卷不合法。" };
  if (!title) return { ok: false, message: "练习标题不能为空。" };
  if (input.scope.some((id) => !id)) return { ok: false, message: "开放范围里的标签不合法。" };

  const assignment: MockPracticeAssignment = {
    id: `pa-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    paperId: input.paperId,
    scope: [...input.scope],
    status: "draft",
    openAt: input.openAt,
    closeAt: input.closeAt,
    publishedAt: null,
    createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
  };

  const state = useAdminOps.getState();
  useAdminOps.setState({ practiceAssignments: [assignment, ...state.practiceAssignments] });
  return { ok: true, assignment };
}

/** 改开放单设置（标题、开放范围、开放期）。 */
export function updatePracticeAssignment(
  id: string,
  patch: Partial<PracticeAssignmentSettings>,
): { ok: boolean; message?: string } {
  const state = useAdminOps.getState();
  const assignment = state.practiceAssignments.find((a) => a.id === id);
  if (!assignment) return { ok: false, message: "开放单不存在" };

  const title = (patch.title ?? assignment.title).trim();
  if (!title) return { ok: false, message: "练习标题不能为空。" };

  const scope = patch.scope ?? assignment.scope;
  if (scope.some((tagId) => !tagId)) return { ok: false, message: "开放范围里的标签不合法。" };

  const openAt = patch.openAt === undefined ? assignment.openAt : patch.openAt;
  const closeAt = patch.closeAt === undefined ? assignment.closeAt : patch.closeAt;
  if (openAt && closeAt && closeAt <= openAt) {
    return { ok: false, message: "关闭时间必须晚于开放时间。" };
  }

  useAdminOps.setState({
    practiceAssignments: state.practiceAssignments.map((a) =>
      a.id === id ? { ...a, title, scope: [...scope], openAt, closeAt } : a,
    ),
  });
  return { ok: true };
}

/** 上架开放单：草稿与已下架的都能重新上架。 */
export function publishPracticeAssignment(
  id: string,
): { ok: boolean; message?: string; status?: PracticeAssignmentStatus } {
  const state = useAdminOps.getState();
  const assignment = state.practiceAssignments.find((a) => a.id === id);
  if (!assignment) return { ok: false, message: "开放单不存在" };
  if (assignment.status === "published") return { ok: false, message: "练习已经上架了。" };

  const publishedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  useAdminOps.setState({
    practiceAssignments: state.practiceAssignments.map((a) =>
      a.id === id ? { ...a, status: "published", publishedAt: a.publishedAt ?? publishedAt } : a,
    ),
  });
  return { ok: true, status: "published" };
}

/** 下架开放单：只有已上架的才能下架；下架后学生立刻看不见这份练习。 */
export function archivePracticeAssignment(
  id: string,
): { ok: boolean; message?: string; status?: PracticeAssignmentStatus } {
  const state = useAdminOps.getState();
  const assignment = state.practiceAssignments.find((a) => a.id === id);
  if (!assignment) return { ok: false, message: "开放单不存在" };
  if (assignment.status !== "published") return { ok: false, message: "只有已上架的练习才能下架。" };

  useAdminOps.setState({
    practiceAssignments: state.practiceAssignments.map((a) =>
      a.id === id ? { ...a, status: "archived" } : a,
    ),
  });
  return { ok: true, status: "archived" };
}

/** 按账号找用户（不区分大小写，与后端唯一性口径一致）。 */
export function findUserByAccount(account: string): AppUser | undefined {
  const key = account.trim().toLowerCase();
  return useAdminOps.getState().users.find((u) => u.account.toLowerCase() === key);
}

/**
 * 新建用户（人员名单导入用）。
 *
 * 账号全局唯一（大小写不敏感）；重复时拒绝并说明原因。
 */
export function createUser(input: {
  account: string;
  name: string;
  email?: string | undefined;
  roles: UserRole[];
  orgTags?: string[] | undefined;
  mustChangePassword?: boolean | undefined;
}): { ok: boolean; message?: string; id?: string } {
  const account = input.account.trim();
  if (!account) return { ok: false, message: "账号不能为空" };
  if (!input.name.trim()) return { ok: false, message: "姓名不能为空" };
  if (input.roles.length === 0) return { ok: false, message: "至少保留一个角色" };

  const state = useAdminOps.getState();
  if (state.users.some((u) => u.account.toLowerCase() === account.toLowerCase())) {
    return { ok: false, message: "账号已存在" };
  }

  const id = `u-${account}`;
  const user: AppUser = {
    id,
    account,
    name: input.name.trim(),
    roles: input.roles,
    orgTags: input.orgTags ?? [],
    status: "active",
    email: input.email ?? "",
    createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    lastLoginAt: null,
    ...(input.mustChangePassword ? { mustChangePassword: true } : {}),
  };
  useAdminOps.setState({ users: [...state.users, user] });
  return { ok: true, id };
}

/** 更新用户。 */
export function updateUser(
  id: string,
  patch: Partial<
    Pick<AppUser, "name" | "email" | "status" | "roles" | "orgTags" | "mustChangePassword">
  >,
): { ok: boolean; message?: string } {
  const state = useAdminOps.getState();
  if (!state.users.some((u) => u.id === id)) return { ok: false, message: "用户不存在" };
  useAdminOps.setState({
    users: state.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
  });
  return { ok: true };
}

/** 授予 / 撤销角色（FR-IAM-06）。 */
export function setUserRoles(id: string, roles: UserRole[]): { ok: boolean; message?: string } {
  if (roles.length === 0) return { ok: false, message: "至少保留一个角色" };
  return updateUser(id, { roles });
}

/** 写审计日志。 */
export function writeAudit(input: Omit<AuditLog, "id" | "at">): void {
  const state = useAdminOps.getState();
  const entry: AuditLog = {
    ...input,
    id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
  useAdminOps.setState({ auditLogs: [entry, ...state.auditLogs] });
}

/** 记录监考处置（FR-ANT-05）。 */
export function recordProctorAction(input: {
  sessionId: string;
  studentId: string;
  kind: ProctorActionKind;
  reason: string;
  operator: string;
}): { ok: boolean; message?: string } {
  if (input.kind === "force_submit" && !input.reason.trim()) {
    return { ok: false, message: "强制交卷必须注明原因" };
  }
  const state = useAdminOps.getState();
  const action: ProctorAction = {
    id: `pa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId: input.sessionId,
    studentId: input.studentId,
    kind: input.kind,
    reason: input.reason.trim(),
    operator: input.operator,
    createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
  useAdminOps.setState({ proctorActions: [action, ...state.proctorActions] });
  return { ok: true };
}

/** 重置为初始示例数据。 */
export function resetAdminOps(): void {
  useAdminOps.setState(initialState(), true);
}

/** 确定性字符串哈希（用于模拟数据的可复现派生）。 */
function hashCodeOf(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h;
}

/* ==========================================================================
   监考快照（FR-ANT-04）
   --------------------------------------------------------------------------
   设计文档要求监考视图以**批量聚合**方式更新（默认 2 秒一批），
   不做逐事件即时推送。

   后端接入前，本模块用确定性算法模拟考生状态：同一场次 + 同一 tick
   必然得到同一结果，便于复核与测试。接 SignalR 后只需替换本函数。
   ========================================================================== */

/** 生成考生在监考视图中的状态快照。 */
export function proctorSnapshot(sessionId: string, tick: number): ProctorCandidate[] {
  const session = getSession(sessionId);
  if (!session) return [];

  const state = useAdminOps.getState();
  const overrides = state.proctorCandidates[sessionId] ?? {};

  // 本场总题数：取来源试卷的题量。
  const exam = SEED.exams.find((e) => e.id === session.paperId);
  const total = exam?.items?.length ?? exam?.questionIds?.length ?? 0;

  return session.roster.map((studentId, index) => {
    // 已有记录优先（教师处置会写入这里）。
    const existing = overrides[studentId];
    if (existing) return existing;

    // 确定性模拟：以学号与 tick 派生。
    const seed = `${sessionId}|${studentId}|${tick}`;
    const roll = Math.abs(hashCodeOf(seed)) % 100;

    let status: CandidateStatus = "not_started";
    if (session.status === "closed") {
      status = roll < 90 ? "submitted" : "forced_submitted";
    } else if (session.status === "in_progress") {
      if (roll < 18) status = "not_started";
      else if (roll < 28) status = "disconnected";
      else if (roll < 33) status = "submitted";
      else status = "answering";
    }

    const focusLossCount = status === "answering" ? (seed.length + index) % 4 : roll % 2;
    const answeredCount =
      status === "not_started"
        ? 0
        : status === "submitted" || status === "forced_submitted"
          ? total
          : Math.min(total, 1 + (roll % Math.max(1, total)));

    return {
      sessionId,
      studentId,
      status,
      focusLossCount,
      disconnectCount: status === "disconnected" ? 1 : 0,
      lastHeartbeatAt:
        status === "answering"
          ? new Date(Date.now() - (roll % 20) * 1000).toISOString().slice(11, 16)
          : status === "disconnected"
            ? new Date(Date.now() - 90_000).toISOString().slice(11, 16)
            : null,
      answeredCount,
      totalCount: total,
      submittedAt:
        status === "submitted" || status === "forced_submitted"
          ? new Date(Date.now() - (roll % 40) * 60_000).toISOString().slice(0, 16).replace("T", " ")
          : null,
      forcedReason: status === "forced_submitted" ? "切屏次数超限，由监考教师强制交卷" : null,
    };
  });
}

/** 写入考生状态（教师处置后调用）。 */
export function setCandidate(candidate: ProctorCandidate): void {
  const state = useAdminOps.getState();
  useAdminOps.setState({
    proctorCandidates: {
      ...state.proctorCandidates,
      [candidate.sessionId]: {
        ...(state.proctorCandidates[candidate.sessionId] ?? {}),
        [candidate.studentId]: candidate,
      },
    },
  });
}
