/* ==========================================================================
   知行测评 · 权限点与角色矩阵
   --------------------------------------------------------------------------
   权限点编码采用「模块:动作」，与 docs/design/01-requirements.md §1 的
   权限矩阵一一对应。角色可叠加，权限取并集。

   这份矩阵是**前端唯一的权限判定来源**：路由守卫、按钮显隐、403 页
   「缺少哪个权限点」的说明都从这里取，避免各处各写一套。
   ========================================================================== */

import type { UserRole } from "../domain/types";

/** 权限点。 */
export type PermissionPoint =
  | "question:read"
  | "question:write"
  | "question:publish"
  | "tag:read"
  | "tag:write"
  | "bank:read"
  | "bank:write"
  | "import:run"
  | "import:adopt"
  | "paper:read"
  | "paper:write"
  | "paper:publish"
  | "blueprint:generate"
  | "practice:read"
  | "practice:write"
  | "exam:read"
  | "exam:write"
  | "exam:publish"
  | "attempt:take"
  | "attempt:read-own"
  | "attempt:read-all"
  | "review:grade"
  | "review:batch-adopt"
  | "grade:publish"
  | "proctor:monitor"
  | "proctor:act"
  | "user-tag:assign"
  | "user:read"
  | "user:write"
  | "user:import"
  | "role:read"
  | "role:write"
  | "analytics:read"
  | "audit:read"
  | "system:configure";

/**
 * 权限点中文名。
 *
 * 与后端 `PermissionCatalog.DisplayNames` 一一对应：
 * 服务端 `GET /permissions` 给的就是这份名字（HTTP 模式用服务端的），
 * mock 模式没有服务端，就用这份。两边对不上时 CI 会报错
 * （`scripts/check-permission-codes.py`）。
 */
export const PERMISSION_DISPLAY_NAMES: Record<PermissionPoint, string> = {
  "question:read": "查看题目",
  "question:write": "编辑题目",
  "question:publish": "发布题目",
  "tag:read": "查看标签",
  "tag:write": "编辑标签",
  "bank:read": "查看题库",
  "bank:write": "编辑题库",
  "import:run": "导入试题",
  "import:adopt": "采纳试题",
  "paper:read": "查看试卷",
  "paper:write": "编辑试卷",
  "paper:publish": "发布试卷",
  "blueprint:generate": "生成组卷方案",
  "practice:read": "查看练习",
  "practice:write": "管理练习",
  "exam:read": "查看考试",
  "exam:write": "编辑考试",
  "exam:publish": "发布考试",
  "attempt:take": "参加考试",
  "attempt:read-own": "查看自己的作答",
  "attempt:read-all": "查看全部作答",
  "review:grade": "人工阅卷",
  "review:batch-adopt": "批量采纳初判",
  "grade:publish": "发布成绩",
  "proctor:monitor": "实时监考",
  "proctor:act": "监考处置",
  "user:read": "查看用户",
  "user:write": "编辑用户",
  "user:import": "导入用户",
  "user-tag:assign": "分配用户标签",
  "role:read": "查看角色",
  "role:write": "编辑角色",
  "analytics:read": "查看统计分析",
  "audit:read": "查看审计日志",
  "system:configure": "系统配置",
};

/** 权限点中文名；认不出来的码原样返回，不吞掉。 */
export function permissionDisplayName(code: string): string {
  return PERMISSION_DISPLAY_NAMES[code as PermissionPoint] ?? code;
}

/** 权限点所属模块（权限码的前缀，如 `question:read` → `question`）。 */
export function permissionModule(code: string): string {
  return code.split(":")[0] ?? code;
}

/** 只读权限（阅卷教师 / 学生对内容域只有读）。 */
const READ_ONLY_QUESTION: readonly PermissionPoint[] = ["question:read"];
const READ_ONLY_TAG: readonly PermissionPoint[] = ["tag:read"];
const READ_ONLY_BANK: readonly PermissionPoint[] = ["bank:read"];
const READ_ONLY_PAPER: readonly PermissionPoint[] = ["paper:read"];

