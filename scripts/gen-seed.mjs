/**
 * 生成 frontend/shared/src/mock/seed.ts。
 *
 * 做法：直接在 Node 里**求值**原型的 docs/ui-design/shared/js/seed.js，
 * 再把得到的纯数据序列化为 TypeScript。这样中文题干、选项、解析、
 * 评分要点与步骤文本逐字保留，不会因人工转写而失真。
 *
 * 用法：node scripts/gen-seed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const src = fs.readFileSync(
  "../../docs/ui-design/shared/js/seed.js",
  "utf8",
);
const window = {};
new Function("window", src)(window);
const seed = window.EX.seed;

/* ---------- 归一化 ---------- */
const GROUP_BY_LABEL = { 领域: "domain", 知识点: "knowledge_point", 能力: "ability", 难度: "difficulty" };
const LABEL_BY_GROUP = { domain: "领域", knowledge_point: "知识点", ability: "能力", difficulty: "难度" };
const DIFFICULTY_LEVEL = { 基础: 1, 中等: 2, 较难: 3 };

const classIdByName = {};
for (const c of seed.classes) classIdByName[c.name] = c.id;

const tags = seed.TAGS.map((t) => {
  const tag = { id: t.id, name: t.name, group: GROUP_BY_LABEL[t.group] ?? "domain" };
  if (t.group === "难度") tag.level = t.level ?? DIFFICULTY_LEVEL[t.name] ?? 2;
  return tag;
});

const questions = seed.questions.map((q) => {
  const out = {
    id: q.id,
    type: q.type,
    score: q.score,
    status: q.status ?? "published",
    source: q.source ?? "manual",
    tags: q.tags ?? [],
    stem: q.stem,
    answer: q.answer ?? [],
    analysis: q.analysis ?? "",
  };
  if (q.options) out.options = q.options;
  if (q.reference) out.reference = q.reference;
  if (q.keypoints) out.keypoints = q.keypoints;
  if (q.steps) out.steps = q.steps;
  if (q.figure) out.figure = q.figure;
  if (q.batchId) out.batchId = q.batchId;
  return out;
});

const banks = seed.banks.map((b) => ({
  id: b.id, name: b.name, desc: b.desc ?? "", tags: b.tags ?? [], questionIds: b.questionIds ?? [],
}));

const classes = seed.classes.map((c) => ({ id: c.id, name: c.name }));
const students = seed.students.map((s) => ({
  id: s.id, name: s.name, classId: classIdByName[s.className] ?? "c2301", enrollYear: s.enrollYear,
}));

const PUBLISH_ANSWER = { after_close: "after_close", after_submit: "after_submit", immediately: "on_open", on_open: "on_open" };

const exams = seed.exams.map((e) => ({
  id: e.id, name: e.name, batch: e.batch ?? "", tags: e.tags ?? [],
  durationMin: e.durationMin ?? 60, totalScore: e.totalScore ?? 100, passScore: e.passScore ?? 60,
  openAt: e.openAt ?? "", closeAt: e.closeAt ?? "",
  status: e.status ?? "draft", published: e.published ?? false,
  allowRetake: e.allowRetake ?? false,
  publishAnswer: PUBLISH_ANSWER[e.publishAnswer] ?? "after_close",
  scope: e.scope ?? [], questionIds: e.questionIds ?? [], items: e.items ?? [],
  orderRule: e.orderRule ?? "type", plum: e.plum ?? { mode: "standard" }, note: e.note ?? "",
}));

const practices = seed.practices.map((p) => {
  const items = p.items ?? (p.questionIds ?? []).map((qid) => ({ qid, score: 10 }));
  return {
    id: p.id, name: p.name, tags: p.tags ?? [],
    questionIds: p.questionIds ?? [], items,
    durationMin: p.durationMin ?? 30,
    totalScore: p.totalScore ?? items.reduce((s, i) => s + i.score, 0),
    status: p.status ?? "draft", published: p.published ?? (p.status === "published"),
    scope: p.scope ?? [], repeats: p.repeats ?? 0,
    feedback: p.feedback ?? "after_submit", mistakeReflow: p.mistakeReflow ?? true,
    orderRule: p.orderRule ?? "type", note: p.note ?? "",
  };
});

