/* ==========================================================================
   错题本筛选（FR-LRN-01）
   --------------------------------------------------------------------------
   两头都要对：
   - HTTP 模式：筛选条件发给服务端（`GET /mistakes` 的查询参数）；
   - mock 模式：本地按同一套口径筛（标签 / 题型 / 时间范围）。
   ========================================================================== */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  useLocalMistakeList,
  useRemoteMistakeList,
} from "@/features/mistakes/useMistakeList";

/** 造一个最小可用的 JSON 响应。 */
function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("错题本筛选 · HTTP 模式", () => {
  it("把筛选条件发给服务端", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() =>
      useRemoteMistakeList(true, {
        tagId: "t-dom-calc",
        questionType: "multi",
        from: "2026-09-01T00:00:00Z",
        includeResolved: true,
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/mistakes");
    expect(url).toContain("tagId=t-dom-calc");
    expect(url).toContain("questionType=multi");
    expect(url).toContain("includeResolved=true");
    expect(url).toContain("from=");
  });

  it("不筛选时只带上分页与默认的「不含已掌握」", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useRemoteMistakeList(true, {}));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("includeResolved=false");
    expect(url).not.toContain("tagId=");
    expect(url).not.toContain("questionType=");
  });
});

describe("错题本筛选 · mock 模式", () => {
  it("按题型筛选", () => {
    const { result } = renderHook(() => useLocalMistakeList(true, { questionType: "judge" }));

    expect(result.current.map((row) => row.questionId)).toEqual(["q-d-03", "q-e-04"]);
  });

  it("按标签筛选", () => {
    const { result } = renderHook(() => useLocalMistakeList(true, { tagId: "t-dom-calc" }));

    expect(result.current.map((row) => row.questionId)).toEqual(["q-m-05", "q-m-04"]);
  });

  it("按时间范围筛选", () => {
    const { result } = renderHook(() =>
      useLocalMistakeList(true, { from: "2026-09-22T00:00:00Z" }),
    );

    expect(result.current.map((row) => row.questionId)).toEqual(["q-m-05", "q-n-03"]);
  });

  it("不筛选时列出全部错题", () => {
    const { result } = renderHook(() => useLocalMistakeList(true, {}));

    expect(result.current.map((row) => row.questionId)).toEqual([
      "q-m-05",
      "q-n-03",
      "q-d-03",
      "q-e-04",
      "q-m-04",
    ]);
  });
});
