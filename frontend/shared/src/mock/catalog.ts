/* ==========================================================================
   知行测评 · 内容仓库（Catalog）
   --------------------------------------------------------------------------
   对齐原型 shared/js/catalog.js 的全部能力，但用 Zustand 承载，
   让两个 SPA 共享同一份响应式状态。

   设计要点：
   1. **状态即单一事实源**。管理端写入 → 答题端读到的就是同一份对象。
   2. 标签挂载上限 5 个，校验文案与原型逐字一致。
   3. 卷面配分（items）是成绩口径的唯一来源。
   4. 学员可见性由「发布状态 + 名单范围」共同决定。
   ========================================================================== */

import { create } from "zustand";
import type {
  Bank,
  ClassGroup,
  DifficultyLevel,
  ExamPaper,
  GenerationBatch,
  ImportBatch,
  ImportRow,
  Mistake,
  PaperItem,
  PaperTemplate,
  Practice,
  Question,
  QuestionOption,
  QuestionStatus,
  QuestionType,
  ReviewItem,
  ScoreRecord,
  Student,
  Tag,
  TagGroup,
} from "../domain/types";
import { SEED, buildReviewQueue, getExam as seedExam, getPractice as seedPractice } from "./seed";

/** 标签分组中文名（与原型一致，用于展示）。 */
export const TAG_GROUP_LABEL: Record<TagGroup, string> = {
  domain: "领域",
  knowledge_point: "知识点",
  ability: "能力",
  difficulty: "难度",
};

/** 标签分组展示顺序。 */
export const TAG_GROUP_ORDER: TagGroup[] = ["domain", "knowledge_point", "ability", "difficulty"];

/** 题目状态中文名。 */
export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  draft: "草稿",
  published: "已发布",
  disabled: "已停用",
};

/** 题目来源中文名。 */
export const QUESTION_SOURCE_LABEL: Record<Question["source"], string> = {
  manual: "手工录入",
  import: "批量导入",
  ai: "AI 生成",
};

/** 难度中文名。 */
export const DIFFICULTY_LABEL: Record<DifficultyLevel, string> = {
  1: "基础",
  2: "中等",
  3: "较难",
};

/** 最多可挂载的标签数。 */
export const MAX_TAGS = 5;

/** 内容仓库状态。 */
export interface CatalogState {
  tags: Tag[];
  questions: Question[];
  banks: Bank[];
  exams: ExamPaper[];
  practices: Practice[];
  reviews: ReviewItem[];
  imports: ImportBatch[];
  generations: GenerationBatch[];
  paperTemplates: PaperTemplate[];
  students: Student[];
  classes: ClassGroup[];
  records: ScoreRecord[];
  mistakes: Mistake[];
  /** 考生作答记录（学生端写入，管理端读取用于监考与阅卷）。 */
  attempts: Record<string, ExamAttempt>;
  /** 练习成绩：practiceId:studentId → 成绩摘要。 */
  practiceResults: Record<string, PracticeResult>;
  /** 卷型覆盖配置：examId → { mode }。 */
  plumCfg: Record<string, { mode: PaperPaperMode }>;
}

/** 卷型。 */
export type PaperPaperMode = "standard" | "small" | "large";

/** 考生作答记录。 */
export interface ExamAttempt {
  examId: string;
  studentId: string;
  submittedAt: string;
  responses: Responses;
  score: number;
  total: number;
  pendingSubjective: boolean;
  variantLabel: string;
  attemptNo: number;
  attempts: number;
}

/** 练习成绩摘要。 */
export interface PracticeResult {
  practiceId: string;
  studentId: string;
  /** 得分。 */
  score: number;
  /** 满分。 */
  total: number;
  /** 已提交次数。 */
  attempts: number;
  /** 最近提交时间（ISO）。 */
  submittedAt: string;
}

/** 作答内容。choice 存**卷面显示字母**。 */
export interface Responses {
  [qid: string]: {
    choice?: string[];
    text?: string;
    steps?: Record<string, string>;
  };
}

/** 标签校验结果。 */
export interface TagValidation {
  ok: boolean;
  ids: string[];
  message?: string | undefined;
}

/** 发布前校验的单项结果。 */
export interface PreflightCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** 发布前校验结果。 */
export interface PreflightResult {
  ok: boolean;
  kind: "exam" | "practice";
  id: string;
  checks: PreflightCheck[];
  failed: number;
  total: number;
}

/** 题库统计。 */
export interface BankStats {
  total: number;
  published: number;
  draft: number;
  disabled: number;
  objective: number;
  subjective: number;
  score: number;
}

/** 标签使用统计。 */
export interface TagUsage {
  questions: number;
  banks: number;
  exams: number;
  practices: number;
  total: number;
}

const initialState = (): CatalogState => ({
  tags: SEED.TAGS.map((t) => ({ ...t })),
  questions: SEED.questions.map((q) => ({ ...q })),
  banks: SEED.banks.map((b) => ({ ...b })),
  exams: SEED.exams.map((e) => ({ ...e })),
  practices: SEED.practices.map((p) => ({ ...p })),
  reviews: buildReviewQueue(),
  imports: SEED.imports.map((i) => ({ ...i })),
  generations: SEED.generations.map((g) => ({ ...g })),
  paperTemplates: SEED.paperTemplates.map((t) => ({ ...t })),
  students: SEED.students.map((s) => ({ ...s })),
  classes: SEED.classes.map((c) => ({ ...c })),
  records: SEED.records.map((r) => ({ ...r })),
  mistakes: SEED.mistakes.map((m) => ({ ...m })),
  attempts: {},
  practiceResults: {},
  plumCfg: {},
});

/** 内容仓库 store。 */
export const useCatalog = create<CatalogState>(() => initialState());

/* ==========================================================================
   读取器
   ========================================================================== */

/** 取标签。 */
export function getTag(id: string): Tag | undefined {
  return useCatalog.getState().tags.find((t) => t.id === id);
}

/** 取标签名。 */
export function tagName(id: string): string {
  return getTag(id)?.name ?? id;
}

/** 取多个标签名。 */
export function tagNames(ids: readonly string[]): string[] {
  return ids.map(tagName);
}

