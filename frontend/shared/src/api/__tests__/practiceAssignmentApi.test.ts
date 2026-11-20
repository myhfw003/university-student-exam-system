/* ==========================================================================
   练习开放单的接口适配
   --------------------------------------------------------------------------
   两处容易出错的地方：

   1. **ID 是数字主键**：前端一律用字符串，边界上要转成数字再发出去，
      否则后端绑定 `long` 会判非法值。
   2. **状态码是前后端共享的词表**：前端写错一个码，
      后端直接判「练习状态取值不合法。」
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import {
  archivePracticeAssignment,
  createPracticeAssignment,
  loadPracticeAssignments,
  publishPracticeAssignment,
  toPracticeAssignment,
  updatePracticeAssignment,
  type PracticeAssignmentClient,
} from "../practiceAssignmentApi";
import type { QueryValue } from "../httpClient";

/** 后端返回的一条开放单。 */
const DTO = {
  id: 12,
  title: "数据结构 · 树与查找专题",
  paperId: 34,
  paperName: "数据结构 · 树与查找（练习卷）",
  questionCount: 5,
  totalScore: 25,
  status: "published",
  statusLabel: "已上架",
  scopeTagIds: [7, 9],
  scopeTagNames: ["计算机科学 2023 级 1 班", "计算机科学 2023 级 2 班"],
  openAt: "2026-11-15T00:00:00Z",
  closeAt: null,
  publishedAt: "2026-11-15T08:05:00Z",
  createdAt: "2026-11-14T02:12:00Z",
  attemptCount: 3,
};

/** 记录调用参数的假客户端。 */
function fakeClient() {
  const get = vi.fn(async (_path: string, _options?: { query?: Record<string, QueryValue> }) => ({
    items: [DTO],
    total: 1,
    page: 1,
    size: 20,
  }));
  const post = vi.fn(async (_path: string, _body?: unknown) => DTO);
  const put = vi.fn(async (_path: string, _body?: unknown) => DTO);
  const client = { get, post, put } as unknown as PracticeAssignmentClient;
  return { client, get, post, put };
}

describe("practiceAssignmentApi · DTO 映射", () => {
  it("开放单映射成页面要的那一行", () => {
    const row = toPracticeAssignment(DTO);

    expect(row.id).toBe("12");
    expect(row.title).toBe("数据结构 · 树与查找专题");
    expect(row.paperId).toBe("34");
    expect(row.questionCount).toBe(5);
    expect(row.totalScore).toBe(25);
    expect(row.attemptCount).toBe(3);
  });

  it("状态中文名取自共享词表，不直接用后端的 statusLabel", () => {
    // 后端改了 statusLabel 时，前端显示的还是共享词表里的那个（CI 有校验）。
    const row = toPracticeAssignment({ ...DTO, statusLabel: "上架了" });
    expect(row.statusLabel).toBe("已上架");
  });

  it("开放范围 ID 转成字符串，空开放期是 null（表示不限）", () => {
    const row = toPracticeAssignment(DTO);
    expect(row.scopeTagIds).toEqual(["7", "9"]);
    expect(row.scopeTagNames).toEqual([
      "计算机科学 2023 级 1 班",
      "计算机科学 2023 级 2 班",
    ]);
    expect(row.closeAt).toBeNull();
    expect(row.openAt).toBe("2026-11-15T00:00:00Z");
  });
});

describe("practiceAssignmentApi · 请求", () => {
  it("列表把状态与关键词交给服务端过滤", async () => {
    const { client, get } = fakeClient();

    await loadPracticeAssignments({ keyword: "树", status: "draft", page: 2, size: 10 }, client);

    const query = (get.mock.calls[0]![1]?.query ?? {}) as Record<string, QueryValue>;
    expect(query.keyword).toBe("树");
    expect(query.status).toBe("draft");
    expect(query.page).toBe(2);
    expect(query.size).toBe(10);
  });

  it("新建时练习卷 ID 与开放范围标签都转成数字", async () => {
    const { client, post } = fakeClient();

    await createPracticeAssignment(
      {
        paperId: "34",
        title: "  数据结构 · 树与查找专题  ",
        scopeTagIds: ["7", "9"],
        openAt: null,
        closeAt: null,
      },
      client,
    );

    const [path, body] = post.mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe("/practice-assignments");
    expect(body.paperId).toBe(34);
    expect(body.scopeTagIds).toEqual([7, 9]);
    // 标题去空白后发出去。
    expect(body.title).toBe("数据结构 · 树与查找专题");
  });

  it("更新不带练习卷：后端的更新接口没有 paperId，换卷等于换一条开放单", async () => {
    const { client, put } = fakeClient();

    await updatePracticeAssignment(
      "12",
      { title: "新标题", scopeTagIds: [], openAt: null, closeAt: null },
      client,
    );

    const [path, body] = put.mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe("/practice-assignments/12");
    expect(body).not.toHaveProperty("paperId");
  });

  it("上架与下架打各自的端点", async () => {
    const { client, post } = fakeClient();

    await publishPracticeAssignment("12", client);
    await archivePracticeAssignment("12", client);

    const paths = post.mock.calls.map((call) => call[0]);
    expect(paths).toEqual([
      "/practice-assignments/12/publish",
      "/practice-assignments/12/archive",
    ]);
  });
});
