import { describe, expect, it } from "vitest";
import {
  addReview,
  bankStats,
  createTag,
  discardQuestion,
  difficultyLabel,
  isInScope,
  itemsOf,
  matchTags,
  preflight,
  primaryTagName,
  publishedQuestionIds,
  removeTag,
  scopeStudents,
  setQuestionStatus,
  setQuestionsStatus,
  studentExam,
  studentExams,
  studentPractice,
  studentPractices,
  updateReview,
  updateTag,
  usageOf,
  useCatalog,
  validateTags,
} from "../catalog";
import { SEED } from "../seed";

/** 取当前内容仓库的状态快照。 */
const state = () => useCatalog.getState();

describe("seed 数据完整性", () => {
  it("题目挂载的标签都存在", () => {
    const tagIds = new Set(state().tags.map((t) => t.id));
    for (const question of state().questions) {
      for (const tagId of question.tags) {
        expect(tagIds.has(tagId), `题目 ${question.id} 引用了不存在的标签 ${tagId}`).toBe(true);
      }
    }
  });

  it("题库引用的题目都存在", () => {
    const questionIds = new Set(state().questions.map((q) => q.id));
    for (const bank of state().banks) {
      for (const qid of bank.questionIds) {
        expect(questionIds.has(qid), `题库 ${bank.id} 引用了不存在的题目 ${qid}`).toBe(true);
      }
    }
  });

  it("试卷与练习引用的题目都存在，且配分与题目一致", () => {
    const questionIds = new Set(state().questions.map((q) => q.id));
    for (const paper of [...state().exams, ...state().practices]) {
      for (const qid of paper.questionIds) {
        expect(questionIds.has(qid), `${paper.id} 引用了不存在的题目 ${qid}`).toBe(true);
      }
      // questionIds 与 items 必须同步——items 是配分口径的唯一来源。
      expect(paper.items.map((i) => i.qid)).toEqual(paper.questionIds);
    }
  });

  it("试卷与练习挂载的标签都存在", () => {
    const tagIds = new Set(state().tags.map((t) => t.id));
    for (const paper of [...state().exams, ...state().practices]) {
      for (const tagId of paper.tags) {
        expect(tagIds.has(tagId), `${paper.id} 引用了不存在的标签 ${tagId}`).toBe(true);
      }
    }
  });

  it("学生的名单组都存在", () => {
    const classIds = new Set(state().classes.map((c) => c.id));
    for (const student of state().students) {
      expect(classIds.has(student.classId), `学生 ${student.id} 的名单组不存在`).toBe(true);
    }
  });

  it("客观题都有选项与正确答案", () => {
    for (const question of state().questions) {
      if (question.type === "short" || question.type === "comprehensive") continue;
      expect(question.options?.length, `客观题 ${question.id} 缺选项`).toBeGreaterThan(0);
      expect(question.answer.length, `客观题 ${question.id} 缺正确答案`).toBeGreaterThan(0);
      const keys = new Set(question.options?.map((o) => o.key));
      for (const key of question.answer) {
        expect(keys.has(key), `客观题 ${question.id} 的正确答案 ${key} 不在选项中`).toBe(true);
      }
    }
  });

  it("判断题固定为「正确 / 错误」两项", () => {
    for (const question of state().questions.filter((q) => q.type === "judge")) {
      expect(question.options?.map((o) => o.text)).toEqual(["正确", "错误"]);
    }
  });

  it("主观题都有评分要点或步骤", () => {
    for (const question of state().questions) {
      if (question.type === "short") {
        expect(question.keypoints?.length, `简答题 ${question.id} 缺评分要点`).toBeGreaterThan(0);
      }
      if (question.type === "comprehensive") {
        expect(question.steps?.length, `综合题 ${question.id} 缺评分步骤`).toBeGreaterThan(0);
        const ids = question.steps!.map((s) => s.id);
        expect(new Set(ids).size, `综合题 ${question.id} 的步骤 id 重复`).toBe(ids.length);
      }
    }
  });

  it("每个标签分组都有词条", () => {
    for (const group of ["domain", "knowledge_point", "ability", "difficulty"] as const) {
      expect(
        state().tags.filter((t) => t.group === group).length,
        `分组 ${group} 没有标签`,
      ).toBeGreaterThan(0);
    }
  });

  it("难度标签都有等级", () => {
    for (const tag of state().tags.filter((t) => t.group === "difficulty")) {
      expect(tag.level, `难度标签 ${tag.id} 缺等级`).toBeDefined();
    }
  });

  it("种子数据规模符合预期", () => {
    expect(SEED.TAGS.length).toBeGreaterThanOrEqual(30);
    expect(SEED.questions.length).toBeGreaterThanOrEqual(30);
    expect(SEED.banks.length).toBeGreaterThanOrEqual(5);
    expect(SEED.students.length).toBeGreaterThanOrEqual(12);
    expect(SEED.exams.length).toBeGreaterThanOrEqual(3);
    expect(SEED.practices.length).toBeGreaterThanOrEqual(5);
    expect(SEED.paperTemplates.length).toBeGreaterThanOrEqual(3);
  });
});

