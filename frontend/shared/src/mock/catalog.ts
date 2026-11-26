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
import type { AbilityProfileSeed } from "../domain/ability";
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
  QuestionKeypoint,
  QuestionOption,
  QuestionStatus,
  QuestionStep,
  QuestionType,
  ReviewItem,
  ScoreRecord,
  Student,
  Tag,
  TagGroup,
  TagMatchMode,
} from "../domain/types";
import { DIFFICULTY_LABEL, LETTERS } from "../engine/paper";
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

/** 难度中文名（定义在引擎层，此处转出以保持既有引用路径可用）。 */
export { DIFFICULTY_LABEL };

/** 最多可挂载的标签数。 */
export const MAX_TAGS = 5;

/**
 * 难度名称 → 难度等级。
 *
 * 与原型 `DIFFICULTY_LEVEL_MAP` 一致：认得的名字取对应等级，
 * 认不出的名字一律按「中等」（2）兜底。
 */
function difficultyLevelByName(name: string): DifficultyLevel {
  const level = (Object.keys(DIFFICULTY_LABEL) as unknown as DifficultyLevel[]).find(
    (l) => DIFFICULTY_LABEL[l] === name,
  );
  return level ?? 2;
}

/**
 * 难度名称 → 难度标签 ID。
 *
 * 原型固定用 `t-df1` / `t-df2` / `t-df3`；库里存在同名难度标签时用库里的 ID，
 * 保证生成的题目挂得上。
 */
function difficultyTagId(name: string): string {
  const hit = useCatalog.getState().tags.find(
    (t) => t.group === "difficulty" && t.name === name,
  );
  if (hit) return hit.id;
  const fallback: Record<string, string> = { 基础: "t-df1", 中等: "t-df2", 较难: "t-df3" };
  return fallback[name] ?? "t-df2";
}

/** 分值对齐到 0.5 步进（设计文档 §3：Score 携带 0.5 步进精度）。 */
function snapScore(value: number): number {
  return Math.round(value * 2) / 2;
}

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
  /** 能力画像（服务端算好的结果；mock 模式给示例数据）。 */
  abilityProfiles: AbilityProfileSeed[];
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
  /**
   * 校验级别（FR-AUT-06）：
   * - `error`：不通过就不能发布；
   * - `warning`：只是提醒，填写覆盖理由后可以发布。
   */
  level: "error" | "warning";
}

/** 发布前校验结果。 */
export interface PreflightResult {
  ok: boolean;
  kind: "exam" | "practice";
  id: string;
  checks: PreflightCheck[];
  /** 未通过的**错误**项数。 */
  failed: number;
  /** 提醒级（可覆盖）项数。 */
  warnings: number;
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
  abilityProfiles: SEED.abilityProfiles.map((p) => ({ ...p })),
  attempts: {},
  practiceResults: {},
  plumCfg: {},
});

/** 内容仓库 store。 */
export const useCatalog = create<CatalogState>(() => initialState());

/**
 * 用后端快照覆盖内容仓库。
 *
 * 数据源切到后端（`VITE_DATA_SOURCE=http`）时，providers 会读回一次目录，
 * 之后所有页面读到的都是后端数据；页面代码不需要感知数据源。
 */
export function applyRemoteSnapshot(snapshot: {
  tags: Tag[];
  banks: Bank[];
  questions: Question[];
  exams: ExamPaper[];
  practices: Practice[];
}): void {
  useCatalog.setState({
    tags: snapshot.tags,
    banks: snapshot.banks,
    questions: snapshot.questions,
    exams: snapshot.exams,
    practices: snapshot.practices,
  });
}

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

/**
 * 取或建名单组（人员名单导入用）。
 *
 * 名单组是答题端的组织视图，与管理端的组织维度标签一一对应。
 */
export function ensureClass(id: string, name: string): ClassGroup {
  const state = useCatalog.getState();
  const hit = state.classes.find((c) => c.id === id);
  if (hit) return hit;
  const created: ClassGroup = { id, name };
  useCatalog.setState({ classes: [...state.classes, created] });
  return created;
}

/**
 * 新增或更新学生档案（人员名单导入用）。
 *
 * 学号即账号；已存在时更新姓名与名单组，不新增重复条目。
 */
