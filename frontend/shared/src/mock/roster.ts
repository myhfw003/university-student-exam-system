/* ==========================================================================
   知行测评 · 人员名单批量导入（FR-IAM-05）
   --------------------------------------------------------------------------
   教师上传 CSV（账号、姓名、院系、专业、班级、邮箱、角色、可选初始密码）：

   - 账号与姓名**必填**；院系 / 专业 / 班级三列可空（为空即视为社会人士）
   - 逐行校验：必填缺失、**本文件内账号重复**、角色无法识别、初始密码过弱
     → 该行标红并跳过，**不阻断整批**
   - 已存在的账号执行**更新**（姓名 / 班级 / 邮箱），不重置其密码
   - 院系 / 专业 / 班级对应的组织维度标签不存在时**自动创建**并按层级挂接；
     已存在则复用
   - 角色列可省略：默认按「是否有班级」推断（有班级→在校学生，无班级→社会人士）；
     显式指定时以指定为准
   - 导入操作写入审计日志

   术语口径：**文件内重复**标红跳过；**系统中已存在**的账号走更新，不报错。
   ========================================================================== */

import type { AppUser, UserRole } from "../domain/types";
import { parseCsv } from "../utils/csv";
import {
  CLASS_TO_ORG,
  createUser,
  ensureOrgTag,
  findUserByAccount,
  parseUserRole,
  updateUser,
  writeAudit,
} from "./adminOps";
import { ensureClass, upsertStudent } from "./catalog";

/** 名单导入的一行（已按列名解析）。 */
export interface RosterRow {
  /** 登录账号。 */
  account: string;
  /** 姓名。 */
  name: string;
  /** 院系（可空）。 */
  faculty: string;
  /** 专业（可空）。 */
  major: string;
  /** 班级（可空）。 */
  className: string;
  /** 邮箱（可空）。 */
  email: string;
  /** 角色文本（可空）；空表示按是否有班级推断。 */
  role: string;
  /** 初始密码（可空）。 */
  password: string;
}

/** 预览行：带行号、校验结论与是否存在。 */
export interface RosterPreviewRow extends RosterRow {
  /** 行号（含表头，从 2 开始）。 */
  rowNo: number;
  /** 校验失败原因；有值则该行标红并跳过。 */
  error?: string | undefined;
  /** 系统中已存在该账号（将执行更新而非新建）。 */
  exists?: boolean | undefined;
  /** 角色是否由 CSV 显式指定。 */
  roleExplicit?: boolean | undefined;
}

/** 单行失败明细。 */
export interface RosterFailure {
  rowNo: number;
  account: string;
  reason: string;
}

/** 导入结果。 */
export interface RosterImportResult {
  /** 总行数。 */
  total: number;
  /** 成功数。 */
  succeeded: number;
  /** 新建数。 */
  created: number;
  /** 更新数。 */
  updated: number;
  /** 失败数。 */
  failed: number;
  /** 失败明细。 */
  failures: RosterFailure[];
}

/* ------------------------------------------------------------------ 列解析 */

/** 列名关键词 → 名单字段。 */
const COLUMN_KEYWORDS: Array<{ field: keyof RosterRow; keywords: string[] }> = [
  { field: "account", keywords: ["账号", "帐号", "学号", "工号", "用户名", "account", "username"] },
  { field: "name", keywords: ["姓名", "名字", "name"] },
  { field: "faculty", keywords: ["院系", "学院", "faculty", "college"] },
  { field: "major", keywords: ["专业", "major"] },
  { field: "className", keywords: ["班级", "班", "class"] },
  { field: "email", keywords: ["邮箱", "邮件", "email"] },
  { field: "role", keywords: ["角色", "身份", "role"] },
  { field: "password", keywords: ["初始密码", "密码", "password"] },
];

/**
 * 解析名单 CSV 文本为行数组。
 *
 * 按**表头名**匹配列（认中英文），账号 / 姓名缺列时抛错。
 */
export function parseRosterCsv(text: string): RosterRow[] {
  const grid = parseCsv(text);
  const headers = (grid[0] ?? []).map((h) => h.trim());
  if (headers.length === 0) throw new Error("CSV 为空");

  const indexOf = (field: keyof RosterRow): number => {
    const keywords = COLUMN_KEYWORDS.find((c) => c.field === field)?.keywords ?? [];
    return headers.findIndex((h) => {
      const lower = h.toLowerCase();
      return keywords.some((kw) => lower.includes(kw.toLowerCase()));
    });
  };

  const accountCol = indexOf("account");
  const nameCol = indexOf("name");
  if (accountCol < 0) throw new Error("CSV 缺少「账号」列");
  if (nameCol < 0) throw new Error("CSV 缺少「姓名」列");

  const cols = {
    account: accountCol,
    name: nameCol,
    faculty: indexOf("faculty"),
    major: indexOf("major"),
    className: indexOf("className"),
    email: indexOf("email"),
    role: indexOf("role"),
    password: indexOf("password"),
  };

  const cell = (row: string[], col: number): string => (col >= 0 ? (row[col] ?? "").trim() : "");

  return grid.slice(1).map((row) => ({
    account: cell(row, cols.account),
    name: cell(row, cols.name),
    faculty: cell(row, cols.faculty),
    major: cell(row, cols.major),
    className: cell(row, cols.className),
    email: cell(row, cols.email),
    role: cell(row, cols.role),
    password: cell(row, cols.password),
  }));
}

/* ------------------------------------------------------------------ 校验 */