const records = seed.records.map((r) => ({
  examId: r.examId, studentId: r.studentId, name: r.name, date: r.date,
  score: r.score, total: r.total, status: r.status ?? "done",
}));

const mistakes = seed.mistakes.map((m) => ({
  qid: m.qid, studentId: m.studentId, wrongCount: m.wrongCount,
  lastWrongAt: m.lastWrongAt, reason: m.reason,
}));

const imports = (seed.imports ?? []).map((b) => ({
  id: b.id, fileName: b.fileName, operator: b.operator, createdAt: b.createdAt,
  status: b.status ?? "parsed", rowCount: b.rowCount ?? 0,
  columns: b.columns ?? [], mapping: b.mapping ?? {}, rows: b.rows ?? [],
  ...(b.adoptedAt ? { adoptedAt: b.adoptedAt } : {}),
  ...(b.adoptedCount != null ? { adoptedCount: b.adoptedCount } : {}),
}));

const generations = (seed.generations ?? []).map((b) => ({
  id: b.id, operator: b.operator, createdAt: b.createdAt, status: b.status ?? "generated",
  count: b.count ?? 0, type: b.type ?? "single", difficulty: b.difficulty ?? "中等",
  prompt: b.prompt ?? "", tagIds: b.tagIds ?? [], rows: b.rows ?? [],
  ...(b.adoptedAt ? { adoptedAt: b.adoptedAt } : {}),
  ...(b.adoptedCount != null ? { adoptedCount: b.adoptedCount } : {}),
}));

const paperTemplates = (seed.paperTemplates ?? []).map((t) => ({
  id: t.id, name: t.name, kind: t.kind ?? "exam", mode: t.mode ?? "standard",
  durationMin: t.durationMin ?? 60, passScore: t.passScore ?? 60, items: t.items ?? [],
}));

const reviewQueue = seed.buildReviewQueue().map((r) => ({
  id: r.id, examId: r.examId, studentId: r.studentId, qid: r.qid,
  stepId: r.stepId ?? null, attempt: r.attempt ?? 1, answerText: r.answerText ?? "",
  submittedAt: r.submittedAt ?? "", status: r.status ?? "pending",
  teacherScore: r.teacherScore ?? null, comment: r.comment ?? "",
}));

/* ---------- 生成 TypeScript ---------- */
const J = (value, indent = 0) => JSON.stringify(value, null, 2).split("\n").map((line, i) => (i === 0 ? line : " ".repeat(indent) + line)).join("\n");

