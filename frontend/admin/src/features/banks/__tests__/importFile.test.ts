/* ==========================================================================
   试题导入解析的单元测试
   --------------------------------------------------------------------------
   覆盖 CSV 解析、列映射猜测、逐行校验（错误行标红但不阻断整批）。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import {
  buildImportRows,
  guessMapping,
  parseAnswer,
  parseCsv,
  parseOptions,
} from "../importFile";

describe("importFile · CSV 解析", () => {
  it("识别引号、逗号与字段内换行", () => {
    const rows = parseCsv('题干,题型\n"含,逗号的题干",单选题\n"含\n换行",多选题');
    expect(rows).toHaveLength(3);
    expect(rows[1]?.[0]).toBe("含,逗号的题干");
    expect(rows[2]?.[0]).toBe("含\n换行");
    expect(rows[2]?.[1]).toBe("多选题");
  });

  it("去掉 UTF-8 BOM 并跳过空行", () => {
    const rows = parseCsv("﻿题干,题型\n\n甲,单选题\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[0]).toBe("题干");
  });

  it("支持制表符分隔", () => {
    const rows = parseCsv("题干\t题型\n甲\t判断题");
    expect(rows[1]?.[1]).toBe("判断题");
  });
});

describe("importFile · 列映射与逐行校验", () => {
  const headers = ["题号", "题目内容", "类型", "选项", "正确答案", "解析", "标签", "分值"];

  it("按表头自动猜测列映射", () => {
    const mapping = guessMapping(headers);
    expect(mapping.stem).toBe("题目内容");
    expect(mapping.type).toBe("类型");
    expect(mapping.answer).toBe("正确答案");
    expect(mapping.score).toBe("分值");
  });

  it("合法行通过校验，非法行标错且不阻断整批", () => {
    const rows = buildImportRows(
      [
        ["1", "1+1 等于几？", "单选题", "A. 1|B. 2|C. 3|D. 4", "B", "加法", "数学基础", "5"],
        ["2", "", "单选题", "A. 1|B. 2", "A", "", "", "5"],
        ["3", "多选哪几项正确？", "多选题", "A. 甲|B. 乙|C. 丙", "A", "", "", "5"],
      ],
      headers,
      {
        stem: "题目内容",
        type: "类型",
        options: "选项",
        answer: "正确答案",
        analysis: "解析",
        knowledge: "标签",
        score: "分值",
      },
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]?.valid).toBe(true);
    expect(rows[0]?.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
    expect(rows[0]?.answer).toEqual(["B"]);
    expect(rows[0]?.score).toBe(5);

    expect(rows[1]?.valid).toBe(false);
    expect(rows[1]?.error).toContain("题干为空");

    expect(rows[2]?.valid).toBe(false);
    expect(rows[2]?.error).toContain("多选题至少需要两个正确选项");
  });

  it("题型接受中英文标签，分值越界报错", () => {
    const rows = buildImportRows(
      [["甲", "题干？", "single", "A. 1|B. 2", "A", "", "", "99"]],
      headers,
      { stem: "题目内容", type: "类型", options: "选项", answer: "正确答案", score: "分值" },
    );
    expect(rows[0]?.type).toBe("single");
    expect(rows[0]?.valid).toBe(false);
    expect(rows[0]?.error).toContain("分值");
  });

  it("难度列的「基础 / 1 / 2 / 3」映射到难度标签", () => {
    const rows = buildImportRows(
      [["甲", "题干？", "判断题", "", "正确", "", "基础", ""]],
      headers,
      { stem: "题目内容", type: "类型", answer: "正确答案", knowledge: "标签" },
    );
    expect(rows[0]?.answer).toEqual(["A"]);
    expect(rows[0]?.tags).toContain("t-df1");
  });
});

describe("importFile · 选项与答案解析", () => {
  it("选项支持 A. / A、 / A= 三种写法", () => {
    expect(parseOptions("A. 甲|B. 乙")).toEqual([
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
    ]);
    expect(parseOptions("A、甲\nB、乙")).toEqual([
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
    ]);
    expect(parseOptions("A=甲|B=乙")).toEqual([
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
    ]);
  });

  it("答案支持 AB / A B / A,B，判断题支持「正确 / 错误」", () => {
    expect(parseAnswer("AB", "multi")).toEqual(["A", "B"]);
    expect(parseAnswer("A B", "multi")).toEqual(["A", "B"]);
    expect(parseAnswer("A,B", "multi")).toEqual(["A", "B"]);
    expect(parseAnswer("正确", "judge")).toEqual(["A"]);
    expect(parseAnswer("错误", "judge")).toEqual(["B"]);
  });
});
