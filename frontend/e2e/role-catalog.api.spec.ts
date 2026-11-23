/* ==========================================================================
   角色目录的可见范围（真实后端）
   --------------------------------------------------------------------------
   角色目录是**用户管理的配套数据**：管用户的人（内容管理员也算）要能看到
   有哪些角色，用户页上的角色筛选与角色分配对话框才不是空的。

   所以读角色目录按 **user:read** 判定，不再要 role:read——
   而**改**角色集合仍然要 role:write（需求文档 §1 的矩阵里只给系统管理员）。

   这一组用例守的就是这条界线：读放宽了，写没放宽。
   ========================================================================== */

import { expect, test } from "@playwright/test";
import {
  adminPassword,
  adminUsername,
  apiRoot,
  login,
  studentPassword,
  studentUsername,
  type Session,
} from "./setup/api";

/** 一次请求：带上令牌，返回状态与解析后的 JSON（失败时把原文带出来）。 */
async function api(
  session: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; raw: string }> {
  const response = await fetch(`${apiRoot}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const raw = await response.text();

  let json: any;

  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }

  return { status: response.status, json, raw };
}

/** 端到端用的内容管理员账号。 */
const CONTENT_ADMIN_USERNAME = "e2e-content-admin";
const CONTENT_ADMIN_PASSWORD = "Passw0rd!";

/** 建一个内容管理员账号；已存在就补上内容管理员角色。 */
async function ensureContentAdmin(admin: Session): Promise<string> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${admin.token}`,
  };

  const rolesResponse = await fetch(`${apiRoot}/api/v1/roles`, { headers });
  const roles = (await rolesResponse.json()) as { id: number; code: string }[];
  const contentAdmin = roles.find((role) => role.code === "content_admin");

  if (!contentAdmin) {
    throw new Error("端到端环境缺少「内容管理员」角色。");
  }

  const listResponse = await fetch(`${apiRoot}/api/v1/users?page=1&size=200`, { headers });
  const list = (await listResponse.json()) as {
    items?: { id: number; username: string; roles?: string[] }[];
  };
  const existing = list.items?.find((user) => user.username === CONTENT_ADMIN_USERNAME);

  if (!existing) {
    const created = await fetch(`${apiRoot}/api/v1/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        username: CONTENT_ADMIN_USERNAME,
        displayName: "端到端内容管理员",
        password: CONTENT_ADMIN_PASSWORD,
        roleIds: [contentAdmin.id],
      }),
    });

    if (!created.ok) {
      throw new Error(`创建内容管理员失败：HTTP ${created.status} ${await created.text()}`);
    }
    return CONTENT_ADMIN_USERNAME;
  }

  if (!(existing.roles ?? []).includes(contentAdmin.code)) {
    const assigned = await fetch(`${apiRoot}/api/v1/users/${existing.id}/roles`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ roleIds: [contentAdmin.id] }),
    });

    if (!assigned.ok) {
      throw new Error(`补角色失败：HTTP ${assigned.status} ${await assigned.text()}`);
    }
  }

  return CONTENT_ADMIN_USERNAME;
}

test.describe("角色目录的可见范围（真实后端）", () => {
  test("内容管理员读得到角色目录，改角色仍然被拒", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    await ensureContentAdmin(admin);

    const contentAdmin = await login(
      apiRoot,
      CONTENT_ADMIN_USERNAME,
      CONTENT_ADMIN_PASSWORD,
    );

    // 读角色目录：内容管理员有 user:read，读得到。
    const roles = await api(contentAdmin, "GET", "/api/v1/roles");
    expect(roles.status, `读角色目录 → HTTP ${roles.status}: ${roles.raw}`).toBe(200);
    expect((roles.json ?? []).length, "角色目录不该是空的").toBeGreaterThan(0);

    // 但改角色集合仍要 role:write——矩阵里只给系统管理员。
    const users = await api(admin, "GET", "/api/v1/users?page=1&size=1");
    const targetId = users.json?.items?.[0]?.id;

    const assign = await api(contentAdmin, "PUT", `/api/v1/users/${targetId}/roles`, {
      roleIds: [],
    });
    expect(assign.status, "改角色集合应当是 403").toBe(403);
  });

  test("学生读不到角色目录", async () => {
    const student = await login(apiRoot, studentUsername, studentPassword);

    const roles = await api(student, "GET", "/api/v1/roles");
    expect(roles.status, "学生没有 user:read，应当读不到").toBe(403);
  });
});