const out = `/* ==========================================================================
   知行测评 · 示例数据层
   --------------------------------------------------------------------------
   由 docs/ui-design/shared/js/seed.js **求值后转写**而来，
   中文题干、选项、解析、要点与步骤文本逐字保留，未作任何改写。

   与原型的口径差异（均为字段名对齐，不改语义）：
   1. 标签分组用英文枚举（domain / knowledge_point / ability / difficulty），
      中文名见 TAG_GROUP_LABEL；
   2. 学生用 classId 指向名单组，不再直接存名单组名；
   3. 试卷补齐 passScore 与 orderRule 默认值；
   4. 练习补齐 orderRule / published / totalScore 默认值。

   生成脚本见 scripts/gen-seed.mjs（仓库内可复跑）。
   ========================================================================== */

import type {
  Bank,
  ClassGroup,
  ExamPaper,
  GenerationBatch,
  ImportBatch,
  Mistake,
  PaperTemplate,
  Practice,
  Question,
  QuestionSource,
  QuestionStatus,
  QuestionType,
  ReviewItem,
  ScoreRecord,
  Student,
  Tag,
  TagGroup,
} from "../domain/types";

/** 标签分组：中文名 → 英文枚举。 */
export const TAG_GROUP_BY_LABEL: Record<string, TagGroup> = ${J(GROUP_BY_LABEL)};

/** 标签分组：英文枚举 → 中文名。 */
export const TAG_GROUP_LABEL: Record<TagGroup, string> = ${J(LABEL_BY_GROUP)};

/** 单个对象最多可挂载的标签数。 */
export const MAX_TAGS = ${seed.MAX_TAGS};

/** 题型定义。 */
export const QUESTION_TYPES: ReadonlyArray<{ id: QuestionType; label: string }> = ${J(seed.QUESTION_TYPES)};

/** 题型中文名。 */
export const TYPE_LABEL: Record<QuestionType, string> = ${J(seed.TYPE_LABEL)};

/** 题目状态中文名。 */
export const STATUS_LABEL: Record<QuestionStatus, string> = ${J(seed.STATUS_LABEL)};

/** 题目来源中文名。 */
export const SOURCE_LABEL: Record<QuestionSource, string> = ${J({ manual: "手工录入", import: "批量导入", ai: "AI 生成" })};

/* ==========================================================================
   标签
   ========================================================================== */

export const TAGS: Tag[] = ${J(tags)};

/* ==========================================================================
   题目
   ========================================================================== */

export const questions: Question[] = ${J(questions)};

/* ==========================================================================
   题库
   ========================================================================== */

export const banks: Bank[] = ${J(banks)};

/* ==========================================================================
   名单组与学生
   ========================================================================== */

export const classes: ClassGroup[] = ${J(classes)};

export const students: Student[] = ${J(students)};

/* ==========================================================================
   试卷
   ========================================================================== */

export const exams: ExamPaper[] = ${J(exams)};

/* ==========================================================================
   练习
   ========================================================================== */

export const practices: Practice[] = ${J(practices)};

/* ==========================================================================
   历史成绩与错题
   ========================================================================== */

export const records: ScoreRecord[] = ${J(records)};

export const mistakes: Mistake[] = ${J(mistakes)};

/* ==========================================================================
   导入与生成批次
   ========================================================================== */

export const imports: ImportBatch[] = ${J(imports)};

export const generations: GenerationBatch[] = ${J(generations)};

/* ==========================================================================
   卷型模板
   ========================================================================== */

export const paperTemplates: PaperTemplate[] = ${J(paperTemplates)};

/* ==========================================================================
   阅卷队列
   ========================================================================== */

/**
 * 构造待阅卷宗队列。
 *
 * 原型在 seed 载入时构造；这里改为函数，便于测试中按需重建。
 */
export function buildReviewQueue(): ReviewItem[] {
  return ${J(reviewQueue)};
}

/* ==========================================================================
   汇总出口
   ========================================================================== */

export const SEED = {
  TAG_GROUPS: ${J(seed.TAG_GROUPS)},
  MAX_TAGS,
  TAGS,
  QUESTION_TYPES,
  TYPE_LABEL,
  STATUS_LABEL,
  SOURCE_LABEL,
  questions,
  banks,
  students,
  classes,
  exams,
  practices,
  records,
  mistakes,
  imports,
  generations,
  paperTemplates,
  buildReviewQueue,
} as const;

/* ==========================================================================
   便捷查询
   ========================================================================== */

export function getQuestion(id: string): Question | undefined {
  return questions.find((q) => q.id === id);
}

export function getTag(id: string): Tag | undefined {
  return TAGS.find((t) => t.id === id);
}

export function getBank(id: string): Bank | undefined {
  return banks.find((b) => b.id === id);
}

export function getStudent(id: string): Student | undefined {
  return students.find((s) => s.id === id);
}

export function getExam(id: string): ExamPaper | undefined {
  return exams.find((e) => e.id === id);
}

export function getPractice(id: string): Practice | undefined {
  return practices.find((p) => p.id === id);
}

export function typeLabel(type: QuestionType): string {
  return TYPE_LABEL[type] ?? type;
}
`;

fs.writeFileSync("../../frontend/shared/src/mock/seed.ts", out);
console.log("已生成 ../../frontend/shared/src/mock/seed.ts", out.length, "字节");