/** 角色 → 权限点。取自 01-requirements.md §1 的权限矩阵。 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly PermissionPoint[]> = {
  system_admin: [
    "question:read",
    "question:write",
    "question:publish",
    "tag:read",
    "tag:write",
    "bank:read",
    "bank:write",
    "import:run",
    "import:adopt",
    "paper:read",
    "paper:write",
    "paper:publish",
    "blueprint:generate",
    "practice:read",
    "practice:write",
    "exam:read",
    "exam:write",
    "exam:publish",
    "attempt:take",
    "attempt:read-own",
    "attempt:read-all",
    "review:grade",
    "review:batch-adopt",
    "grade:publish",
    "proctor:monitor",
    "proctor:act",
    "user-tag:assign",
    "user:read",
    "user:write",
    "user:import",
    "role:read",
    "role:write",
    "analytics:read",
    "audit:read",
    "system:configure",
  ],
  content_admin: [
    "question:read",
    "question:write",
    "question:publish",
    "tag:read",
    "tag:write",
    "bank:read",
    "bank:write",
    "import:run",
    "import:adopt",
    "paper:read",
    "paper:write",
    "paper:publish",
    "blueprint:generate",
    "practice:read",
    "practice:write",
    "exam:read",
    "exam:write",
    "exam:publish",
    "attempt:take",
    "attempt:read-own",
    "attempt:read-all",
    "review:grade",
    "review:batch-adopt",
    "grade:publish",
    "proctor:monitor",
    "proctor:act",
    "user-tag:assign",
    "user:read",
    "user:write",
    "user:import",
    // 内容管理员**没有** role:read：需求文档 §1 的矩阵里 role:read / role:write
    // 只给系统管理员。后端也这么判（GET /roles 要 role:read），
    // 前端原先多给了这一条——与自己的来源对不上。
    "analytics:read",
  ],
  author_teacher: [
    "question:read",
    "question:write",
    "question:publish",
    "tag:read",
    "tag:write",
    "bank:read",
    "bank:write",
    "import:run",
    "import:adopt",
    "paper:read",
    "paper:write",
    "paper:publish",
    "blueprint:generate",
    "practice:read",
    "practice:write",
    "exam:read",
    "exam:write",
    "exam:publish",
    "attempt:take",
    "attempt:read-own",
    "user-tag:assign",
    "analytics:read",
  ],
  grader_teacher: [
    ...READ_ONLY_QUESTION,
    ...READ_ONLY_TAG,
    ...READ_ONLY_BANK,
    ...READ_ONLY_PAPER,
    "exam:read",
    "attempt:take",
    "attempt:read-own",
    "attempt:read-all",
    "review:grade",
    "review:batch-adopt",
    "proctor:monitor",
    "proctor:act",
    "analytics:read",
  ],
  student: [
    // 学生不进题库：练习与考试的内容从自己的作答卷面拿。
    ...READ_ONLY_TAG,
    ...READ_ONLY_PAPER,
    // 学生要能看到自己的考试场次（只读，且只看得到与自己相关的）。
    "exam:read",
    "attempt:take",
    "attempt:read-own",
  ],
  general_user: [
    ...READ_ONLY_QUESTION,
    ...READ_ONLY_TAG,
    ...READ_ONLY_PAPER,
    "attempt:take",
    "attempt:read-own",
  ],
};

/** 角色集合 → 权限点并集。 */
export function permissionsFor(roles: readonly UserRole[] | undefined): PermissionPoint[] {
  if (!roles || roles.length === 0) return [];
  const out = new Set<PermissionPoint>();
  for (const role of roles) {
    for (const point of ROLE_PERMISSIONS[role] ?? []) out.add(point);
  }
  return [...out];
}

/** 是否拥有某权限点。 */
export function hasPermission(
  roles: readonly UserRole[] | undefined,
  point: PermissionPoint,
): boolean {
  if (!roles || roles.length === 0) return false;
  return roles.some((role) => (ROLE_PERMISSIONS[role] ?? []).includes(point));
}
