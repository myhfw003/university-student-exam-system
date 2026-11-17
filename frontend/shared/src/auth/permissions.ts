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
    "role:read",
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
