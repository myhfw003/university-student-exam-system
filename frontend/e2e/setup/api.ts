/* ==========================================================================
   端到端测试的 API 夹具。
   --------------------------------------------------------------------------
   这套用例打的是**真实后端**（compose 起的 API + PostgreSQL + Redis），
   不是前端的 mock 数据源。原因：越权与错误结构这类问题只有在真后端上
   才验得出来——mock 模式根本没有鉴权层。

   夹具负责：登录、准备一个学生账号、读取 OpenAPI 契约。
   ========================================================================== */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** API 基地址（不含 /api/v1 前缀由调用方补）。 */
export const apiRoot = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:5000";

/** 管理员账号：由端到端环境预先种子。 */
export const adminUsername = process.env.E2E_ADMIN_USERNAME ?? "admin";
export const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "admin-e2e-password";

/** 学生账号：不存在就现场建一个。 */
export const studentUsername = process.env.E2E_STUDENT_USERNAME ?? "e2e-student";
export const studentPassword = process.env.E2E_STUDENT_PASSWORD ?? "student-e2e-password";

/** 登录结果。 */
export interface Session {
  token: string;
  permissions: string[];
  userId: number;
}

/** OpenAPI 契约（接口全景巡检的依据）。 */
export interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: unknown;
  "x-required-permission"?: string;
}

/** 读契约文件：docs/api/openapi.json（与仓库同源，CI 会校验它是最新的）。 */
export function readOpenApiDocument(): OpenApiDocument {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, "../../../docs/api/openapi.json");

  return JSON.parse(readFileSync(file, "utf-8")) as OpenApiDocument;
}

/** 登录，拿到令牌与权限码。 */
export async function login(
  baseUrl: string,
  username: string,
  password: string,
): Promise<Session> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(
      `登录失败：${username} → HTTP ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as {
    accessToken: string;
    user?: { id?: number; permissions?: string[] };
  };

  return {
    token: body.accessToken,
    permissions: body.user?.permissions ?? [],
    userId: body.user?.id ?? 0,
  };
}

/**
 * 准备学生账号：不存在就用管理员建一个。
 * 返回可直接登录的账号口令。
 */
export async function ensureStudent(
  baseUrl: string,
  admin: Session,
): Promise<{ username: string; password: string }> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${admin.token}`,
  };

  // 找「学生」角色的 id。
  const rolesResponse = await fetch(`${baseUrl}/api/v1/roles`, { headers });
  const roles = (await rolesResponse.json()) as { id: number; code: string }[];
  const studentRole = roles.find((role) => role.code === "student");

  if (!studentRole) {
    throw new Error("端到端环境缺少「学生」角色，无法准备学生账号。");
  }

  // 账号已存在就直接用（密码不变）。
  const listResponse = await fetch(
    `${baseUrl}/api/v1/users?page=1&pageSize=200`,
    { headers },
  );
  const list = (await listResponse.json()) as { items?: { id: number; username: string }[] };
  const existing = list.items?.find((user) => user.username === studentUsername);

  if (!existing) {
    const createResponse = await fetch(`${baseUrl}/api/v1/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        username: studentUsername,
        displayName: "端到端学生",
        password: studentPassword,
        roleIds: [studentRole.id],
      }),
    });

    if (!createResponse.ok) {
      throw new Error(
        `创建学生账号失败：HTTP ${createResponse.status} ${await createResponse.text()}`,
      );
    }
  }

  return { username: studentUsername, password: studentPassword };
}