/** 密码强度：至少 8 位且含字母与数字（PasswordPolicy）。 */
function passwordProblem(password: string): string | null {
  if (password.length < 8) return "初始密码至少 8 位";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "初始密码需同时包含字母与数字";
  }
  return null;
}

/**
 * 逐行校验（FR-IAM-05）。
 *
 * 错误行标红并跳过，**不阻断整批**。
 */
export function validateRosterRows(rows: readonly RosterRow[]): RosterPreviewRow[] {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const rowNo = index + 2;
    const account = row.account.trim();
    const preview: RosterPreviewRow = {
      ...row,
      rowNo,
      roleExplicit: row.role.trim().length > 0,
    };

    if (!account) {
      return { ...preview, error: "缺少账号" };
    }
    // 重复判定放在最前：账号一旦出现就算占位，后续同名行都算重复。
    const key = account.toLowerCase();
    if (seen.has(key)) {
      return { ...preview, error: "账号在本文件中重复" };
    }
    seen.add(key);
    if (!row.name.trim()) {
      return { ...preview, error: "缺少姓名" };
    }

    if (preview.roleExplicit && parseUserRole(row.role) === null) {
      return { ...preview, error: `角色无法识别：${row.role}` };
    }
    if (row.password.trim()) {
      const problem = passwordProblem(row.password.trim());
      if (problem) return { ...preview, error: problem };
    }

    preview.exists = Boolean(findUserByAccount(account));
    return preview;
  });
}

/* ------------------------------------------------------------------ 组织标签 */

/** 名单行 → 组织维度标签链（院系 → 专业 → 班级）。 */
function resolveOrgTags(row: RosterRow): { tagIds: string[]; classTagId: string | null } {
  const tagIds: string[] = [];
  let parentId: string | null = null;
  let classTagId: string | null = null;

  // 逐层创建/复用；缺失的中间层直接跳过，子节点挂到最近的有祖先上。
  for (const [index, name] of [row.faculty, row.major, row.className].entries()) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const { tag } = ensureOrgTag(trimmed, parentId);
    parentId = tag.id;
    tagIds.push(tag.id);
    if (index === 2) classTagId = tag.id;
  }

  return { tagIds, classTagId };
}

/** 组织标签 ID → 名单组（答题端的组织视图）。 */
function classIdOfTag(classTagId: string, className: string): string {
  const reverse: Record<string, string> = {};
  for (const [classId, tagId] of Object.entries(CLASS_TO_ORG)) {
    reverse[tagId] = classId;
  }
  const known = reverse[classTagId];
  if (known) return known;
  // 新建的班级：同步建一个同名名单组，学生才能按班级被纳入场次名单。
  const id = `cls-${classTagId}`;
  ensureClass(id, className);
  return id;
}

/** 从班级名里取入学年份（取不到就用当前年）。 */
function enrollYearOf(className: string): number {
  const hit = className.match(/(20\d{2})/);
  return hit ? Number(hit[1]) : new Date().getFullYear();
}

/* ------------------------------------------------------------------ 导入 */

/**
 * 执行导入。
 *
 * 逐行处理：错误行跳过并计入失败明细，其余行写入用户目录；
 * 已存在的账号走**更新**，不重置密码。
 */
export function importRoster(
  rows: readonly RosterPreviewRow[],
  operator = "陈砚之",
): RosterImportResult {
  const failures: RosterFailure[] = [];
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    if (row.error) {
      failures.push({ rowNo: row.rowNo, account: row.account, reason: row.error });
      continue;
    }

    const account = row.account.trim();
    const name = row.name.trim();
    const { tagIds, classTagId } = resolveOrgTags(row);

    // 角色：显式指定优先，否则按「是否有班级」推断。
    const explicitRole = row.roleExplicit ? parseUserRole(row.role) : null;
    const roles: UserRole[] = explicitRole
      ? [explicitRole]
      : [row.className.trim() ? "student" : "general_user"];

    const existing = findUserByAccount(account);
    if (existing) {
      const patch: Partial<AppUser> = { name };
      // 只在 CSV 给了组织信息时才动标签，避免把原有归属清空。
      if (tagIds.length > 0) patch.orgTags = tagIds;
      if (row.email.trim()) patch.email = row.email.trim();
      if (row.roleExplicit) patch.roles = roles;
      updateUser(existing.id, patch);
      updated += 1;
    } else {
      const result = createUser({
        account,
        name,
        email: row.email.trim(),
        roles,
        orgTags: tagIds,
        mustChangePassword: true,
      });
      if (!result.ok) {
        failures.push({ rowNo: row.rowNo, account, reason: result.message ?? "账号创建失败" });
        continue;
      }
      created += 1;
    }

    // 在校学生同步进学生档案（名单组 → 学生），这样才能被场次名单纳入。
    if (roles.includes("student") && classTagId) {
      const className = row.className.trim();
      const classId = classIdOfTag(classTagId, className);
      upsertStudent({
        id: account,
        name,
        classId,
        enrollYear: enrollYearOf(className),
      });
    }
  }

  const total = rows.length;
  const failed = failures.length;
  const succeeded = created + updated;

  writeAudit({
    operator,
    action: "user.import-roster",
    targetType: "user",
    targetId: "roster",
    summary: `批量导入人员名单：成功 ${succeeded}（新建 ${created} / 更新 ${updated}），失败 ${failed}`,
    ip: "10.12.0.21",
    userAgent: "Chrome 131 / Windows",
  });

  return { total, succeeded, created, updated, failed, failures };
}

/* ------------------------------------------------------------------ 内部 */