/** 按分组取标签。 */
export function tagsOfGroup(group: TagGroup): Tag[] {
  return useCatalog.getState().tags.filter((t) => t.group === group);
}

/** 取题目。 */
export function getQuestion(id: string): Question | undefined {
  return useCatalog.getState().questions.find((q) => q.id === id);
}

/** 取题库。 */
export function getBank(id: string): Bank | undefined {
  return useCatalog.getState().banks.find((b) => b.id === id);
}

/** 取试卷。 */
export function getExam(id: string): ExamPaper | undefined {
  return useCatalog.getState().exams.find((e) => e.id === id);
}

/** 取练习。 */
export function getPractice(id: string): Practice | undefined {
  return useCatalog.getState().practices.find((p) => p.id === id);
}

/** 取学生。 */
export function getStudent(id: string): Student | undefined {
  return useCatalog.getState().students.find((s) => s.id === id);
}

/** 取名单组名。 */
export function className(id: string): string {
  return useCatalog.getState().classes.find((c) => c.id === id)?.name ?? "未分班";
}

/** 难度等级表：标签 ID → level。 */
export function difficultyLevels(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tag of useCatalog.getState().tags) {
    if (tag.group === "difficulty" && tag.level) out[tag.id] = tag.level;
  }
  return out;
}

/** 取实体的难度等级（缺省中等）。 */
export function difficultyOf(entity: { tags: string[] }): number {
  const levels = difficultyLevels();
  for (const tagId of entity.tags) {
    const level = levels[tagId];
    if (level) return level;
  }
  return 2;
}

/** 取实体的难度中文名。 */
export function difficultyLabel(entity: { tags: string[] }): string {
  return DIFFICULTY_LABEL[(difficultyOf(entity) as DifficultyLevel) ?? 2];
}

/** 取实体的主标签：优先领域，其次知识点，都没有取第一个。 */
export function primaryTagId(entity: { tags: string[] }): string | undefined {
  const tags = useCatalog.getState().tags;
  for (const group of ["domain", "knowledge_point"] as TagGroup[]) {
    const hit = entity.tags.find((id) => tags.find((t) => t.id === id)?.group === group);
    if (hit) return hit;
  }
  return entity.tags[0];
}

/** 取实体的主标签名。 */
export function primaryTagName(entity: { tags: string[] }): string {
  const id = primaryTagId(entity);
  return id ? tagName(id) : "";
}

/** 标签使用统计。 */
export function usageOf(tagId: string): TagUsage {
  const state = useCatalog.getState();
  const questions = state.questions.filter((q) => q.tags.includes(tagId)).length;
  const banks = state.banks.filter((b) => b.tags.includes(tagId)).length;
  const exams = state.exams.filter((e) => e.tags.includes(tagId)).length;
  const practices = state.practices.filter((p) => p.tags.includes(tagId)).length;
  return { questions, banks, exams, practices, total: questions + banks + exams + practices };
}

/** 标签匹配：任一命中即匹配（OR 语义）。 */
export function matchTags(entity: { tags: string[] }, ids: readonly string[]): boolean {
  if (ids.length === 0) return true;
  return entity.tags.some((tagId) => ids.includes(tagId));
}

/* ==========================================================================
   标签
   ========================================================================== */

/** 校验标签选择。 */
export function validateTags(ids: readonly string[]): TagValidation {
  if (ids.length > MAX_TAGS) {
    return { ok: false, ids: [], message: `最多只能选择 ${MAX_TAGS} 个标签，当前已选 ${ids.length} 个` };
  }
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    return { ok: false, ids: [], message: "标签不可重复选择" };
  }
  const known = new Set(useCatalog.getState().tags.map((t) => t.id));
  if (unique.some((id) => !known.has(id))) {
    return { ok: false, ids: [], message: "存在无效标签，请重新选择" };
  }
  return { ok: true, ids: unique };
}

