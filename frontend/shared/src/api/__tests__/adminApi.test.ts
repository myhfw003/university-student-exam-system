/* ==========================================================================
   管理端接口的适配：权限点目录与角色权限
   --------------------------------------------------------------------------
   两个要点：

   1. **权限点目录**（`GET /permissions`）给的是码、中文名与模块——
      管理端的角色权限矩阵按它渲染。
   2. **角色权限是整体覆盖**（`PUT /roles/{id}`）：传什么就是什么，
      少传一个权限点，那个权限点就没了——不是增量。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import { createRole, loadPermissions, updateRole, type AdminClient } from "../adminApi";

/** 后端的权限点目录。 */
const PERMISSIONS = [
  { code: "paper:read", name: "查看试卷", module: "paper", description: null },
  { code: "paper:write", name: "编辑试卷", module: "paper", description: "改题位与基本信息" },
];

/** 后端的角色。 */
const ROLE = {
  id: 4,
  code: "grader_teacher",
  name: "阅卷教师",
  description: "只阅卷",
  isSystem: true,
  permissions: ["paper:read"],
};

/** 记录调用参数的假客户端。 */
function fakeClient() {
  const get = vi.fn(async (_path: string, _options?: unknown) => PERMISSIONS);
  const put = vi.fn(async (_path: string, _body?: unknown) => ROLE);
  const post = vi.fn(async (_path: string, _body?: unknown) => ROLE);
  const client = { get, put, post, delete: vi.fn() } as unknown as AdminClient;
  return { client, get, put, post };
}

describe("adminApi · 权限点目录与角色权限", () => {
  it("权限点目录按 DTO 映射", async () => {
    const { client, get } = fakeClient();

    const list = await loadPermissions(client);

    expect(get.mock.calls[0]![0]).toBe("/permissions");
    expect(list).toHaveLength(2);
    expect(list[0]!.code).toBe("paper:read");
    expect(list[0]!.name).toBe("查看试卷");
    expect(list[0]!.module).toBe("paper");
    expect(list[1]!.description).toBe("改题位与基本信息");
  });

  it("改角色权限：权限集合整体覆盖，按提交的来", async () => {
    const { client, put } = fakeClient();

    const role = await updateRole(
      "4",
      { name: "阅卷教师", description: "只阅卷", permissionCodes: ["paper:read"] },
      client,
    );

    const [path, body] = put.mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe("/roles/4");
    expect(body.permissionCodes).toEqual(["paper:read"]);
    expect(role.code).toBe("grader_teacher");
    expect(role.permissions).toEqual(["paper:read"]);
  });

  it("新建角色：编码去空白后发出，权限码原样带上", async () => {
    const { client, post } = fakeClient();

    const role = await createRole(
      {
        code: "  review_lead  ",
        name: "  阅卷组长  ",
        description: "负责派单",
        permissionCodes: ["paper:read", "review:grade"],
      },
      client,
    );

    const [path, body] = post.mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe("/roles");
    expect(body.code).toBe("review_lead");
    expect(body.name).toBe("阅卷组长");
    expect(body.permissionCodes).toEqual(["paper:read", "review:grade"]);
    expect(role.code).toBe("grader_teacher");
  });

  it("改角色权限时权限码原样发出（前端用字符串，后端认码本身）", async () => {
    const { client, put } = fakeClient();

    await updateRole(
      "4",
      { name: "阅卷教师", description: "", permissionCodes: ["paper:read", "paper:write"] },
      client,
    );

    const body = put.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.permissionCodes).toEqual(["paper:read", "paper:write"]);
  });
});