export function upsertStudent(input: {
  id: string;
  name: string;
  classId: string;
  enrollYear?: number | undefined;
}): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  if (!input.id.trim()) return { ok: false, message: "学号不能为空" };
  if (!input.name.trim()) return { ok: false, message: "姓名不能为空" };
  const existing = state.students.find((s) => s.id === input.id);
  const enrollYear = input.enrollYear ?? new Date().getFullYear();
  if (existing) {
    useCatalog.setState({
      students: state.students.map((s) =>
        s.id === input.id ? { ...s, name: input.name.trim(), classId: input.classId } : s,
      ),
    });
    return { ok: true };
  }
  const student: Student = {
    id: input.id.trim(),
    name: input.name.trim(),
    classId: input.classId,
    enrollYear,
  };
  useCatalog.setState({ students: [...state.students, student] });
  return { ok: true };
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

/**
 * 取标签自身与它的全部后代。
 *
 * 标签树按 `parentId` 组织；目录里没有父标签时只有它自己。
 */
export function descendantTagIds(rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const tag of useCatalog.getState().tags) {
    if (!tag.parentId) continue;
    const list = children.get(tag.parentId) ?? [];
    list.push(tag.id);
    children.set(tag.parentId, list);
  }
  const out: string[] = [];
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || out.includes(id)) continue;
    out.push(id);
    for (const child of children.get(id) ?? []) queue.push(child);
  }
  return out;
}

/**
 * 按标签筛选：任一命中（默认）/ 全部命中，可含子标签。
 *
 * 语义与服务端 `GET /questions` 一致：
 * - `any`：命中任意一个选中标签（含其子标签）即算命中；
 * - `all`：每个选中标签都要被命中（含其子标签也算命中该标签）。
 */
export function matchTagFilter(
  entity: { tags: string[] },
  ids: readonly string[],
  options: { includeDescendants?: boolean; matchMode?: TagMatchMode } = {},
): boolean {
  const roots = [...new Set(ids)];
  if (roots.length === 0) return true;
  const includeDescendants = options.includeDescendants ?? true;
  const matchMode = options.matchMode ?? "any";
  const subtrees = roots.map((root) =>
    includeDescendants ? descendantTagIds(root) : [root],
  );
  if (matchMode === "all") {
    return subtrees.every((subtree) => entity.tags.some((tagId) => subtree.includes(tagId)));
  }
  const union = new Set(subtrees.flat());
  return entity.tags.some((tagId) => union.has(tagId));
}

/* ==========================================================================
   标签
   ========================================================================== */

/** 校验标签选择。 */
export function validateTags(ids: readonly string[]): TagValidation {
  // 原型顺序：先去空 → 查重复 → 查无效 → 最后查数量上限，
  // 顺序不同会让同一份数据报出不同的提示文案。
  const list = ids.filter((id) => id.length > 0);
  const seen = new Set<string>();
  for (const id of list) {
    if (seen.has(id)) return { ok: false, ids: [], message: "标签不可重复选择" };
    seen.add(id);
  }
  const known = new Set(useCatalog.getState().tags.map((t) => t.id));
  if (list.some((id) => !known.has(id))) {
    return { ok: false, ids: [], message: "存在无效标签，请重新选择" };
  }
  if (list.length > MAX_TAGS) {
    return { ok: false, ids: [], message: `最多只能选择 ${MAX_TAGS} 个标签，当前已选 ${list.length} 个` };
  }
  return { ok: true, ids: list };
}

/**
 * 校验父标签：必须存在，且父子维度能成树。
 *
 * 与后端同一条规则（`TagGroups.CanNest`）：难度维度平铺，不能有父；
 * 领域 / 知识点 / 能力三个内容维度之间可以跨维度成树——
 * 需求 FR-CAT-02 的验收例子「选『高等数学』命中其下所有知识点」要求如此。
 */
function checkParent(
  tags: readonly Tag[],
  parentId: string | null | undefined,
  group: TagGroup,
  selfId?: string,
): { ok: true } | { ok: false; message: string } {
  if (!parentId) return { ok: true };
  if (parentId === selfId) return { ok: false, message: "标签不能以自身为父标签。" };
  const parent = tags.find((t) => t.id === parentId);
  if (!parent) return { ok: false, message: "父标签不存在。" };
  if (group === "difficulty") {
    return { ok: false, message: "难度维度的标签没有层级关系。" };
  }
  if (parent.group === "difficulty") {
    return { ok: false, message: "难度维度是平铺的，不能作为父标签。" };
  }
  return { ok: true };
}