/** 新建标签。 */
export function createTag(input: { name: string; group: TagGroup }): { ok: boolean; message?: string | undefined; tag?: Tag } {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "请填写标签名称" };
  if (!TAG_GROUP_ORDER.includes(input.group)) return { ok: false, message: "请选择有效的标签分组" };

  const state = useCatalog.getState();
  if (state.tags.some((t) => t.group === input.group && t.name === name)) {
    return { ok: false, message: "同一分组内已存在同名标签" };
  }

  const id = `t-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const tag: Tag = { id, name, group: input.group };
  if (input.group === "difficulty") {
    const level = (Object.keys(DIFFICULTY_LABEL) as unknown as DifficultyLevel[]).find(
      (l) => DIFFICULTY_LABEL[l] === name,
    );
    if (level) tag.level = level;
  }
  useCatalog.setState({ tags: [...state.tags, tag] });
  return { ok: true, tag };
}

/** 更新标签。 */
export function updateTag(
  id: string,
  patch: { name?: string; group?: TagGroup },
): { ok: boolean; message?: string } {
  const name = patch.name?.trim();
  if (name === undefined || !name) return { ok: false, message: "请填写标签名称" };

  const state = useCatalog.getState();
  const target = state.tags.find((t) => t.id === id);
  if (!target) return { ok: false, message: "存在无效标签，请重新选择" };

  const group = patch.group ?? target.group;
  if (!TAG_GROUP_ORDER.includes(group)) return { ok: false, message: "请选择有效的标签分组" };

  if (state.tags.some((t) => t.id !== id && t.group === group && t.name === name)) {
    return { ok: false, message: "同一分组内已存在同名标签" };
  }

  const next: Tag = { ...target, name, group };
  if (group !== "difficulty") {
    delete next.level;
  } else if (!next.level) {
    const level = (Object.keys(DIFFICULTY_LABEL) as unknown as DifficultyLevel[]).find(
      (l) => DIFFICULTY_LABEL[l] === name,
    );
    if (level) next.level = level;
  }

  useCatalog.setState({
    tags: state.tags.map((t) => (t.id === id ? next : t)),
  });
  return { ok: true };
}

/** 删除标签并级联解除挂载。 */
export function removeTag(id: string): { ok: boolean; usage?: TagUsage; message?: string } {
  const state = useCatalog.getState();
  if (!state.tags.some((t) => t.id === id)) {
    return { ok: false, message: "存在无效标签，请重新选择" };
  }
  const usage = usageOf(id);
  const strip = (tags: string[]) => tags.filter((t) => t !== id);

  useCatalog.setState({
    tags: state.tags.filter((t) => t.id !== id),
    questions: state.questions.map((q) => (q.tags.includes(id) ? { ...q, tags: strip(q.tags) } : q)),
    banks: state.banks.map((b) => (b.tags.includes(id) ? { ...b, tags: strip(b.tags) } : b)),
    exams: state.exams.map((e) => (e.tags.includes(id) ? { ...e, tags: strip(e.tags) } : e)),
    practices: state.practices.map((p) => (p.tags.includes(id) ? { ...p, tags: strip(p.tags) } : p)),
  });
  return { ok: true, usage };
}

/* ==========================================================================
   题目
   ========================================================================== */

/** 题目状态是否合法。 */
export function isValidQuestionStatus(status: string): status is QuestionStatus {
  return status === "draft" || status === "published" || status === "disabled";
}

/**
 * 新增或更新题目。
 *
 * 互斥规则：客观题删 keypoints/steps；简答保留 keypoints 删 steps；
 * 综合题保留 steps 删 keypoints。
 */
export function upsertQuestion(input: Partial<Question> & { stem: string }): {
  ok: boolean;
  message?: string | undefined;
  question?: Question;
} {
  const stem = input.stem.trim();
  if (!stem) return { ok: false, message: "请填写题干" };

  const tagIds = input.tags ?? [];
  const validation = validateTags(tagIds);
  if (!validation.ok) return { ok: false, message: validation.message };

  const state = useCatalog.getState();
  const existing = input.id ? state.questions.find((q) => q.id === input.id) : undefined;

  const type: QuestionType = input.type ?? existing?.type ?? "single";
  const question: Question = {
    id: existing?.id ?? `q-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    score: Math.max(1, Number(input.score ?? existing?.score ?? 5) || 5),
    status: existing?.status ?? "draft",
    source: input.source ?? existing?.source ?? "manual",
    tags: validation.ids,
    stem,
    answer: input.answer ?? existing?.answer ?? [],
    analysis: input.analysis ?? existing?.analysis ?? "",
  };

  // 可选字段缺省不写入（exactOptionalPropertyTypes 下不能显式赋 undefined）。
  const options = input.options ?? existing?.options;
  if (options) question.options = options;
  const reference = input.reference ?? existing?.reference;
  if (reference) question.reference = reference;
  const keypoints = input.keypoints ?? existing?.keypoints;
  if (keypoints) question.keypoints = keypoints;
  const steps = input.steps ?? existing?.steps;
  if (steps) question.steps = steps;
  const figure = input.figure ?? existing?.figure;
  if (figure) question.figure = figure;
  const batchId = input.batchId ?? existing?.batchId;
  if (batchId) question.batchId = batchId;

  // 题型互斥。
  if (type === "single" || type === "multi" || type === "judge") {
    delete question.keypoints;
    delete question.steps;
  } else if (type === "short") {
    delete question.steps;
  } else {
    delete question.keypoints;
  }

  useCatalog.setState({
    questions: existing
      ? state.questions.map((q) => (q.id === question.id ? question : q))
      : [...state.questions, question],
  });
  return { ok: true, question };
}

/** 删除题目，级联从题库 / 试卷 / 练习中移除。 */
export function removeQuestion(id: string): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  if (!state.questions.some((q) => q.id === id)) {
    return { ok: false, message: "题目不存在" };
  }
  useCatalog.setState({
    questions: state.questions.filter((q) => q.id !== id),
    banks: state.banks.map((b) => ({
      ...b,
      questionIds: b.questionIds.filter((qid) => qid !== id),
    })),
    exams: state.exams.map((e) => ({
      ...e,
      questionIds: e.questionIds.filter((qid) => qid !== id),
      items: e.items.filter((i) => i.qid !== id),
    })),
    practices: state.practices.map((p) => ({
      ...p,
      questionIds: p.questionIds.filter((qid) => qid !== id),
      items: p.items.filter((i) => i.qid !== id),
    })),
  });
  return { ok: true };
}

/** 丢弃候选题：仅草稿可丢弃。 */
export function discardQuestion(id: string): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  const question = state.questions.find((q) => q.id === id);
  if (!question) return { ok: false, message: "题目不存在" };
  if (question.status !== "draft") {
    return { ok: false, message: "仅草稿状态的题目可以丢弃" };
  }
  return removeQuestion(id);
}

/** 设置题目状态。 */
export function setQuestionStatus(
  id: string,
  status: QuestionStatus,
): { ok: boolean; changed: boolean; message?: string } {
  if (!isValidQuestionStatus(status)) {
    return { ok: false, changed: false, message: "不支持的题目状态" };
  }
  const state = useCatalog.getState();
  const question = state.questions.find((q) => q.id === id);
  if (!question) return { ok: false, changed: false, message: "题目不存在" };
  if (question.status === status) return { ok: true, changed: false };
  useCatalog.setState({
    questions: state.questions.map((q) =>
      q.id === id ? { ...q, status, publishedAt: undefined } : q,
    ),
  });
  return { ok: true, changed: true };
}

/** 批量设置题目状态。 */
export function setQuestionsStatus(
  ids: readonly string[],
  status: QuestionStatus,
): { ok: boolean; changed: number; failed: number } {
  let changed = 0;
  let failed = 0;
  for (const id of ids) {
    const result = setQuestionStatus(id, status);
    if (!result.ok) failed += 1;
    else if (result.changed) changed += 1;
  }
  return { ok: failed === 0, changed, failed };
}

/** 只保留已发布题目。 */
export function publishedQuestionIds(ids: readonly string[]): string[] {
  return ids.filter((id) => getQuestion(id)?.status === "published");
}

/** 按状态取题目。 */
export function questionsByStatus(status: QuestionStatus): Question[] {
  return useCatalog.getState().questions.filter((q) => q.status === status);
}

