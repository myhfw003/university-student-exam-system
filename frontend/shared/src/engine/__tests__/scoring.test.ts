import { describe, expect, it } from "vitest";
import type { Question } from "../../domain/types";
import {
  gradeObjective,
  gradeShort,
  gradeComprehensive,
  normalizeText,
  round2,
  stepScores,
} from "../scoring";

const multi: Question = {
  id: "q-m",
  type: "multi",
  score: 8,
  status: "published",
  source: "manual",
  tags: [],
  stem: "多选题",
  options: [
    { key: "A", text: "a" }, { key: "B", text: "b" }, { key: "D", text: "d" },
  ],
  answer: ["A", "B", "D"],
  analysis: "",
};

const short: Question = {
  id: "q-s",
  type: "short",
  score: 8,
  status: "published",
  source: "manual",
  tags: [],
  stem: "简答题",
  answer: [],
  analysis: "",
  keypoints: [
    { text: "极限的定义", keywords: ["定义", "极限"] },
    { text: "连续的条件", keywords: ["连续"] },
  ],
};

const comprehensive: Question = {
  id: "q-c",
  type: "comprehensive",
  score: 18,
  status: "published",
  source: "manual",
  tags: [],
  stem: "综合题",
  answer: [],
  analysis: "",
  steps: [
    { id: "s1", prompt: "算法思想", answer: "", keywords: ["思想"], score: 5 },
    { id: "s2", prompt: "代码实现", answer: "", keywords: ["代码"], score: 8 },
    { id: "s3", prompt: "复杂度", answer: "", keywords: ["复杂度"], score: 5 },
  ],
};

describe("判分口径", () => {
  it("多选错选不得分", () => {
    const r = gradeObjective(multi, ["A", "C"]);
    expect(r.status).toBe("wrong");
    expect(r.score).toBe(0);
  });

  it("多选全对得满分", () => {
    const r = gradeObjective(multi, ["A", "B", "D"]);
    expect(r.status).toBe("correct");
    expect(r.score).toBe(8);
  });

  it("多选漏选按答对项占比折半", () => {
    // 正确项 ABD（3 项），只选 A → 8 × (1/3) × 0.5 = 1.33
    const r = gradeObjective(multi, ["A"]);
    expect(r.status).toBe("partial");
    expect(r.score).toBe(round2(8 * (1 / 3) * 0.5));
  });

  it("未作答状态为 blank 且 0 分", () => {
    const r = gradeObjective(multi, []);
    expect(r.status).toBe("blank");
    expect(r.score).toBe(0);
  });

  it("单选只有一个选中且正确才得分", () => {
    const single: Question = { ...multi, id: "q-single", type: "single", answer: ["A"] };
    expect(gradeObjective(single, ["A"]).score).toBe(8);
    expect(gradeObjective(single, ["B"]).score).toBe(0);
  });

  it("文本归一化去掉空白、大小写与中英文标点", () => {
    expect(normalizeText("  Hello，World！ ")).toBe("helloworld");
  });

  it("简答按要点均分，命中任一关键词即得该要点分", () => {
    const r = gradeShort(short, "极限的定义要说清楚，连续性也要讲。");
    expect(r.points).toHaveLength(2);
    expect(r.points[0]?.hit).toBe(true);
    expect(r.points[1]?.hit).toBe(true);
    expect(r.score).toBe(8);
    expect(r.max).toBe(8);
  });

  it("简答要点均分为满分除以要点数", () => {
    const r = gradeShort(short, "只提到了极限");
    expect(r.points[0]?.max).toBe(4);
    expect(r.score).toBe(4);
  });

  it("综合题步骤分值等比缩放，末步吸收舍入余量", () => {
    const scores = stepScores(comprehensive, 18);
    expect(scores).toHaveLength(3);
    expect(round2(scores.reduce((a, b) => a + b, 0))).toBe(18);
    expect(scores[0]).toBe(5);
    expect(scores[1]).toBe(8);
    expect(scores[2]).toBe(5);
  });

  it("综合题步骤命中按关键词判定，各步独立", () => {
    const r = gradeComprehensive(comprehensive, { s1: "先说明算法思想", s3: "" }, 18);
    expect(r.steps[0]?.hit).toBe(true);
    expect(r.steps[1]?.hit).toBe(false);
    expect(r.score).toBe(5);
  });
});
