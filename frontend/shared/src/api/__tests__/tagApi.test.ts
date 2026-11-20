/* ==========================================================================
   标签后端接口的适配
   --------------------------------------------------------------------------
   标签是树：同维度内可设父标签。这一层守的是**子树展开**：

   标签列表是平的（一张表按维度分组返回），光看列表看不出某个标签下面
   挂着谁——「删除带子标签的标签会被服务端拒绝，但那句话不说是哪些」，
   管理员要自己看得见那棵子树。

   这一层要对的：
   1. 子树走 `GET /tags/{id}/descendants`；
   2. 后代 ID 与标签都要按 DTO 映射（ID 一律转字符串）。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import { loadTagDescendants, type TagClient } from "../tagApi";

/** 服务端给的子树。 */
const SUBTREE = {
  rootId: 7,
  ids: [8, 9],
  tags: [
    {
      id: 8,
      code: "domain.极限的定义",
      name: "极限的定义",
      group: "domain",
      groupLabel: "领域",
      parentId: 7,
      level: null,
      description: "",
      sortOrder: 0,
      isSystem: false,
      usageCount: 4,
    },
    {
      id: 9,
      code: "domain.连续",
      name: "连续",
      group: "domain",
      groupLabel: "领域",
      parentId: 8,
      level: null,
      description: "",
      sortOrder: 0,
      isSystem: false,
      usageCount: 1,
    },
  ],
};

describe("tagApi · 标签子树", () => {
  it("子树走 GET /tags/{id}/descendants", async () => {
    const get = vi.fn(
      async (_path: string, _options?: { query?: Record<string, unknown> }) => SUBTREE,
    );
    const client = { get } as unknown as TagClient;

    const subtree = await loadTagDescendants("7", {}, client);

    expect(get.mock.calls[0]![0]).toBe("/tags/7/descendants");
    // 默认不把自己算进去（服务端接口的默认值是包含自己）。
    expect(get.mock.calls[0]![1]?.query).toMatchObject({ includeSelf: "false" });
    expect(subtree.rootId).toBe("7");
    // 后代 ID 是子孙都算上的。
    expect(subtree.ids).toEqual(["8", "9"]);
    expect(subtree.tags).toHaveLength(2);
    expect(subtree.tags[0]!.name).toBe("极限的定义");
    expect(subtree.tags[0]!.parentId).toBe("7");
    expect(subtree.tags[1]!.parentId).toBe("8");
  });

  it("空子树也不报错：没有后代就是空数组", async () => {
    const get = vi.fn(async (_path: string, _options?: { query?: Record<string, unknown> }) => ({
      rootId: 3,
      ids: [],
      tags: [],
    }));
    const client = { get } as unknown as TagClient;

    const subtree = await loadTagDescendants("3", {}, client);

    expect(subtree.ids).toEqual([]);
    expect(subtree.tags).toEqual([]);
  });
});