/** 取题库中的题目。bankId 为空或 "__all__" 返回全量。 */
export function questionsOfBank(bankId: string): Question[] {
  const state = useCatalog.getState();
  if (!bankId || bankId === "__all__") return state.questions;
  const bank = getBank(bankId);
  if (!bank) return [];
  return bank.questionIds
    .map((qid) => state.questions.find((q) => q.id === qid))
    .filter((q): q is Question => Boolean(q));
}

/** 取草稿候选题。 */
export function candidatesOf(bankId: string): Question[] {
  return questionsOfBank(bankId).filter((q) => q.status === "draft");
}

/** 题库统计。客观 / 主观 / 总分只统计已发布题。 */
export function bankStats(bankId: string): BankStats {
  const questions = questionsOfBank(bankId);
  const published = questions.filter((q) => q.status === "published");
  return {
    total: questions.length,
    published: published.length,
    draft: questions.filter((q) => q.status === "draft").length,
    disabled: questions.filter((q) => q.status === "disabled").length,
    objective: published.filter((q) => q.type !== "short" && q.type !== "comprehensive").length,
    subjective: published.filter((q) => q.type === "short" || q.type === "comprehensive").length,
    score: published.reduce((sum, q) => sum + q.score, 0),
  };
}

/* ==========================================================================
   题库
   ========================================================================== */

/** 新增或更新题库。 */
export function upsertBank(input: Partial<Bank> & { name: string }): {
  ok: boolean;
  message?: string | undefined;
  bank?: Bank;
} {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "请填写题库名称" };

  const state = useCatalog.getState();
  const existing = input.id ? state.banks.find((b) => b.id === input.id) : undefined;
  const known = new Set(state.questions.map((q) => q.id));

  const bank: Bank = {
    id: existing?.id ?? `bank-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    desc: input.desc ?? existing?.desc ?? "",
    tags: input.tags ?? existing?.tags ?? [],
    questionIds: (input.questionIds ?? existing?.questionIds ?? []).filter((qid) => known.has(qid)),
  };

  useCatalog.setState({
    banks: existing
      ? state.banks.map((b) => (b.id === bank.id ? bank : b))
      : [...state.banks, bank],
  });
  return { ok: true, bank };
}

/** 删除题库（不级联删题）。 */
export function removeBank(id: string): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  if (!state.banks.some((b) => b.id === id)) {
    return { ok: false, message: "题库不存在" };
  }
  useCatalog.setState({ banks: state.banks.filter((b) => b.id !== id) });
  return { ok: true };
}

/* ==========================================================================
   卷面条目与配分
   ========================================================================== */

/** 取卷面条目：优先 items，否则由 questionIds 兜底。 */
export function itemsOf(paper: { items?: PaperItem[]; questionIds?: string[] }): PaperItem[] {
  if (paper.items && paper.items.length > 0) return paper.items;
  return (paper.questionIds ?? []).map((qid) => ({
    qid,
    score: getQuestion(qid)?.score || 5,
  }));
}

/** 写回卷面条目（同时写 items 与 questionIds）。 */
export function setPaperItems(
  kind: "exam" | "practice",
  id: string,
  items: PaperItem[],
): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  const normalized = items.map((item) => ({
    qid: item.qid,
    score: Math.max(0, Number(item.score) || 0),
  }));

  if (kind === "exam") {
    const exam = state.exams.find((e) => e.id === id);
    if (!exam) return { ok: false, message: "试卷不存在" };
    useCatalog.setState({
      exams: state.exams.map((e) =>
        e.id === id
          ? { ...e, items: normalized, questionIds: normalized.map((i) => i.qid) }
          : e,
      ),
    });
    return { ok: true };
  }

  const practice = state.practices.find((p) => p.id === id);
  if (!practice) return { ok: false, message: "练习不存在" };
  useCatalog.setState({
    practices: state.practices.map((p) =>
      p.id === id
        ? {
            ...p,
            items: normalized,
            questionIds: normalized.map((i) => i.qid),
            totalScore: normalized.reduce((sum, i) => sum + i.score, 0),
          }
        : p,
    ),
  });
  return { ok: true };
}

/* ==========================================================================
   试卷 / 练习
   ========================================================================== */

/** 新建试卷。 */
export function createExam(input: Partial<ExamPaper> & { name: string }): {
  ok: boolean;
  message?: string | undefined;
  exam?: ExamPaper;
} {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "请填写试卷名称" };

  const exam: ExamPaper = {
    id: `exam-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    batch: input.batch ?? "",
    tags: input.tags ?? [],
    durationMin: input.durationMin ?? 60,
    totalScore: input.totalScore ?? 100,
    passScore: input.passScore ?? 60,
    openAt: input.openAt ?? "",
    closeAt: input.closeAt ?? "",
    status: "draft",
    published: false,
    allowRetake: input.allowRetake ?? false,
    publishAnswer: input.publishAnswer ?? "after_close",
    scope: input.scope ?? [],
    questionIds: input.questionIds ?? [],
    items: input.items ?? [],
    orderRule: input.orderRule ?? "type",
    plum: { mode: input.plum?.mode ?? "standard" },
    note: input.note ?? "",
  };

  useCatalog.setState({ exams: [...useCatalog.getState().exams, exam] });
  return { ok: true, exam };
}