describe("catalog · 标签", () => {
  it("同一分组内不允许同名标签", () => {
    const result = createTag({ name: "高等数学", group: "domain" });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("同一分组内已存在同名标签");
  });

  it("标签名不能为空", () => {
    const result = createTag({ name: "  ", group: "domain" });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("请填写标签名称");
  });

  it("可以更新标签名，且改名时排除自身", () => {
    const created = createTag({ name: "临时标签", group: "ability" });
    expect(created.ok).toBe(true);
    const id = created.tag!.id;

    const renamed = updateTag(id, { name: "临时标签改名" });
    expect(renamed.ok).toBe(true);
    expect(state().tags.find((t) => t.id === id)?.name).toBe("临时标签改名");

    // 改成与**同组**另一个标签同名应被拒绝（「计算求解」在能力组）。
    const conflict = updateTag(id, { name: "计算求解" });
    expect(conflict.ok).toBe(false);
    expect(conflict.message).toBe("同一分组内已存在同名标签");

    // 跨组同名不冲突——分组内唯一即可。
    const crossGroup = updateTag(id, { name: "高等数学" });
    expect(crossGroup.ok).toBe(true);
  });

  it("标签挂载上限为 5", () => {
    const result = validateTags(["a", "b", "c", "d", "e", "f"]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("最多只能选择 5 个标签");
  });

  it("标签不可重复选择", () => {
    const result = validateTags(["t-dom-calc", "t-dom-calc"]);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("标签不可重复选择");
  });

  it("无效标签被拒绝", () => {
    const result = validateTags(["不存在的标签"]);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("存在无效标签，请重新选择");
  });

  it("删除标签会级联解除挂载，对象本身保留", () => {
    const before = state().questions.filter((q) => q.tags.includes("t-dom-calc")).length;
    expect(before).toBeGreaterThan(0);
    const original = state().tags.find((t) => t.id === "t-dom-calc")!;

    const result = removeTag("t-dom-calc");
    expect(result.ok).toBe(true);
    expect(state().questions.filter((q) => q.tags.includes("t-dom-calc")).length).toBe(0);
    // 题目本身还在。
    expect(state().questions.length).toBeGreaterThan(0);
    expect(state().tags.find((t) => t.id === "t-dom-calc")).toBeUndefined();

    // 还原标签，避免影响后续用例。
    useCatalog.setState({ tags: [...state().tags, original] });
  });

  it("标签使用统计覆盖题目与试卷", () => {
    const usage = usageOf("t-dom-net");
    expect(usage.questions).toBeGreaterThan(0);
    expect(usage.total).toBeGreaterThan(0);
  });

  it("难度名按难度标签推导", () => {
    expect(difficultyLabel({ tags: ["t-df1"] })).toBe("基础");
    expect(difficultyLabel({ tags: ["t-df2"] })).toBe("中等");
    expect(difficultyLabel({ tags: ["t-df3"] })).toBe("较难");
    expect(difficultyLabel({ tags: [] })).toBe("中等");
  });

  it("主标签优先取领域，其次知识点", () => {
    expect(primaryTagName({ tags: ["t-pt-limit", "t-dom-calc"] })).toBe("高等数学");
    expect(primaryTagName({ tags: ["t-pt-limit"] })).toBe("极限与连续");
  });

  it("标签匹配为任一命中（OR 语义）", () => {
    expect(matchTags({ tags: ["t-dom-calc"] }, ["t-dom-net", "t-dom-calc"])).toBe(true);
    expect(matchTags({ tags: ["t-dom-calc"] }, ["t-dom-net"])).toBe(false);
    expect(matchTags({ tags: ["t-dom-calc"] }, [])).toBe(true);
  });
});

describe("catalog · 题目状态", () => {
  it("不支持的题目状态被拒绝", () => {
    const result = setQuestionStatus("q-m-01", "archived" as never);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("不支持的题目状态");
  });

  it("仅草稿可丢弃", () => {
    const published = state().questions.find((q) => q.status === "published")!;
    // 已发布题目不可丢弃。
    const outcome = discardQuestion(published.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe("仅草稿状态的题目可以丢弃");
  });

  it("草稿题可以丢弃", () => {
    const draft = state().questions.find((q) => q.status === "draft");
    if (!draft) return;
    const outcome = discardQuestion(draft.id);
    expect(outcome.ok).toBe(true);
    expect(state().questions.find((q) => q.id === draft.id)).toBeUndefined();
  });

  it("批量设置状态返回变更数", () => {
    const drafts = state().questions.filter((q) => q.status === "draft").map((q) => q.id);
    expect(drafts.length).toBeGreaterThan(0);
    const result = setQuestionsStatus(drafts.slice(0, 2), "published");
    expect(result.changed).toBe(2);
    expect(result.failed).toBe(0);
  });
});

describe("catalog · 名单与可见性", () => {
  it("空名单范围表示全员开放", () => {
    expect(isInScope([], "2023120101")).toBe(true);
    expect(scopeStudents([]).length).toBe(state().students.length);
  });

  it("非空名单范围只含该组学生", () => {
    const scoped = scopeStudents(["c2301"]);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((s) => s.classId === "c2301")).toBe(true);
  });

  it("学员看不到草稿试卷", () => {
    const draft = state().exams.find((e) => e.status === "draft");
    if (draft) {
      expect(studentExam(draft.id, "2023120101")).toBeNull();
    }
    for (const exam of studentExams("2023120101")) {
      expect(exam.status).not.toBe("draft");
      expect(exam.published).toBe(true);
    }
  });

  it("学员拿到的试卷只含已发布题目", () => {
    const exam = state().exams.find((e) => e.status === "ongoing")!;
    const visible = studentExam(exam.id, "2023120101")!;
    expect(visible).not.toBeNull();
    for (const qid of visible.questionIds) {
      expect(publishedQuestionIds([qid])).toContain(qid);
    }
  });

  it("学员看不到未上架的练习", () => {
    for (const practice of studentPractices("2023120101")) {
      expect(practice.status).toBe("published");
      expect(practice.published).toBe(true);
    }
    const draft = state().practices.find((p) => p.status === "draft");
    if (draft) expect(studentPractice(draft.id, "2023120101")).toBeNull();
  });
});

describe("catalog · 发布前校验", () => {
  it("对不存在的对象判定为不通过", () => {
    const result = preflight("exam", "不存在的试卷");
    expect(result.ok).toBe(false);
    expect(result.checks[0]?.key).toBe("exist");
  });

  it("校验项覆盖题量、发布状态、总分、重复、占比、时长、标签、名单", () => {
    const exam = state().exams.find((e) => e.status === "ongoing")!;
    const result = preflight("exam", exam.id);
    const keys = result.checks.map((c) => c.key);
    for (const key of ["exist", "count", "published", "score", "dup", "mix", "duration", "tags", "roster"]) {
      expect(keys, `缺少校验项 ${key}`).toContain(key);
    }
    expect(result.total).toBe(result.checks.length);
  });

  it("练习卷不校验名单组", () => {
    const practice = state().practices.find((p) => p.status === "published")!;
    const result = preflight("practice", practice.id);
    expect(result.checks.some((c) => c.key === "open")).toBe(true);
    expect(result.checks.some((c) => c.key === "roster")).toBe(false);
  });
});

describe("catalog · 题库统计与阅卷", () => {
  it("题库统计只把已发布题计入客观/主观与分值", () => {
    const stats = bankStats("__all__");
    expect(stats.total).toBe(state().questions.length);
    expect(stats.published + stats.draft + stats.disabled).toBe(stats.total);
    expect(stats.objective + stats.subjective).toBe(stats.published);
  });

  it("阅卷记录可写入、更新，重复 id 只补齐作答文本", () => {
    const id = "rv-test-1";
    const first = addReview({
      id,
      examId: "exam-math-final",
      studentId: "2023120101",
      qid: "q-m-07",
      stepId: null,
      attempt: 1,
      answerText: "作答内容",
      submittedAt: "2026-11-12 10:00",
    });
    expect(first.ok).toBe(true);

    const second = addReview({
      id,
      examId: "exam-math-final",
      studentId: "2023120101",
      qid: "q-m-07",
      stepId: null,
      attempt: 1,
      answerText: "补充内容",
      submittedAt: "2026-11-12 10:00",
    });
    expect(second.ok).toBe(true);
    expect(state().reviews.filter((r) => r.id === id).length).toBe(1);

    const updated = updateReview(id, { teacherScore: 6, comment: "尚可", status: "reviewed" });
    expect(updated.ok).toBe(true);
    const record = state().reviews.find((r) => r.id === id);
    expect(record?.teacherScore).toBe(6);
    expect(record?.status).toBe("reviewed");
  });

  it("阅卷记录不存在时明确报错", () => {
    const result = updateReview("rv-不存在", { teacherScore: 1 });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("阅卷记录不存在");
  });

  it("卷条目缺省时由题目分值兜底", () => {
    const items = itemsOf({ questionIds: ["q-m-01"] });
    expect(items).toHaveLength(1);
    expect(items[0]?.score).toBeGreaterThan(0);
  });
});