/** 新建标签。 */
export function createTag(input: {
  name: string;
  group: TagGroup;
  parentId?: string | null;
}): { ok: boolean; message?: string | undefined; tag?: Tag } {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "请填写标签名称" };
  if (!TAG_GROUP_ORDER.includes(input.group)) return { ok: false, message: "请选择有效的标签分组" };

  const state = useCatalog.getState();
  if (state.tags.some((t) => t.group === input.group && t.name === name)) {
    return { ok: false, message: "同一分组内已存在同名标签" };
  }
  const parent = checkParent(state.tags, input.parentId, input.group);
  if (!parent.ok) return { ok: false, message: parent.message };

  const id = `t-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const tag: Tag = { id, name, group: input.group };
  if (input.parentId) tag.parentId = input.parentId;
  // 难度分组按名称定级，未知名称按「中等」兜底（原型 createTag）。
  if (input.group === "difficulty") {
    tag.level = difficultyLevelByName(name);
  }
  useCatalog.setState({ tags: [...state.tags, tag] });
  return { ok: true, tag };
}

/** 更新标签。 */
export function updateTag(
  id: string,
  patch: { name?: string; group?: TagGroup; parentId?: string | null },
): { ok: boolean; message?: string } {
  const name = patch.name?.trim();
  if (name === undefined || !name) return { ok: false, message: "请填写标签名称" };

  const state = useCatalog.getState();
  const target = state.tags.find((t) => t.id === id);
  if (!target) return { ok: false, message: "标签不存在" };

  const group = patch.group ?? target.group;
  if (!TAG_GROUP_ORDER.includes(group)) return { ok: false, message: "请选择有效的标签分组" };

  if (state.tags.some((t) => t.id !== id && t.group === group && t.name === name)) {
    return { ok: false, message: "同一分组内已存在同名标签" };
  }
  const parent = checkParent(state.tags, patch.parentId, group, id);
  if (!parent.ok) return { ok: false, message: parent.message };

  const next: Tag = { ...target, name, group };
  if (patch.parentId !== undefined) {
    if (patch.parentId) next.parentId = patch.parentId;
    else delete next.parentId;
  }
  if (group !== "difficulty") {
    delete next.level;
  } else {
    // 改名后**重算**难度等级，不沿用旧等级（原型 updateTag）。
    next.level = difficultyLevelByName(name);
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
    return { ok: false, message: "标签不存在" };
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
  const wantedId = (input.id ?? "").trim();
  // 题号唯一：带 id 的请求视为「更新该题」；不存在则按该题号新建。
  const existing = wantedId ? state.questions.find((q) => q.id === wantedId) : undefined;

  const type: QuestionType = input.type ?? existing?.type ?? "single";
  const wantStatus = String(input.status ?? "").trim();

  // 客观题选项归一化：丢掉空文案，缺键按位置补 ABCDEF，文案去空白。
  const rawOptions = input.options ?? existing?.options ?? [];
  const options: QuestionOption[] = rawOptions
    .map((option, index) => ({
      key: (option.key ?? "").trim() || (LETTERS[index] ?? String(index + 1)),
      text: (option.text ?? "").trim(),
    }))
    .filter((option) => option.text.length > 0);

  // 答案键按选项键去重并过滤掉不存在的键（FR-CAT-03）。
  const optionKeys = new Set(options.map((option) => option.key));
  const answer = [
    ...new Set((input.answer ?? existing?.answer ?? []).filter((key) => optionKeys.has(key))),
  ];

  // 题型专属校验（FR-CAT-03）：单选恰一个正确选项、多选至少两个、
  // 判断恰一个、简答至少一个评分要点、综合操作题至少一个评分步骤。
  //
  // 提示文案与校验顺序都照抄原型 admin.js:1039-1041：
  // 先判「一个都没选」，再判单选多选、多选不足。顺序不同会报出不同文案。
  if (type === "single" || type === "multi" || type === "judge") {
    if (options.length < 2) return { ok: false, message: "选择题至少需要两个选项" };
    if (answer.length === 0) {
      return { ok: false, message: "请至少勾选一个正确答案" };
    }
    if (type === "single" && answer.length > 1) {
      return { ok: false, message: "单选题只能有一个正确答案" };
    }
    if (type === "multi" && answer.length < 2) {
      return { ok: false, message: "多选题至少需要两个正确答案" };
    }
    if (type === "judge" && answer.length > 1) {
      return { ok: false, message: "判断题只能有一个正确答案" };
    }
  }

  // 评分要点归一化：丢掉空文案，关键词为空时回退为要点原文。
  const keypoints: QuestionKeypoint[] = (input.keypoints ?? existing?.keypoints ?? [])
    .map((point) => {
      const text = (point.text ?? "").trim();
      const keywords = (point.keywords ?? [])
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0);
      return { text, keywords: keywords.length > 0 ? keywords : [text] };
    })
    .filter((point) => point.text.length > 0);

  // 评分步骤归一化：丢掉空题干，步骤 id 缺省时按序号补齐，关键词回退为题干。
  const steps: QuestionStep[] = (input.steps ?? existing?.steps ?? [])
    .map((step, index) => {
      const prompt = (step.prompt ?? "").trim();
      const keywords = (step.keywords ?? [])
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0);
      return {
        id: (step.id ?? "").trim() || `s${index + 1}`,
        prompt,
        answer: step.answer ?? "",
        keywords: keywords.length > 0 ? keywords : [prompt],
        score: Math.max(1, Number(step.score) || 5),
      };
    })
    .filter((step) => step.prompt.length > 0);

  if (type === "short" && keypoints.length === 0) {
    return { ok: false, message: "请至少填写一个评分要点" };
  }
  if (type === "comprehensive" && steps.length === 0) {
    return { ok: false, message: "请至少填写一个评分步骤" };
  }

  const question: Question = {
    id:
      (existing?.id ?? wantedId) ||
      `q-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    // 分值范围 1..40（FR-CAT-03），并对齐到 0.5 步进（设计文档 §3 的 Score 精度）。
    score: Math.max(1, Math.min(40, snapScore(Number(input.score ?? existing?.score ?? 5) || 5))),
    // 状态流转（FR-CAT-04）：传入合法状态即按其流转（已停用可恢复为已发布）；
    // 未传或非法时，新建为草稿、编辑保留原状态。
    status: isValidQuestionStatus(wantStatus)
      ? wantStatus
      : existing
        ? existing.status
        : "draft",
    source: input.source ?? existing?.source ?? "manual",
    tags: validation.ids,
    stem,
    answer,
    // 解析按提交值覆盖：缺省即清空（原型 upsertQuestion）。
    analysis: input.analysis ?? "",
  };

  // 可选字段缺省不写入（exactOptionalPropertyTypes 下不能显式赋 undefined）。
  if (options.length > 0) question.options = options;
  // 参考答案同样按提交值覆盖，缺省即清空（原型 upsertQuestion）。
  question.reference = input.reference ?? "";
  if (keypoints.length > 0) question.keypoints = keypoints;
  if (steps.length > 0) question.steps = steps;
  const figure = input.figure ?? existing?.figure;
  if (figure) question.figure = figure;
  const attachments = input.attachments ?? existing?.attachments;
  if (attachments && attachments.length > 0) question.attachments = attachments;
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