/** 新建练习。 */
export function createPractice(input: Partial<Practice> & { name: string }): {
  ok: boolean;
  message?: string | undefined;
  practice?: Practice;
} {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "请填写练习名称" };

  const practice: Practice = {
    id: `prac-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    tags: input.tags ?? [],
    questionIds: input.questionIds ?? [],
    items: input.items ?? [],
    durationMin: input.durationMin ?? 30,
    totalScore: input.totalScore ?? 0,
    status: "draft",
    published: false,
    scope: input.scope ?? [],
    repeats: input.repeats ?? 0,
    feedback: input.feedback ?? "after_submit",
    mistakeReflow: input.mistakeReflow ?? true,
    orderRule: input.orderRule ?? "type",
    note: input.note ?? "",
  };

  useCatalog.setState({ practices: [...useCatalog.getState().practices, practice] });
  return { ok: true, practice };
}

/** 删除试卷或练习。删试卷时连带删除其阅卷记录。 */
export function removePaper(
  kind: "exam" | "practice",
  id: string,
): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  if (kind === "exam") {
    if (!state.exams.some((e) => e.id === id)) return { ok: false, message: "试卷不存在" };
    const plumCfg = { ...state.plumCfg };
    delete plumCfg[id];
    useCatalog.setState({
      exams: state.exams.filter((e) => e.id !== id),
      reviews: state.reviews.filter((r) => r.examId !== id),
      plumCfg,
    });
    return { ok: true };
  }
  if (!state.practices.some((p) => p.id === id)) return { ok: false, message: "练习不存在" };
  useCatalog.setState({ practices: state.practices.filter((p) => p.id !== id) });
  return { ok: true };
}

/** 试卷元数据可写字段。 */
export type ExamMetaPatch = Partial<
  Pick<
    ExamPaper,
    | "name"
    | "batch"
    | "note"
    | "durationMin"
    | "totalScore"
    | "passScore"
    | "openAt"
    | "closeAt"
    | "allowRetake"
    | "publishAnswer"
    | "scope"
    | "status"
    | "published"
    | "orderRule"
    | "tags"
  >
>;

/** 写回试卷元数据。 */
export function setExamMeta(id: string, patch: ExamMetaPatch): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  if (!state.exams.some((e) => e.id === id)) return { ok: false, message: "试卷不存在" };
  useCatalog.setState({
    exams: state.exams.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  });
  return { ok: true };
}

/** 练习元数据可写字段。 */
export type PracticeMetaPatch = Partial<
  Pick<
    Practice,
    | "name"
    | "durationMin"
    | "note"
    | "totalScore"
    | "status"
    | "published"
    | "scope"
    | "repeats"
    | "feedback"
    | "mistakeReflow"
    | "orderRule"
    | "tags"
  >
>;

/** 写回练习元数据。 */
export function setPracticeMeta(
  id: string,
  patch: PracticeMetaPatch,
): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  if (!state.practices.some((p) => p.id === id)) return { ok: false, message: "练习不存在" };
  useCatalog.setState({
    practices: state.practices.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  });
  return { ok: true };
}

/** 取卷型覆盖配置。 */
export function plumCfgOf(examId: string): { mode: PaperPaperMode } {
  return useCatalog.getState().plumCfg[examId] ?? { mode: "standard" };
}

/** 设置卷型覆盖配置。 */
export function setPlumCfg(examId: string, cfg: { mode: PaperPaperMode }): void {
  useCatalog.setState({
    plumCfg: { ...useCatalog.getState().plumCfg, [examId]: cfg },
  });
}

/* ==========================================================================
   名单与可见性
   ========================================================================== */

/** 是否在名单范围内。空范围 = 全员开放。 */
export function isInScope(scope: readonly string[], studentId: string): boolean {
  if (scope.length === 0) return true;
  const student = getStudent(studentId);
  return Boolean(student && scope.includes(student.classId));
}

/** 取名单范围内的学生。 */
export function scopeStudents(scope: readonly string[]): Student[] {
  const state = useCatalog.getState();
  if (scope.length === 0) return state.students;
  return state.students.filter((s) => scope.includes(s.classId));
}

/** 学员可见的试卷（排除草稿 / 未发布，再按名单过滤）。 */
export function studentExams(studentId: string): ExamPaper[] {
  return useCatalog
    .getState()
    .exams.filter((e) => e.status !== "draft" && e.published && isInScope(e.scope, studentId));
}

/** 学员可见的练习。 */
export function studentPractices(studentId: string): Practice[] {
  return useCatalog
    .getState()
    .practices.filter((p) => p.status === "published" && p.published && isInScope(p.scope, studentId));
}

/** 学员可见的单个试卷（深拷贝，题目收敛为已发布子集）。 */
export function studentExam(id: string, studentId: string): ExamPaper | null {
  const exam = getExam(id);
  if (!exam) return null;
  if (exam.status === "draft" || !exam.published) return null;
  if (!isInScope(exam.scope, studentId)) return null;

  const published = publishedQuestionIds(exam.questionIds);
  const items = itemsOf(exam).filter((item) => published.includes(item.qid));
  return { ...exam, questionIds: published, items };
}

/** 学员可见的单个练习。 */
export function studentPractice(id: string, studentId: string): Practice | null {
  const practice = getPractice(id);
  if (!practice) return null;
  if (practice.status !== "published" || !practice.published) return null;
  if (!isInScope(practice.scope, studentId)) return null;

  const published = publishedQuestionIds(practice.questionIds);
  const items = itemsOf(practice).filter((item) => published.includes(item.qid));
  return { ...practice, questionIds: published, items };
}

/* ==========================================================================
   阅卷
   ========================================================================== */

/** 取阅卷记录。 */
export function reviewOf(id: string): ReviewItem | undefined {
  return useCatalog.getState().reviews.find((r) => r.id === id);
}

/** 加入阅卷队列（重复 ID 只补齐作答文本）。 */
export function addReview(input: Omit<ReviewItem, "status" | "teacherScore" | "comment">): {
  ok: boolean;
  message?: string | undefined;
} {
  if (!input.id) return { ok: false, message: "缺少阅卷记录标识" };
  const state = useCatalog.getState();
  const existing = state.reviews.find((r) => r.id === input.id);
  if (existing) {
    useCatalog.setState({
      reviews: state.reviews.map((r) =>
        r.id === input.id ? { ...r, answerText: input.answerText || r.answerText } : r,
      ),
    });
    return { ok: true };
  }
  useCatalog.setState({
    reviews: [
      ...state.reviews,
      { ...input, status: "pending", teacherScore: null, comment: "" },
    ],
  });
  return { ok: true };
}

/** 更新阅卷记录。 */
export function updateReview(
  id: string,
  patch: Partial<Pick<ReviewItem, "teacherScore" | "comment" | "status">>,
): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  if (!state.reviews.some((r) => r.id === id)) {
    return { ok: false, message: "阅卷记录不存在" };
  }
  useCatalog.setState({
    reviews: state.reviews.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  });
  return { ok: true };
}

/* ==========================================================================
   导入与生成
   ========================================================================== */

/** 导入样例池。 */
const IMPORT_SAMPLE: Array<Omit<ImportRow, "no">> = [
  {
    stem: "已知等差数列 {a_n} 的首项为 3，公差为 2，求其通项公式。",
    type: "short",
    score: 8,
    options: [],
    answer: [],
    analysis: "通项公式为 a_n = 2n + 1。",
    tags: [],
    valid: true,
  },
  {
    stem: "一元二次方程 x² - 5x + 6 = 0 的两个根是什么？",
    type: "single",
    score: 5,
    options: [
      { key: "A", text: "2 与 3" },
      { key: "B", text: "1 与 6" },
      { key: "C", text: "-2 与 -3" },
      { key: "D", text: "0 与 5" },
    ],
    answer: ["A"],
    analysis: "因式分解为 (x-2)(x-3)=0。",
    tags: [],
    valid: true,
  },
  {
    stem: "TCP 三次握手中，客户端发出第一个报文段时置位的标志位是什么？",
    type: "judge",
    score: 4,
    options: [],
    answer: ["A"],
    analysis: "第一个报文段置 SYN 标志位。",
    tags: [],
    valid: true,
  },
  {
    stem: "以下协议中，属于面向连接且提供可靠传输的是？",
    type: "multi",
    score: 6,
    options: [
      { key: "A", text: "TCP" },
      { key: "B", text: "UDP" },
      { key: "C", text: "IP" },
      { key: "D", text: "ICMP" },
    ],
    answer: ["A"],
    analysis: "UDP 无连接，IP 与 ICMP 不提供可靠传输。",
    tags: [],
    valid: true,
  },
];

/** 创建导入批次。 */
export function createImportBatch(input: {
  fileName: string;
  count?: number;
  operator: string;
}): { ok: boolean; message?: string | undefined; batch?: ImportBatch } {
  const fileName = input.fileName.trim();
  if (!fileName) return { ok: false, message: "请填写待导入的文件名" };

  const count = Math.max(1, Math.min(8, input.count ?? 3));
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const id = `imp-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const rows: ImportRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const sample = IMPORT_SAMPLE[i % IMPORT_SAMPLE.length]!;
    rows.push({ ...sample, no: i + 1 });
  }

  const batch: ImportBatch = {
    id,
    fileName,
    operator: input.operator,
    createdAt: now.toISOString().slice(0, 16).replace("T", " "),
    status: "parsed",
    rowCount: rows.length,
    columns: ["题干", "题型", "选项", "答案", "解析", "知识点"],
    mapping: {
      stem: "题干",
      type: "题型",
      options: "选项",
      answer: "答案",
      analysis: "解析",
      tags: "知识点",
    },
    rows,
  };

  useCatalog.setState({ imports: [...useCatalog.getState().imports, batch] });
  return { ok: true, batch };
}

