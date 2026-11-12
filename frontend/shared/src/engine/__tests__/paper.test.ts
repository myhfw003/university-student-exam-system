import { describe, expect, it } from "vitest";
import type { ExamPaper, Question } from "../../domain/types";
import { buildPaper, canonicalOrder, LETTERS } from "../paper";

const questions: Question[] = [
  { id: "q-s1", type: "single", score: 5, status: "published", source: "manual", tags: ["t-df1"], stem: "单选1", options: [
    { key: "A", text: "a" }, { key: "B", text: "b" }, { key: "C", text: "c" }, { key: "D", text: "d" },
  ], answer: ["A"], analysis: "" },
  { id: "q-s2", type: "single", score: 5, status: "published", source: "manual", tags: ["t-df2"], stem: "单选2", options: [
    { key: "A", text: "a" }, { key: "B", text: "b" }, { key: "C", text: "c" }, { key: "D", text: "d" },
  ], answer: ["B"], analysis: "" },
  { id: "q-j1", type: "judge", score: 4, status: "published", source: "manual", tags: ["t-df1"], stem: "判断1", options: [
    { key: "A", text: "正确" }, { key: "B", text: "错误" },
  ], answer: ["A"], analysis: "" },
  { id: "q-sh1", type: "short", score: 8, status: "published", source: "manual", tags: ["t-df3"], stem: "简答1", answer: [], analysis: "" },
];

const exam: ExamPaper = {
  id: "exam-x",
  name: "测试卷",
  batch: "",
  tags: [],
  durationMin: 60,
  totalScore: 22,
  passScore: 0,
  openAt: "",
  closeAt: "",
  status: "ongoing",
  published: true,
  allowRetake: false,
  publishAnswer: "after_close",
  scope: [],
  questionIds: ["q-sh1", "q-j1", "q-s2", "q-s1"],
  items: [
    { qid: "q-s1", score: 5 },
    { qid: "q-s2", score: 5 },
    { qid: "q-j1", score: 4 },
    { qid: "q-sh1", score: 8 },
  ],
  orderRule: "type",
  plum: { mode: "standard" },
  note: "",
};

const getQuestion = (id: string) => questions.find((q) => q.id === id);
const difficultyLevels = { "t-df1": 1, "t-df2": 2, "t-df3": 3 };

describe("buildPaper · 卷面构建", () => {
  it("标准卷：题序按题型分块，选项顺序固定", () => {
    const paper = buildPaper(exam, "2023120101", { mode: "standard" }, getQuestion, difficultyLevels);

    expect(paper.items.map((i) => i.qid)).toEqual(["q-s1", "q-s2", "q-j1", "q-sh1"]);
    expect(paper.variantKey).toBe("STD");
    expect(paper.variantLabel).toBe("标准卷");
    for (const item of paper.items) {
      expect(item.changed).toBe(false);
      // 显示字母按位置重编号 A/B/C/D。
      expect(item.displayKeys).toEqual(["A", "B", "C", "D"].slice(0, item.displayKeys.length));
    }
  });

  it("卷面配分以 items 为准，回退题目默认分值", () => {
    const paper = buildPaper(exam, "2023120101", { mode: "standard" }, getQuestion, difficultyLevels);
    expect(paper.items.find((i) => i.qid === "q-s1")?.score).toBe(5);
    expect(paper.items.find((i) => i.qid === "q-sh1")?.score).toBe(8);
  });

  it("toOriginal 记录「显示字母 → 原题键」，fromOriginal 是其逆", () => {
    const paper = buildPaper(exam, "2023120101", { mode: "small" }, getQuestion, difficultyLevels);
    const item = paper.items.find((i) => i.qid === "q-s1")!;

    // 逐项校验两个映射互为逆映射。
    for (const [display, original] of Object.entries(item.toOriginal)) {
      expect(item.fromOriginal[original]).toBe(display);
    }
    expect(Object.keys(item.toOriginal).sort()).toEqual(
      LETTERS.slice(0, item.displayKeys.length).slice().sort(),
    );
  });

  it("判断题固定不参与选项置换", () => {
    const paper = buildPaper(exam, "2023120101", { mode: "large" }, getQuestion, difficultyLevels);
    const judge = paper.items.find((i) => i.qid === "q-j1")!;
    expect(judge.displayKeys).toEqual(["A", "B"]);
    expect(judge.changed).toBe(false);
  });

  it("同种子同考生结果完全一致（可复现）", () => {
    const a = buildPaper(exam, "2023120101", { mode: "large" }, getQuestion, difficultyLevels);
    const b = buildPaper(exam, "2023120101", { mode: "large" }, getQuestion, difficultyLevels);
    expect(a.items.map((i) => i.displayKeys)).toEqual(b.items.map((i) => i.displayKeys));
    expect(a.seedLabel).toBe(b.seedLabel);
  });

  it("不同考生在大梅花下拿到不同卷面", () => {
    const a = buildPaper(exam, "2023120101", { mode: "large" }, getQuestion, difficultyLevels);
    const b = buildPaper(exam, "2023120207", { mode: "large" }, getQuestion, difficultyLevels);
    const keyA = a.items.map((i) => i.orderText).join("|");
    const keyB = b.items.map((i) => i.orderText).join("|");
    expect(keyA).not.toBe(keyB);
    // 卷号标签取学号后四位。
    expect(a.variantLabel).toBe("0101 号卷");
    expect(b.variantLabel).toBe("0207 号卷");
  });

  it("小梅花题序全体统一，仅选项顺序不同", () => {
    const a = buildPaper(exam, "2023120101", { mode: "small" }, getQuestion, difficultyLevels);
    const b = buildPaper(exam, "2023120207", { mode: "small" }, getQuestion, difficultyLevels);
    expect(a.items.map((i) => i.qid)).toEqual(b.items.map((i) => i.qid));
  });

  it("题序规则为 manual 时保持选题顺序", () => {
    const manualExam = { ...exam, orderRule: "manual" as const };
    const paper = buildPaper(manualExam, "2023120101", { mode: "standard" }, getQuestion, difficultyLevels);
    expect(paper.items.map((i) => i.qid)).toEqual(exam.questionIds);
  });

  it("canonicalOrder 按题型分块、组内难度升序", () => {
    const order = canonicalOrder(exam, getQuestion, difficultyLevels);
    // 单选（基础→中等）→ 判断 → 简答
    expect(order).toEqual(["q-s1", "q-s2", "q-j1", "q-sh1"]);
  });
});
