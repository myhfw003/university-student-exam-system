/* ==========================================================================
   导入批次接口的适配
   --------------------------------------------------------------------------
   两件事要在这一层做对：

   1. **逐行结果要能取回来**：批次的行存在服务端，重新打开一个批次
      靠的是 `GET /imports/{id}`——这个接口之前没人调。
   2. **错误明细是字符串数组**：服务端给的是 `{field, reason}` 的结构，
      这一层把它拍平成一行一条的字符串，页面直接显示。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import { loadImportBatch, loadImportBatches, type ImportClient } from "../importApi";

/** 后端返回的批次详情。 */
const DETAIL = {
  batch: {
    id: 77,
    fileName: "2026秋季期中试题汇总.csv",
    fileType: "csv",
    status: "parsed",
    totalRows: 2,
    validRows: 1,
    invalidRows: 1,
    adoptedCount: 0,
    columnMapping: { stem: "题干", type: "题型" },
    adoptedBy: null,
    adoptedAt: null,
    createdAt: "2026-11-18T08:00:00Z",
  },
  // 重新打开的批次**没有文件表头**：表头只在解析当场拿得到，后端没存。
  headers: [],
  rows: [
    {
      rowNumber: 1,
      valid: true,
      errors: [],
      parsed: '{"stem":"1 + 1 = ?"}',
    },
    {
      rowNumber: 2,
      valid: false,
      errors: [{ field: "type", reason: "无法识别的题型「」。" }],
      parsed: "{}",
    },
  ],
};

/** 记录调用参数的假客户端。 */
function fakeClient() {
  const get = vi.fn(async (_path: string, _options?: unknown) => DETAIL);
  const client = { get, post: vi.fn(), put: vi.fn() } as unknown as ImportClient;
  return { client, get };
}

describe("importApi · 导入批次详情", () => {
  it("按批次 ID 取详情，路径带上 ID", async () => {
    const { client, get } = fakeClient();

    await loadImportBatch("77", client);

    expect(get.mock.calls[0]![0]).toBe("/imports/77");
  });

  it("逐行结果回来了：错误明细拍平成字符串", async () => {
    const { client } = fakeClient();

    const detail = await loadImportBatch("77", client);

    expect(detail.batch.id).toBe("77");
    expect(detail.batch.totalRows).toBe(2);
    expect(detail.batch.columnMapping).toEqual({ stem: "题干", type: "题型" });
    expect(detail.rows).toHaveLength(2);
    expect(detail.rows[0]!.valid).toBe(true);
    expect(detail.rows[1]!.valid).toBe(false);
    expect(detail.rows[1]!.errors).toEqual(["无法识别的题型「」。"]);
    // 文件表头没有存：重新打开的批次拿不到表头。
    expect(detail.headers).toEqual([]);
  });

  it("批次列表按 DTO 映射", async () => {
    const listClient = {
      get: vi.fn(async () => ({ items: [DETAIL.batch], total: 1 })),
    } as unknown as ImportClient;

    const page = await loadImportBatches({ size: 20 }, listClient);

    expect(page.total).toBe(1);
    expect(page.items[0]!.fileName).toBe("2026秋季期中试题汇总.csv");
    expect(page.items[0]!.totalRows).toBe(2);
  });
});