/** 采纳导入批次到目标题库。 */
export function commitImport(
  batchId: string,
  bankId: string,
): { ok: boolean; message?: string | undefined; count?: number } {
  const state = useCatalog.getState();
  const batch = state.imports.find((i) => i.id === batchId);
  if (!batch) return { ok: false, message: "请先选择候选题" };
  if (batch.status === "adopted") return { ok: false, message: "该批次已导入，请勿重复提交" };
  if (!bankId) return { ok: false, message: "请先选择目标题库" };

  const suffix = batchId.replace(/^imp-/, "");
  const ids: string[] = [];
  const questions: Question[] = batch.rows.map((row, index) => {
    const id = `q-imp-${suffix}-${String(index + 1).padStart(2, "0")}`;
    ids.push(id);
    return {
      id,
      type: row.type,
      score: row.score,
      status: "draft",
      source: "import",
      tags: row.tags,
      stem: row.stem,
      options: row.options.length > 0 ? row.options : defaultOptions(row.type),
      answer: row.answer,
      analysis: row.analysis,
      batchId: batch.id,
    };
  });

  const bank = state.banks.find((b) => b.id === bankId);
  if (!bank) return { ok: false, message: "请先选择目标题库" };

  useCatalog.setState({
    questions: [...state.questions, ...questions],
    banks: state.banks.map((b) =>
      b.id === bankId ? { ...b, questionIds: [...b.questionIds, ...ids] } : b,
    ),
    imports: state.imports.map((i) =>
      i.id === batchId
        ? { ...i, status: "adopted", adoptedAt: new Date().toISOString(), adoptedCount: ids.length }
        : i,
    ),
  });
  return { ok: true, count: ids.length };
}

/** 生成样例池。 */
const GENERATION_SAMPLE: Array<Omit<ImportRow, "no">> = [
  {
    stem: "归并排序的时间复杂度是？",
    type: "single",
    score: 5,
    options: [
      { key: "A", text: "O(n log n)" },
      { key: "B", text: "O(n²)" },
      { key: "C", text: "O(n)" },
      { key: "D", text: "O(log n)" },
    ],
    answer: ["A"],
    analysis: "归并排序每层分割共 log n 层，每层合并 O(n)。",
    tags: [],
    valid: true,
  },
  {
    stem: "OSI 参考模型中负责端到端可靠传输的是哪一层？",
    type: "single",
    score: 5,
    options: [
      { key: "A", text: "传输层" },
      { key: "B", text: "网络层" },
      { key: "C", text: "数据链路层" },
      { key: "D", text: "会话层" },
    ],
    answer: ["A"],
    analysis: "传输层提供端到端的可靠传输服务。",
    tags: [],
    valid: true,
  },
  {
    stem: "对二叉搜索树做中序遍历，得到的结果是什么？",
    type: "single",
    score: 5,
    options: [
      { key: "A", text: "升序序列" },
      { key: "B", text: "降序序列" },
      { key: "C", text: "层序序列" },
      { key: "D", text: "无序序列" },
    ],
    answer: ["A"],
    analysis: "二叉搜索树的中序遍历即升序排列。",
    tags: [],
    valid: true,
  },
  {
    stem: "HTTP/2 采用二进制分帧，其主要好处是什么？",
    type: "multi",
    score: 6,
    options: [
      { key: "A", text: "支持多路复用" },
      { key: "B", text: "头部压缩" },
      { key: "C", text: "强制加密" },
      { key: "D", text: "消除队头阻塞" },
    ],
    answer: ["A", "B", "D"],
    analysis: "二进制分帧是多路复用与头部压缩的基础。",
    tags: [],
    valid: true,
  },
];

