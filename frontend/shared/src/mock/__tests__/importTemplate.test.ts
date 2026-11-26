/* ==========================================================================
   mock 模式下的导入模板
   --------------------------------------------------------------------------
   这份模板是给「没有服务端」的演示模式用的，内容必须与后端那份**逐字一致**
   （`scripts/check-question-import-columns.py` 盯着字段、表头、必填、说明、示例）。
   这里盯的是 CSV 本身：Excel 打开中文不乱码、带逗号的单元格不串列。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import {
  IMPORT_TEMPLATE_COLUMNS,
  IMPORT_TEMPLATE_FILE_NAME,
  IMPORT_TEMPLATE_NOTES,
  IMPORT_TEMPLATE_SAMPLE_ROWS,
  importTemplateCsv,
} from "../importTemplate";

describe("导入模板（mock）", () => {
  it("CSV 带 BOM，Excel 打开中文不乱码", () => {
    const csv = importTemplateCsv();

    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("第一行是表头，后面每行一道示例题", () => {
    const lines = importTemplateCsv()
      .replace(/^﻿/, "")
      .split("\r\n")
      .filter((line) => line.length > 0);

    expect(lines[0]).toBe(IMPORT_TEMPLATE_COLUMNS.map((c) => c.header).join(","));
    expect(lines).toHaveLength(1 + IMPORT_TEMPLATE_SAMPLE_ROWS.length);
  });

  it("含逗号的单元格被引号包起来", () => {
    const csv = importTemplateCsv();

    // 示例行的知识点是「计算机网络,TCP」——带逗号必须转义，否则 Excel 会拆成两列。
    expect(csv).toContain('"计算机网络,TCP"');
  });

  it("文件名与说明都在", () => {
    expect(IMPORT_TEMPLATE_FILE_NAME).toBe("试题导入模板.csv");
    expect(IMPORT_TEMPLATE_NOTES.length).toBeGreaterThan(0);
  });

  it("每一列都有说明与示例值", () => {
    for (const column of IMPORT_TEMPLATE_COLUMNS) {
      expect(column.description.length).toBeGreaterThan(0);
      expect(column.example.length).toBeGreaterThan(0);
    }
  });
});
