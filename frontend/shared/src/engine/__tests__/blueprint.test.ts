import { describe, expect, it } from "vitest";
import type { BlueprintRules } from "../blueprint";
import { allocate, InsufficientQuestionPoolError, selectQuestions } from "../blueprint";
import type { Question } from "../../domain/types";

const difficultyMap = { "t-df1": 1, "t-df2": 2, "t-df3": 3 };

function makeQuestion(id: string, type: Question["type"], difficultyTag: string): Question {
  const question: Question = {
    id,
    type,
    score: 5,
    status: "published",
    source: "manual",
    tags: ["t-dom-x", difficultyTag],
    stem: id,
    answer: ["A"],
    analysis: "",
  };
  if (type !== "short" && type !== "comprehensive") {
    question.options = [
      { key: "A", text: "a" },
      { key: "B", text: "b" },
    ];
  }
  return question;
}

const pool: Question[] = [
  makeQuestion("q-01", "single", "t-df1"),
  makeQuestion("q-02", "single", "t-df1"),
  makeQuestion("q-03", "single", "t-df2"),
  makeQuestion("q-04", "single", "t-df2"),
  makeQuestion("q-05", "judge", "t-df1"),
  makeQuestion("q-06", "judge", "t-df3"),
  makeQuestion("q-07", "multi", "t-df2"),
];

const baseRules: BlueprintRules = {
  tagSelector: { tagIds: ["t-dom-x"], includeChildren: false, matchMode: "any" },
  difficultyQuota: { "t-df1": 2, "t-df2": 2 },
  typeQuota: { single: 3, judge: 1 },
  targetTotalScore: 20,
  orderRule: "type",
  scoreAllocation: "even",
};

describe("allocate · 分值分配", () => {
  it("各项之和精确等于总分", () => {
    const result = allocate(20, 3);
    expect(round2(result.reduce((a, b) => a + b, 0))).toBe(20);
  });

  it("各项不为负", () => {
    const result = allocate(1, 4);
    expect(result.every((v) => v >= 0)).toBe(true);
    expect(round2(result.reduce((a, b) => a + b, 0))).toBe(1);
  });

  it("余数按指定顺序优先分配", () => {
    // 9.5 / 3 → base 3.0，余数 0.5，恰好一次 +0.5，落在 order 的首位。
    const result = allocate(9.5, 3, [2, 0, 1]);
    expect(result[2]).toBe(3.5);
    expect(result[0]).toBe(3);
    expect(result[1]).toBe(3);
    expect(round2(result.reduce((a, b) => a + b, 0))).toBe(9.5);
  });

  it("余数为 1.0 时按顺序连续分配两次", () => {
    const result = allocate(10, 3, [2, 0, 1]);
    expect(result[2]).toBe(3.5);
    expect(result[0]).toBe(3.5);
    expect(result[1]).toBe(3);
    expect(round2(result.reduce((a, b) => a + b, 0))).toBe(10);
  });
});

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

describe("selectQuestions · 确定性抽题", () => {
  it("同规则同种子结果完全一致", () => {
    const a = selectQuestions(baseRules, pool, "seed-1", difficultyMap);
    const b = selectQuestions(baseRules, pool, "seed-1", difficultyMap);
    expect(a.items.map((i) => i.qid)).toEqual(b.items.map((i) => i.qid));
    expect(a.items.map((i) => i.score)).toEqual(b.items.map((i) => i.score));
  });

  it("不同种子可能给出不同结果", () => {
    const a = selectQuestions(baseRules, pool, "seed-1", difficultyMap);
    const b = selectQuestions(baseRules, pool, "seed-2", difficultyMap);
    // 不强制不同（池小），但必须都是合法结果。
    expect(a.itemCount).toBe(b.itemCount);
  });

  it("题量与目标题数一致", () => {
    const result = selectQuestions(baseRules, pool, "seed-1", difficultyMap);
    expect(result.itemCount).toBe(4);
  });

  it("总分精确等于目标总分", () => {
    const result = selectQuestions(baseRules, pool, "seed-1", difficultyMap);
    expect(round2(result.totalScore)).toBe(20);
  });

  it("池量不足时抛异常并携带全部缺口，不静默降级", () => {
    const greedy: BlueprintRules = {
      ...baseRules,
      typeQuota: { single: 10 },
      difficultyQuota: { "t-df1": 5, "t-df2": 5 },
    };
    let caught: InsufficientQuestionPoolError | null = null;
    try {
      selectQuestions(greedy, pool, "seed-1", difficultyMap);
    } catch (error) {
      caught = error as InsufficientQuestionPoolError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.shortfalls.length).toBeGreaterThan(0);
    expect(caught!.shortfalls[0]).toMatchObject({
      type: "single",
      required: expect.any(Number),
      available: expect.any(Number),
    });
  });

  it("题序按题型分块", () => {
    const result = selectQuestions(baseRules, pool, "seed-1", difficultyMap);
    const types = result.items.map((i) => pool.find((q) => q.id === i.qid)!.type);
    const firstJudge = types.indexOf("judge");
    const lastSingle = types.lastIndexOf("single");
    expect(lastSingle).toBeLessThan(firstJudge);
  });
});