/** 创建生成批次。 */
export function createGeneration(input: {
  count?: number;
  type?: QuestionType;
  difficulty?: string;
  prompt?: string;
  tagIds?: string[];
  operator: string;
}): { ok: boolean; message?: string | undefined; batch?: GenerationBatch } {
  const count = Math.max(1, Math.min(8, input.count ?? 3));
  const prompt = input.prompt?.trim() || "（未填写生成指令，按默认模板生成）";
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const id = `gen-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const rows: ImportRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const sample = GENERATION_SAMPLE[i % GENERATION_SAMPLE.length]!;
    rows.push({ ...sample, no: i + 1, tags: input.tagIds ?? [] });
  }

  const batch: GenerationBatch = {
    id,
    operator: input.operator,
    createdAt: now.toISOString().slice(0, 16).replace("T", " "),
    status: "generated",
    count: rows.length,
    type: input.type ?? "single",
    difficulty: input.difficulty ?? "中等",
    prompt,
    tagIds: input.tagIds ?? [],
    rows,
  };

  useCatalog.setState({ generations: [...useCatalog.getState().generations, batch] });
  return { ok: true, batch };
}

/** 采纳生成批次到目标题库。 */
export function commitGeneration(
  batchId: string,
  bankId: string,
): { ok: boolean; message?: string | undefined; count?: number } {
  const state = useCatalog.getState();
  const batch = state.generations.find((g) => g.id === batchId);
  if (!batch) return { ok: false, message: "请先选择候选题" };
  if (batch.status === "adopted") return { ok: false, message: "该批次已采纳，请勿重复提交" };
  if (!bankId) return { ok: false, message: "请先选择目标题库" };

  const suffix = batchId.replace(/^gen-/, "");
  const ids: string[] = [];
  const questions: Question[] = batch.rows.map((row, index) => {
    const id = `q-gen-${suffix}-${String(index + 1).padStart(2, "0")}`;
    ids.push(id);
    return {
      id,
      type: row.type,
      score: row.score,
      status: "draft",
      source: "ai",
      tags: row.tags,
      stem: row.stem,
      options: row.options.length > 0 ? row.options : defaultOptions(row.type),
      answer: row.answer,
      analysis: row.analysis,
      batchId: batch.id,
    };
  });

  useCatalog.setState({
    questions: [...state.questions, ...questions],
    banks: state.banks.map((b) =>
      b.id === bankId ? { ...b, questionIds: [...b.questionIds, ...ids] } : b,
    ),
    generations: state.generations.map((g) =>
      g.id === batchId
        ? { ...g, status: "adopted", adoptedAt: new Date().toISOString(), adoptedCount: ids.length }
        : g,
    ),
  });
  return { ok: true, count: ids.length };
}

/** 客观题缺省选项。 */
function defaultOptions(type: QuestionType): QuestionOption[] {
  if (type === "judge" || type === "single" || type === "multi") {
    return [
      { key: "A", text: "正确" },
      { key: "B", text: "错误" },
    ];
  }
  return [];
}

/* ==========================================================================
   卷型模板
   ========================================================================== */

/** 保存卷型模板。 */
export function savePaperTemplate(
  input: Partial<PaperTemplate> & { name: string; items: PaperItem[] },
): { ok: boolean; message?: string | undefined; template?: PaperTemplate } {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "请填写模板名称" };
  if (!input.items || input.items.length === 0) {
    return { ok: false, message: "模板至少需要一道题目" };
  }

  const state = useCatalog.getState();
  const existing = input.id ? state.paperTemplates.find((t) => t.id === input.id) : undefined;
  const template: PaperTemplate = {
    id: existing?.id ?? `tpl-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    kind: input.kind ?? existing?.kind ?? "exam",
    mode: input.mode ?? existing?.mode ?? "standard",
    durationMin: input.durationMin ?? existing?.durationMin ?? 60,
    passScore: input.passScore ?? existing?.passScore ?? 60,
    items: input.items,
  };

  useCatalog.setState({
    paperTemplates: existing
      ? state.paperTemplates.map((t) => (t.id === template.id ? template : t))
      : [...state.paperTemplates, template],
  });
  return { ok: true, template };
}

/** 删除卷型模板。 */
export function removePaperTemplate(id: string): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  if (!state.paperTemplates.some((t) => t.id === id)) {
    return { ok: false, message: "模板不存在" };
  }
  useCatalog.setState({ paperTemplates: state.paperTemplates.filter((t) => t.id !== id) });
  return { ok: true };
}

/* ==========================================================================
   发布前校验
   ========================================================================== */

