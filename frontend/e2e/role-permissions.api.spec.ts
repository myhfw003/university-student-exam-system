/* ==========================================================================
   角色权限（真实后端）
   --------------------------------------------------------------------------
   这一组用例守的是**角色权限矩阵**这条链路：

     读权限点目录 → 读角色目录 → 改角色的权限集合 → 再读确认落库 → 还原

   **为什么必须在真实后端上验**：角色权限存在库里的 `role_permission` 表，
   前端看不到也改不了；`GET /permissions` 与 `PUT /roles/{id}`
   之前一个都没接，管理员只能改数据库。

   用例改的是**阅卷教师**这个角色（不动系统管理员——它的权限就是全部），
   跑完会还原。
   ========================================================================== */

import { expect, test } from "@playwright/test";
import { adminPassword, adminUsername, apiRoot, login, type Session } from "./setup/api";

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

/** 断言成功，并把响应体带进失败信息。 */
function expectOk(result: { status: number; raw: string }, what: string) {
  expect(result.status, `${what} → HTTP ${result.status}: ${result.raw}`).toBeLessThan(300);
}

test.describe("角色权限（真实后端）", () => {
  test("能新建自定义角色，编码重复会被拒", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    // 编码全局唯一：每次跑都用新的。
    const code = `e2e_role_${Date.now()}`;

    const created = await api(admin, "POST", "/api/v1/roles", {
      code,
      name: "端到端角色",
      description: "端到端用例建的角色",
      permissionCodes: ["paper:read", "review:grade"],
    });
    expectOk(created, "新建角色");
    expect(created.json?.code).toBe(code);
    expect(created.json?.isSystem, "新建的角色不是系统内置").toBe(false);
    expect(created.json?.permissions?.length, "带了两个权限点").toBe(2);

    // 编码重复：422，并说清楚为什么。
    const duplicate = await api(admin, "POST", "/api/v1/roles", {
      code,
      name: "再来一个",
      description: "",
      permissionCodes: [],
    });
    expect(duplicate.status, "编码重复应当是 422").toBe(422);
    expect(duplicate.raw, "拒绝的原因要说清楚").toContain("已存在");

    // 角色目录里有它。
    const roles = await api(admin, "GET", "/api/v1/roles");
    expectOk(roles, "角色目录");
    expect(
      (roles.json ?? []).some((role: any) => role.code === code),
      "角色目录里要有新建的角色",
    ).toBe(true);
  });

  test("能看权限点目录，也能改角色的权限集合", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);

    // 1. 权限点目录：管理端的矩阵按它渲染（码 + 中文名 + 模块）。
    const permissions = await api(admin, "GET", "/api/v1/permissions");
    expectOk(permissions, "权限点目录");
    const points: any[] = permissions.json ?? [];
    expect(points.length, "权限点目录不该是空的").toBeGreaterThan(30);

    const paperWrite = points.find((point) => point.code === "paper:write");
    expect(paperWrite, "目录里应当有 paper:write").toBeTruthy();
    expect(paperWrite.name, "权限点要带中文名").toBeTruthy();
    expect(paperWrite.module, "权限点要带所属模块").toBeTruthy();

    // 2. 角色目录：改一个非管理员角色。
    const roles = await api(admin, "GET", "/api/v1/roles");
    expectOk(roles, "角色目录");
    const roleList: any[] = roles.json ?? [];
    const target = roleList.find((role) => role.code === "grader_teacher");
    expect(target, "角色目录里应当有阅卷教师").toBeTruthy();
    const before: string[] = target.permissions ?? [];

    // 3. 改权限集合：去掉一个、加一个（整体覆盖，不是增量）。
    const next = before.filter((code) => code !== "analytics:read").concat("system:configure");
    const update = await api(admin, "PUT", `/api/v1/roles/${target.id}`, {
      name: target.name,
      description: target.description ?? "",
      permissionCodes: next,
    });
    expectOk(update, "改角色权限");
    expect(update.json?.permissions?.length, "权限集合按提交的来").toBe(next.length);
    expect(update.json?.permissions, "去掉的权限点真的没了").not.toContain("analytics:read");
    expect(update.json?.permissions, "加上的权限点真的有了").toContain("system:configure");

    // 4. 再读一次：改动落库了。
    const after = await api(admin, "GET", "/api/v1/roles");
    expectOk(after, "再读角色目录");
    const changed = (after.json ?? []).find((role: any) => role.id === target.id);
    expect(changed?.permissions, "改动要落库").not.toContain("analytics:read");
    expect(changed?.permissions, "改动要落库").toContain("system:configure");

    // 5. 还原：别把库留在改过的状态。
    const restore = await api(admin, "PUT", `/api/v1/roles/${target.id}`, {
      name: target.name,
      description: target.description ?? "",
      permissionCodes: before,
    });
    expectOk(restore, "还原角色权限");
    const restored = (await api(admin, "GET", "/api/v1/roles")).json?.find(
      (role: any) => role.id === target.id,
    );
    expect(restored?.permissions?.length, "还原后权限集合长度回到原样").toBe(before.length);
  });
});
