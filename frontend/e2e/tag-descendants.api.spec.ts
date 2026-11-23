/* ==========================================================================
   标签子树（真实后端）
   --------------------------------------------------------------------------
   标签是树：同维度内可设父标签（父 → 子 → 孙）。列表是平的，
   看不出一棵标签底下挂着谁——而删除带子标签的标签会被服务端拒绝
   （「下仍有子标签，请先移除子标签」），那句话还不说是哪些。

   这一组用例守的是三件事：
   1. 按父标签能展开出**整棵子树**（子孙也算）；
   2. `includeSelf=false` 时不把自己算进去；
   3. 子树里的标签带着自己的名字与父标签，页面能直接显示。

   **为什么必须在真实后端上验**：标签的父子关系存在后端的标签表里，
   mock 模式的标签是本地数据，接不接后端都验不出这件事。
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

test.describe("标签子树（真实后端）", () => {
  test("按父标签能展开整棵子树，孙子也算", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const stamp = Date.now();

    // 1. 父 → 子 → 孙三层。
    const parent = await api(admin, "POST", "/api/v1/tags", {
      code: `e2e-tree-parent-${stamp}`,
      name: `端到端父标签-${stamp}`,
      group: "domain",
      description: "",
      sortOrder: 0,
    });
    expectOk(parent, "建父标签");
    const parentId = parent.json.id ?? parent.json.tag?.id;

    const child = await api(admin, "POST", "/api/v1/tags", {
      code: `e2e-tree-child-${stamp}`,
      name: `端到端子标签-${stamp}`,
      group: "domain",
      parentId,
      description: "",
      sortOrder: 0,
    });
    expectOk(child, "建子标签");
    const childId = child.json.id ?? child.json.tag?.id;

    const grandchild = await api(admin, "POST", "/api/v1/tags", {
      code: `e2e-tree-grandchild-${stamp}`,
      name: `端到端孙标签-${stamp}`,
      group: "domain",
      parentId: childId,
      description: "",
      sortOrder: 0,
    });
    expectOk(grandchild, "建孙标签");
    const grandchildId = grandchild.json.id ?? grandchild.json.tag?.id;

    // 2. 展开父标签：子与孙都在。
    const subtree = await api(admin, "GET", `/api/v1/tags/${parentId}/descendants`);
    expectOk(subtree, "展开标签子树");
    expect(Number(subtree.json?.rootId), "根是那个父标签").toBe(Number(parentId));

    const ids: number[] = (subtree.json?.ids ?? []).map((value: any) => Number(value));
    expect(ids, "子树里有子标签").toContain(Number(childId));
    expect(ids, "子树里也有孙标签").toContain(Number(grandchildId));

    const tags: any[] = subtree.json?.tags ?? [];
    // 服务端接口的默认值是**含自己**：父 + 子 + 孙。
    expect(tags.length, "默认的子树含自己，一共三个").toBe(3);
    const childTag = tags.find((tag) => Number(tag.id) === Number(childId));
    expect(childTag, "子标签在子树里").toBeTruthy();
    expect(childTag.name, "子标签带自己的名字").toBe(`端到端子标签-${stamp}`);
    expect(Number(childTag.parentId), "子标签的父是那个父标签").toBe(Number(parentId));

    // 3. includeSelf=false：不把自己算进去。
    const withoutSelf = await api(
      admin,
      "GET",
      `/api/v1/tags/${parentId}/descendants?includeSelf=false`,
    );
    expectOk(withoutSelf, "展开标签子树（不含自己）");
    const withoutSelfIds: number[] = (withoutSelf.json?.ids ?? []).map((value: any) =>
      Number(value),
    );
    expect(withoutSelfIds, "不含自己时父标签不在里面").not.toContain(Number(parentId));
    expect(withoutSelfIds, "子与孙照旧在").toContain(Number(childId));
    expect((withoutSelf.json?.tags ?? []).length, "不含自己时只剩两个").toBe(2);
  });

  test("知识点能挂在领域标签下，展开子树时认得", async () => {
    // 需求 FR-CAT-02 的验收例子「选『高等数学』命中其下所有知识点」：
    // 「高等数学」是领域标签，它下面挂的是知识点标签——**跨维度**成树。
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const stamp = Date.now();

    const parent = await api(admin, "POST", "/api/v1/tags", {
      code: `e2e-cross-parent-${stamp}`,
      name: `端到端领域标签-${stamp}`,
      group: "domain",
      description: "",
      sortOrder: 0,
    });
    expectOk(parent, "建领域标签");
    const parentId = parent.json.id ?? parent.json.tag?.id;

    const child = await api(admin, "POST", "/api/v1/tags", {
      code: `e2e-cross-child-${stamp}`,
      name: `端到端知识点标签-${stamp}`,
      group: "knowledge_point",
      parentId,
      description: "",
      sortOrder: 0,
    });
    expectOk(child, "建知识点标签（跨维度挂父）");
    const childId = child.json.id ?? child.json.tag?.id;

    const subtree = await api(admin, "GET", `/api/v1/tags/${parentId}/descendants`);
    expectOk(subtree, "展开标签子树");

    const ids: number[] = (subtree.json?.ids ?? []).map((value: any) => Number(value));
    expect(ids, "子树里有那个知识点标签").toContain(Number(childId));

    const tags: any[] = subtree.json?.tags ?? [];
    const childTag = tags.find((tag) => Number(tag.id) === Number(childId));
    expect(childTag, "知识点标签在子树里").toBeTruthy();
    expect(childTag.group, "它仍是知识点维度的标签").toBe("knowledge_point");
  });
});