/** 发布前校验。 */
export function preflight(kind: "exam" | "practice", id: string): PreflightResult {
  const checks: PreflightCheck[] = [];
  const push = (key: string, label: string, ok: boolean, detail: string) => {
    checks.push({ key, label, ok, detail });
  };

  const paper =
    kind === "exam" ? getExam(id) : getPractice(id);

  if (!paper) {
    push("exist", "对象存在", false, "对象不存在");
    return { ok: false, kind, id, checks, failed: 1, total: 1 };
  }
  push("exist", "对象存在", true, "对象存在");

  const items = itemsOf(paper);
  const questionIds = paper.questionIds;

  // 至少一道题。
  push(
    "count",
    "至少选择一道题目",
    items.length > 0,
    items.length > 0 ? `已选 ${items.length} 道题目` : "尚未选题",
  );

  // 所选题目均已发布。
  const unpublished = items.filter((i) => getQuestion(i.qid)?.status !== "published");
  push(
    "published",
    "所选题目均为「已发布」",
    unpublished.length === 0,
    unpublished.length === 0
      ? "全部题目已发布"
      : `${unpublished.length} 道题目为草稿或已停用，请先发布或替换`,
  );

  // 总分一致。
  const sum = items.reduce((acc, i) => acc + i.score, 0);
  const target = kind === "exam" ? paper.totalScore : paper.totalScore;
  push(
    "score",
    "总分等于各题分值之和",
    sum === target,
    sum === target ? `各题合计 ${sum} 分` : `各题合计 ${sum} 分 / 目标总分 ${target} 分`,
  );

  // 无重复题目。
  const seen = new Set<string>();
  const duplicates = questionIds.filter((qid) => {
    if (seen.has(qid)) return true;
    seen.add(qid);
    return false;
  });
  push(
    "dup",
    "试卷内无重复题目",
    duplicates.length === 0,
    duplicates.length === 0 ? "无重复题目" : `${duplicates.length} 道题目重复出现`,
  );

  // 客观 / 主观分值占比。
  const objectiveScore = items
    .filter((i) => {
      const t = getQuestion(i.qid)?.type;
      return t !== "short" && t !== "comprehensive";
    })
    .reduce((acc, i) => acc + i.score, 0);
  const subjectiveScore = sum - objectiveScore;
  const objectiveRatio = sum > 0 ? objectiveScore / sum : 1;
  const subjectiveRatio = sum > 0 ? subjectiveScore / sum : 0;
  if (kind === "exam") {
    push(
      "mix",
      "客观 / 主观分值占比合理",
      subjectiveRatio <= 0.4,
      `客观 ${objectiveScore} 分（${Math.round(objectiveRatio * 100)}%），主观 ${subjectiveScore} 分（${Math.round(subjectiveRatio * 100)}%）`,
    );
  } else {
    push("mix", "客观 / 主观分值占比合理", true, "练习卷不限制主客观占比");
  }

  // 时长与题量匹配。
  const duration = kind === "exam" ? paper.durationMin : paper.durationMin;
  const perQuestion = items.length > 0 ? duration / items.length : 0;
  const perPoint = sum > 0 ? duration / sum : 0;
  const durationOk =
    items.length === 0 || (perQuestion >= 0.5 && perQuestion <= 20 && perPoint >= 0.3 && perPoint <= 3);
  push(
    "duration",
    "时长与题量匹配",
    durationOk,
    `${duration} 分钟 / ${items.length} 题，题均约 ${perQuestion.toFixed(1)} 分钟，每分约 ${perPoint.toFixed(1)} 分钟`,
  );

  // 标签数量。
  push(
    "tags",
    "标签不超过 5 个",
    paper.tags.length <= MAX_TAGS,
    `已选 ${paper.tags.length} 个标签`,
  );

  if (kind === "exam") {
    const exam = paper as ExamPaper;
    const scopeCount = exam.scope.length;
    const covered = scopeStudents(exam.scope).length;
    push(
      "roster",
      "已选择考试名单组",
      scopeCount > 0,
      scopeCount > 0 ? `覆盖 ${scopeCount} 个名单组，共 ${covered} 名答题者` : "尚未选择名单组",
    );
  } else {
    push("open", "开放范围已配置", true, "练习开放范围已配置");
  }

  const failed = checks.filter((c) => !c.ok).length;
  return { ok: failed === 0, kind, id, checks, failed, total: checks.length };
}

/* ==========================================================================
   考生作答记录
   ========================================================================== */

/** 考生作答记录键。 */
export function attemptKey(examId: string, studentId: string): string {
  return `${examId}:${studentId}`;
}

/** 写回考生作答记录（重考按最高分保留）。 */
export function saveAttempt(attempt: ExamAttempt): void {
  const state = useCatalog.getState();
  const key = attemptKey(attempt.examId, attempt.studentId);
  const prev = state.attempts[key];
  const keepHigher = !prev || attempt.score >= prev.score;
  useCatalog.setState({
    attempts: {
      ...state.attempts,
      [key]: keepHigher
        ? attempt
        : { ...prev!, attempts: attempt.attempts, attemptNo: attempt.attemptNo },
    },
  });
}

/** 写回练习成绩（重考按最高分保留）。 */
export function savePracticeResult(result: PracticeResult): void {
  const state = useCatalog.getState();
  const key = `${result.practiceId}:${result.studentId}`;
  const prev = state.practiceResults[key];
  const keepHigher = !prev || result.score >= prev.score;
  useCatalog.setState({
    practiceResults: {
      ...state.practiceResults,
      [key]: keepHigher
        ? result
        : { ...prev!, attempts: result.attempts, submittedAt: result.submittedAt },
    },
  });
}

/** 取某学生的练习成绩。 */
export function practiceResultsOf(studentId: string): PracticeResult[] {
  const state = useCatalog.getState();
  return Object.values(state.practiceResults).filter((r) => r.studentId === studentId);
}

/** 取某学生的考试作答记录。 */
export function attemptsOf(studentId: string): ExamAttempt[] {
  const state = useCatalog.getState();
  return Object.values(state.attempts).filter((a) => a.studentId === studentId);
}

/* ==========================================================================
   错题
   ========================================================================== */

/** 记录错题（答错则累加，答对则出册）。 */
export function recordMistakes(
  details: Array<{ qid: string; status: string; reason: string }>,
  studentId: string,
  options: { reflow: boolean; removeOnCorrect: boolean },
): void {
  const state = useCatalog.getState();
  const mistakes = [...state.mistakes];
  const today = new Date().toISOString().slice(0, 10);

  for (const detail of details) {
    const index = mistakes.findIndex(
      (m) => m.qid === detail.qid && (m.studentId === studentId || m.studentId === ""),
    );
    const wrong = detail.status === "wrong" || detail.status === "partial";

    if (wrong && options.reflow) {
      if (index === -1) {
        mistakes.push({
          qid: detail.qid,
          studentId,
          wrongCount: 1,
          lastWrongAt: today,
          reason: detail.reason,
        });
      } else {
        const current = mistakes[index]!;
        mistakes[index] = {
          ...current,
          wrongCount: current.wrongCount + 1,
          lastWrongAt: today,
          reason: detail.reason,
        };
      }
    } else if (!wrong && options.removeOnCorrect && index !== -1) {
      mistakes.splice(index, 1);
    }
  }

  useCatalog.setState({ mistakes });
}

/** 取某学生的错题。 */
export function mistakesOf(studentId: string): Mistake[] {
  return useCatalog
    .getState()
    .mistakes.filter((m) => m.studentId === studentId || m.studentId === "");
}

/* ==========================================================================
   重置
   ========================================================================== */

/** 重置内容仓库到初始示例数据。 */
export function resetCatalog(): void {
  useCatalog.setState(initialState(), true);
}

export { SEED, seedExam, seedPractice };