/**
 * 批量丢弃候选题：逐条返回成功与失败原因（FR-CAT-04）。
 */
export function discardQuestions(ids: readonly string[]): {
  ok: boolean;
  changed: number;
  failed: number;
  succeeded: Array<{ id: string; changed: boolean }>;
  failures: Array<{ id: string; reason: string }>;
} {
  const succeeded: Array<{ id: string; changed: boolean }> = [];
  const failures: Array<{ id: string; reason: string }> = [];
  for (const id of ids) {
    const result = discardQuestion(id);
    if (!result.ok) {
      failures.push({ id, reason: result.message ?? "丢弃失败" });
    } else {
      succeeded.push({ id, changed: true });
    }
  }
  return {
    ok: failures.length === 0,
    changed: succeeded.length,
    failed: failures.length,
    succeeded,
    failures,
  };
}

/** 批量设置题目状态。 */
export function setQuestionsStatus(
  ids: readonly string[],
  status: QuestionStatus,
): {
  ok: boolean;
  changed: number;
  failed: number;
  /** 逐条结果：成功与失败各带原因（FR-CAT-04）。 */
  succeeded: Array<{ id: string; changed: boolean }>;
  failures: Array<{ id: string; reason: string }>;
} {
  let changed = 0;
  const succeeded: Array<{ id: string; changed: boolean }> = [];
  const failures: Array<{ id: string; reason: string }> = [];
  for (const id of ids) {
    const result = setQuestionStatus(id, status);
    if (!result.ok) {
      failures.push({ id, reason: result.message ?? "状态流转被拒绝" });
    } else {
      if (result.changed) changed += 1;
      succeeded.push({ id, changed: result.changed });
    }
  }
  return { ok: failures.length === 0, changed, failed: failures.length, succeeded, failures };
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
    // 客观 / 主观统计的是**分值合计**（原型口径），不是题量：
    // 题量另有 total / published / draft / disabled 三个计数可用。
    objective: published
      .filter((q) => q.type !== "short" && q.type !== "comprehensive")
      .reduce((sum, q) => sum + (q.score || 0), 0),
    subjective: published
      .filter((q) => q.type === "short" || q.type === "comprehensive")
      .reduce((sum, q) => sum + (q.score || 0), 0),
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

  const tagValidation = validateTags(input.tags ?? []);
  if (!tagValidation.ok) return { ok: false, message: tagValidation.message ?? "标签无效" };

  const state = useCatalog.getState();
  const existing = input.id ? state.banks.find((b) => b.id === input.id) : undefined;
  const known = new Set(state.questions.map((q) => q.id));

  const bank: Bank = {
    id: existing?.id ?? `bank-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    desc: input.desc ?? existing?.desc ?? "",
    tags: tagValidation.ids,
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
    if (!exam) return { ok: false, message: "对象不存在" };
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
  if (!practice) return { ok: false, message: "对象不存在" };
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

/**
 * 写入试卷 / 练习的标签（原型 `setEntityTags`）。
 *
 * 标签走同一套校验：去重、过滤无效标签、上限 5 个。
 */
export function setEntityTags(
  kind: "exam" | "practice",
  id: string,
  tags: string[],
): { ok: boolean; message?: string | undefined } {
  const state = useCatalog.getState();
  const exists =
    kind === "exam"
      ? state.exams.some((e) => e.id === id)
      : state.practices.some((p) => p.id === id);
  if (!exists) return { ok: false, message: "对象不存在" };

  const check = validateTags(tags);
  if (!check.ok) return { ok: false, message: check.message };

  if (kind === "exam") {
    useCatalog.setState({
      exams: state.exams.map((e) => (e.id === id ? { ...e, tags: check.ids } : e)),
    });
    return { ok: true };
  }
  useCatalog.setState({
    practices: state.practices.map((p) => (p.id === id ? { ...p, tags: check.ids } : p)),
  });
  return { ok: true };
}

/** 新建试卷。 */
export function createExam(input: Partial<ExamPaper> & { name: string }): {
  ok: boolean;
  message?: string | undefined;
  exam?: ExamPaper;
} {
  // 原型 catalog.js:998：名称为空时兜底为「未命名试卷」，不报错。
  const name = input.name.trim() || "未命名试卷";

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
  // 原型 catalog.js:1025：名称为空时兜底为「未命名练习」，不报错。
  const name = input.name.trim() || "未命名练习";

  const practice: Practice = {
    id: `prac-u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    tags: input.tags ?? [],
    questionIds: input.questionIds ?? [],
    items: input.items ?? [],
    durationMin: input.durationMin ?? 20,
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
    if (!state.exams.some((e) => e.id === id)) return { ok: false, message: "对象不存在" };
    const plumCfg = { ...state.plumCfg };
    delete plumCfg[id];
    useCatalog.setState({
      exams: state.exams.filter((e) => e.id !== id),
      reviews: state.reviews.filter((r) => r.examId !== id),
      plumCfg,
    });
    return { ok: true };
  }
  if (!state.practices.some((p) => p.id === id)) return { ok: false, message: "对象不存在" };
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

/**
 * 写回试卷元数据。
 *
 * 逐字段归一化（对齐原型 catalog.js 的 setExamMeta）：时长不少于 1 分钟、
 * 分数与及格分不小于 0、题序规则归一、标签走标签校验。
 */
export function setExamMeta(id: string, patch: ExamMetaPatch): { ok: boolean; message?: string } {
  const state = useCatalog.getState();
  const exam = state.exams.find((e) => e.id === id);
  if (!exam) return { ok: false, message: "试卷不存在" };

  const next: ExamPaper = { ...exam };
  if (patch.name !== undefined) {
    next.name = String(patch.name).trim() || exam.name;
  }
  if (patch.batch !== undefined) next.batch = String(patch.batch).trim();
  if (patch.note !== undefined) next.note = String(patch.note);
  if (patch.durationMin !== undefined) {
    next.durationMin = Math.max(1, parseInt(String(patch.durationMin), 10) || exam.durationMin);
  }
  if (patch.totalScore !== undefined) next.totalScore = Math.max(0, Number(patch.totalScore) || 0);
  if (patch.passScore !== undefined) next.passScore = Math.max(0, Number(patch.passScore) || 0);
  if (patch.openAt !== undefined) next.openAt = String(patch.openAt);
  if (patch.closeAt !== undefined) next.closeAt = String(patch.closeAt);
  if (patch.allowRetake !== undefined) next.allowRetake = Boolean(patch.allowRetake);
  if (patch.publishAnswer !== undefined) {
    next.publishAnswer = String(patch.publishAnswer) as ExamPaper["publishAnswer"];
  }
  if (patch.scope !== undefined) next.scope = [...patch.scope];
  if (patch.status !== undefined) next.status = String(patch.status) as ExamPaper["status"];
  if (patch.published !== undefined) next.published = Boolean(patch.published);
  if (patch.orderRule !== undefined) {
    next.orderRule = patch.orderRule === "manual" ? "manual" : "type";
  }
  if (patch.tags !== undefined) {
    const check = validateTags(patch.tags);
    if (!check.ok) return { ok: false, message: check.message ?? "标签无效" };
    next.tags = check.ids;
  }

  useCatalog.setState({ exams: state.exams.map((e) => (e.id === id ? next : e)) });
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
  const practice = state.practices.find((p) => p.id === id);
  if (!practice) return { ok: false, message: "练习不存在" };

  const next: Practice = { ...practice };
  if (patch.name !== undefined) {
    next.name = String(patch.name).trim() || practice.name;
  }
  if (patch.durationMin !== undefined) {
    next.durationMin = Math.max(1, parseInt(String(patch.durationMin), 10) || practice.durationMin);
  }
  if (patch.note !== undefined) next.note = String(patch.note);
  if (patch.totalScore !== undefined) next.totalScore = Math.max(0, Number(patch.totalScore) || 0);
  if (patch.status !== undefined) next.status = String(patch.status) as Practice["status"];
  if (patch.published !== undefined) next.published = Boolean(patch.published);
  if (patch.scope !== undefined) next.scope = [...patch.scope];
  if (patch.repeats !== undefined) {
    next.repeats = Math.max(0, parseInt(String(patch.repeats), 10) || 0);
  }
  if (patch.feedback !== undefined) {
    next.feedback = String(patch.feedback) as Practice["feedback"];
  }
  if (patch.mistakeReflow !== undefined) next.mistakeReflow = Boolean(patch.mistakeReflow);
  if (patch.orderRule !== undefined) {
    next.orderRule = patch.orderRule === "manual" ? "manual" : "type";
  }
  if (patch.tags !== undefined) {
    const check = validateTags(patch.tags);
    if (!check.ok) return { ok: false, message: check.message ?? "标签无效" };
    next.tags = check.ids;
  }

  useCatalog.setState({
    practices: state.practices.map((p) => (p.id === id ? next : p)),
  });
  return { ok: true };
}

/** 取卷型覆盖配置。 */
export function plumCfgOf(examId: string): { mode: PaperPaperMode } {
  const state = useCatalog.getState();
  // 卷型有三处来源，优先级从高到低：
  //   1. plumCfg —— 组卷向导里人工改过的覆盖值
  //   2. 试卷自身的 plum —— seed 与「试卷」表单写下的卷型
  //   3. 兜底标准卷
  // 漏掉第 2 层会让分析页等读 plumCfg 的地方把大梅花/小梅花显示成标准卷。
  const exam = state.exams.find((e) => e.id === examId);
  return state.plumCfg[examId] ?? exam?.plum ?? { mode: "standard" };
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
  /** 真实解析出的行；传入时不再使用示例数据。 */
  rows?: ImportRow[];
  /** 文件里的表头（列映射的来源）。 */
  columns?: string[];
  /** 列映射：目标字段 → 来源列名。 */
  mapping?: Record<string, string>;
}): { ok: boolean; message?: string | undefined; batch?: ImportBatch } {
  const fileName = input.fileName.trim();
  if (!fileName) return { ok: false, message: "请填写待导入的文件名" };

  const count = Math.max(1, Math.min(8, input.count ?? 3));
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const id = `imp-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const rows: ImportRow[] = input.rows
    ? input.rows.map((row, index) => ({ ...row, no: row.no ?? index + 1 }))
    : [];
  if (!input.rows) {
    for (let i = 0; i < count; i += 1) {
      const sample = IMPORT_SAMPLE[i % IMPORT_SAMPLE.length]!;
      rows.push({ ...sample, no: i + 1 });
    }
  }

  const batch: ImportBatch = {
    id,
    fileName,
    operator: input.operator,
    createdAt: now.toISOString().slice(0, 16).replace("T", " "),
    status: "parsed",
    rowCount: rows.length,
    columns: input.columns ?? ["题干", "题型", "选项", "答案", "解析", "知识点"],
    mapping:
      input.mapping ??
      {
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

/** 修改导入批次的列映射与解析结果（列映射可编辑）。 */
export function updateImportBatch(
  batchId: string,
  patch: {
    mapping?: Record<string, string>;
    rows?: ImportRow[];
    columns?: string[];
  },
): { ok: boolean; message?: string | undefined } {
  const state = useCatalog.getState();
  const batch = state.imports.find((i) => i.id === batchId);
  if (!batch) return { ok: false, message: "导入批次不存在" };
  if (batch.status === "adopted") return { ok: false, message: "该批次已导入，不可再修改" };
  useCatalog.setState({
    imports: state.imports.map((i) =>
      i.id === batchId
        ? {
            ...i,
            ...(patch.mapping ? { mapping: patch.mapping } : {}),
            ...(patch.columns ? { columns: patch.columns } : {}),
            ...(patch.rows ? { rows: patch.rows, rowCount: patch.rows.length } : {}),
          }
        : i,
    ),
  });
  return { ok: true };
}

/** 采纳导入批次到目标题库。 */
export function commitImport(
  batchId: string,
  bankId: string,
): { ok: boolean; message?: string | undefined; count?: number } {
  const state = useCatalog.getState();
  const batch = state.imports.find((i) => i.id === batchId);
  if (!batch) return { ok: false, message: "导入批次不存在" };
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

/** AI 生成样例池（原型 GEN_SAMPLE）：仅用于演示生成流程的示例题。 */
type GenerationSample = Pick<
  ImportRow,
  "stem" | "type" | "options" | "answer" | "analysis" | "tags"
>;

const GENERATION_SAMPLE: GenerationSample[] = [
  {
    stem: "对长度为 n 的序列做归并排序，其时间复杂度是：",
    type: "single",
    options: [
      { key: "A", text: "O(log n)" },
      { key: "B", text: "O(n)" },
      { key: "C", text: "O(n log n)" },
      { key: "D", text: "O(n²)" },
    ],
    answer: ["C"],
    analysis: "递归层数 log n，每层合并代价 O(n)，总计 O(n log n)。",
    tags: ["t-dom-ds", "t-pt-sort", "t-df2"],
  },
  {
    stem: "OSI 参考模型中，负责端到端可靠传输的层次是：",
    type: "single",
    options: [
      { key: "A", text: "网络层" },
      { key: "B", text: "传输层" },
      { key: "C", text: "会话层" },
      { key: "D", text: "表示层" },
    ],
    answer: ["B"],
    analysis: "传输层提供端到端的可靠传输与流量控制。",
    tags: ["t-dom-net", "t-pt-tcp", "t-df1"],
  },
  {
    stem: "关于二叉搜索树（BST），下列说法正确的有：",
    type: "multi",
    options: [
      { key: "A", text: "中序遍历得到有序序列" },
      { key: "B", text: "左子树所有键值均小于该节点" },
      { key: "C", text: "右子树所有键值均大于该节点" },
      { key: "D", text: "插入顺序不会影响树形" },
    ],
    answer: ["A", "B", "C"],
    analysis: "BST 即左小右大，中序遍历必有序；插入顺序会影响树形，故 D 错误。",
    tags: ["t-dom-ds", "t-pt-tree", "t-df3"],
  },
  {
    stem: "HTTP/2 在应用层使用二进制分帧编码，并可在同一条连接上并发承载多个请求。",
    type: "judge",
    options: [
      { key: "A", text: "正确" },
      { key: "B", text: "错误" },
    ],
    answer: ["A"],
    analysis: "HTTP/2 引入二进制分帧层，天然支持多路复用。",
    tags: ["t-dom-net", "t-pt-app", "t-df1"],
  },
];

/**
 * mock 模式下的「AI 供应商」。
 *
 * mock 模式不调真实大模型，生成的是固定样例。这里给出与真实模式**同形**的
 * 供应商与模型，界面上的选择器在两种模式里长得一样。
 */
export const MOCK_AI_PROVIDERS = [
  {
    name: "mock",
    displayName: "示例数据",
    configured: true,
    defaultModel: "mock-sample",
    models: ["mock-sample"],
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

  const type = input.type ?? "single";
  const difficulty = input.difficulty ?? "中等";
  const tagIds = input.tagIds ?? [];

  // 按题型取样例池；该题型没有样例时退回全量池（原型 buildGenRows）。
  const matched = GENERATION_SAMPLE.filter((r) => r.type === type);
  const pool = matched.length > 0 ? matched : GENERATION_SAMPLE;
  const diffTag = difficultyTagId(difficulty);

  const rows: ImportRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const sample = pool[i % pool.length]!;
    // 指定了标签就用指定的，否则沿用样例自带标签；再补上难度标签。
    const tags = tagIds.length > 0 ? [...tagIds] : [...sample.tags];
    if (!tags.includes(diffTag)) tags.push(diffTag);
    rows.push({
      no: i + 1,
      stem: sample.stem,
      type: sample.type,
      score: difficulty === "较难" ? 6 : 5,
      options: sample.options.map((o) => ({ ...o })),
      answer: [...sample.answer],
      analysis: sample.analysis,
      tags,
      valid: true,
    });
  }

  const batch: GenerationBatch = {
    id,
    operator: input.operator,
    createdAt: now.toISOString().slice(0, 16).replace("T", " "),
    status: "generated",
    count: rows.length,
    type,
    difficulty,
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
  if (!batch) return { ok: false, message: "生成批次不存在" };
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
  const push = (
    key: string,
    label: string,
    ok: boolean,
    detail: string,
    level: "error" | "warning" = "error",
  ) => {
    checks.push({ key, label, ok, detail, level });
  };

  const paper =
    kind === "exam" ? getExam(id) : getPractice(id);

  if (!paper) {
    push("exist", "对象存在", false, "对象不存在");
    return { ok: false, kind, id, checks, failed: 1, warnings: 0, total: 1 };
  }

  const items = itemsOf(paper);
  const target = paper.totalScore;

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
      ? `共 ${items.length} 道题目全部处于已发布状态`
      : `${unpublished.length} 道题目为草稿或已停用，请先发布或替换`,
  );

  // 总分一致（原型：合计分与目标总分始终是同一句文案）。
  const sum = items.reduce((acc, i) => acc + i.score, 0);
  push(
    "score",
    "总分等于各题分值之和",
    items.length > 0 && sum === target,
    `各题合计 ${sum} 分 / 目标总分 ${target} 分`,
  );

  // 无重复题目。
  const seen = new Set<string>();
  const duplicates = items.filter((i) => {
    if (seen.has(i.qid)) return true;
    seen.add(i.qid);
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
  const objectiveRatio = sum > 0 ? Math.round((objectiveScore / sum) * 100) : 0;
  const subjectiveRatio = sum > 0 ? Math.round((subjectiveScore / sum) * 100) : 0;
  // 已记录的覆盖理由（FR-AUT-06：可覆盖并填写理由）。
  const overrideReasons =
    kind === "exam" ? ((paper as ExamPaper).overrideReasons ?? {}) : {};
  const reasonOf = (key: string): string | undefined => overrideReasons[key];

  // 练习卷不设占比上限，但仍展示占比。
  const mixOk = kind === "exam" ? subjectiveRatio <= 40 : true;
  push(
    "mix",
    "客观 / 主观分值占比合理",
    mixOk,
    `客观 ${objectiveScore} 分（${objectiveRatio}%），主观 ${subjectiveScore} 分（${subjectiveRatio}%）` +
      (mixOk
        ? ""
        : "；主观题占比超过 40%，建议调整" +
          (reasonOf("mix") ? `；已填写覆盖理由：${reasonOf("mix")}` : "")),
    "warning",
  );

  // 时长与题量匹配（每分耗时按目标总分折算）。
  const duration = paper.durationMin;
  const perQuestion = items.length > 0 ? Math.round((duration / items.length) * 10) / 10 : 0;
  const perPoint = target > 0 ? Math.round((duration / target) * 100) / 100 : 0;
  const durationOk =
    items.length > 0 &&
    duration > 0 &&
    perQuestion >= 0.5 &&
    perQuestion <= 20 &&
    perPoint >= 0.3 &&
    perPoint <= 3;
  push(
    "duration",
    "时长与题量匹配",
    durationOk,
    `${duration} 分钟 / ${items.length} 题，题均约 ${perQuestion} 分钟，每分约 ${perPoint} 分钟` +
      (durationOk ? "" : reasonOf("duration") ? `；已填写覆盖理由：${reasonOf("duration")}` : ""),
    "warning",
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
      scopeCount > 0
        ? `覆盖 ${scopeCount} 个名单组，共 ${covered} 名答题者`
        : "尚未选择考试名单组，名单为空时不可发布",
    );
  } else {
    push(
      "open",
      "开放范围已配置",
      true,
      paper.scope.length > 0 ? `限定 ${paper.scope.length} 个名单组` : "全员开放",
    );
  }

  const failed = checks.filter((c) => !c.ok && c.level === "error").length;
  const warnings = checks.filter((c) => !c.ok && c.level === "warning").length;
  return { ok: failed === 0, kind, id, checks, failed, warnings, total: checks.length };
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

/** 清掉某份练习的成绩（原型「重置练习」会 delete store.state.practiceResults[key]）。 */
export function clearPracticeResult(practiceId: string, studentId: string): void {
  const state = useCatalog.getState();
  const key = `${practiceId}:${studentId}`;
  if (!(key in state.practiceResults)) return;
  const next = { ...state.practiceResults };
  delete next[key];
  useCatalog.setState({ practiceResults: next });
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
