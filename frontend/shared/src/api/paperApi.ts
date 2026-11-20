/* ==========================================================================
   知行测评 · 试卷（卷对象）的后端读写
   --------------------------------------------------------------------------
   试卷与练习在服务端是同一个「卷对象」（`kind` 区分），流程是：
   建卷 → 选题配分 → 设卷型 → 校验 → 发布。

   四处口径要注意（页面不知道，数据通路知道）：

   1. **题序规则**：服务端存 `by_type` / `manual`，前端叫「按题型分块 / 按选题顺序」。
   2. **卷型**：服务端存 `standard` / `small_plum` / `large_plum`。
   3. **答案公布时机**：服务端存 `immediately` / `after_submit` / `after_close`。
   4. **名单与开放时间不在试卷上**：它们属于**场次**（`/exam-sessions`）——
      试卷只管内容，场次才管谁在什么时候考。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { httpClient } from "./httpClient";

/** 试卷接口所需的客户端。 */
export type PaperClient = Pick<typeof httpClient, "get" | "post" | "put" | "delete">;

type Dto = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/* ------------------------------------------------------------------ 摘要 */

/** 试卷摘要。 */
export interface AdminPaperSummary {
  id: string;
  /** `exam` 考试卷 / `practice` 练习卷。 */
  kind: string;
  kindLabel: string;
  name: string;
  /** 考试批次。 */
  batch: string;
  /** 说明。 */
  description: string;
  /** `draft` / `published` / `archived`。 */
  status: string;
  statusLabel: string;
  /** 目标总分。 */
  targetTotalScore: number;
  /** 题位分值之和。 */
  totalItemScore: number;
  durationMinutes: number;
  passScore: number | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string | null;
}

/** 试卷题位。 */
export interface AdminPaperItem {
  id: string;
  questionId: string;
  score: number;
  sortOrder: number;
  sectionId: string | null;
}

/** 试卷详情。 */
export interface AdminPaperDetail {
  paper: AdminPaperSummary;
  items: AdminPaperItem[];
  /** 大题分组。 */
  sections: Array<{ id: string; title: string; instructions: string; sortOrder: number }>;
  tagIds: string[];
  /** `by_type` / `manual`。 */
  orderRule: string;
  /** `standard` / `small_plum` / `large_plum`。 */
  variantRule: string;
  /** `immediately` / `after_submit` / `after_close`。 */
  answerPolicy: string;
  allowRetake: boolean;
  retakeKeepsBest: boolean;
  note: string;
  examRules: Record<string, unknown> | null;
  practiceRules: Record<string, unknown> | null;
  publishedSnapshotId: string | null;
}

/** 试卷摘要 DTO → 前端口径。 */
export function toPaperSummary(dto: Dto): AdminPaperSummary {
  return {
    id: str(dto.id),
    kind: str(dto.kind, "exam"),
    kindLabel: str(dto.kindLabel),
    name: str(dto.name),
    batch: str(dto.batch),
    description: str(dto.description),
    status: str(dto.status, "draft"),
    statusLabel: str(dto.statusLabel),
    targetTotalScore: num(dto.targetTotalScore),
    totalItemScore: num(dto.totalItemScore),
    durationMinutes: num(dto.durationMinutes),
    passScore: dto.passScore === null || dto.passScore === undefined ? null : num(dto.passScore),
    itemCount: num(dto.itemCount),
    createdAt: str(dto.createdAt),
    updatedAt: dto.updatedAt ? str(dto.updatedAt) : null,
  };
}

/** 试卷详情 DTO → 前端口径。 */
export function toPaperDetail(dto: Dto): AdminPaperDetail {
  const paper = toPaperSummary((dto.paper ?? {}) as Dto);
  const items: AdminPaperItem[] = Array.isArray(dto.items)
    ? (dto.items as Dto[]).map((item) => ({
        id: str(item.id),
        questionId: str(item.questionId),
        score: num(item.score),
        sortOrder: num(item.sortOrder),
        sectionId: item.sectionId === null || item.sectionId === undefined ? null : str(item.sectionId),
      }))
    : [];
  const sections = Array.isArray(dto.sections)
    ? (dto.sections as Dto[]).map((section) => ({
        id: str(section.id),
        title: str(section.title),
        instructions: str(section.instructions),
        sortOrder: num(section.sortOrder),
      }))
    : [];

  return {
    paper,
    items,
    sections,
    tagIds: numList(dto.tagIds),
    orderRule: str(dto.orderRule, "by_type"),
    variantRule: str(dto.variantRule, "standard"),
    answerPolicy: str(dto.answerPolicy, "after_close"),
    allowRetake: dto.allowRetake === true,
    retakeKeepsBest: dto.retakeKeepsBest !== false,
    note: str(dto.note),
    examRules: (dto.examRules ?? null) as Record<string, unknown> | null,
    practiceRules: (dto.practiceRules ?? null) as Record<string, unknown> | null,
    publishedSnapshotId:
      dto.publishedSnapshotId === null || dto.publishedSnapshotId === undefined
        ? null
        : str(dto.publishedSnapshotId),
  };
}

/* -------------------------------------------------------------- 发布校验 */

/** 发布校验的一项。 */
export interface PaperValidationItem {
  key: string;
  label: string;
  passed: boolean;
  /** `blocking` 阻断项 / `warning` 提醒项。 */
  severity: string;
  detail: string;
  /** 涉及的题目 ID。 */
  targets: string[];
}

/** 发布校验结果。 */
export interface PaperValidation {
  items: PaperValidationItem[];
  /** 能否发布（阻断项全过即可，警告项可覆盖）。 */
  canPublish: boolean;
  hasBlockingFailure: boolean;
}

/** 发布校验 DTO → 前端口径。 */
export function toPaperValidation(dto: Dto): PaperValidation {
  const items: PaperValidationItem[] = Array.isArray(dto.items)
    ? (dto.items as Dto[]).map((item) => ({
        key: str(item.key),
        label: str(item.label),
        passed: item.passed === true,
        severity: str(item.severity, "blocking"),
        detail: str(item.detail),
        targets: numList(item.targets),
      }))
    : [];
  return {
    items,
    canPublish: dto.canPublish === true,
    hasBlockingFailure: dto.hasBlockingFailure === true,
  };
}

/* ------------------------------------------------------------------ 卷面 */

/** 派生卷面里的一道题。 */
export interface PaperVariantItem {
  questionId: string;
  questionCode: string;
  type: string;
  typeLabel: string;
  stem: string;
  /** 选项按**显示顺序**给出。 */
  options: Array<{ key: string; text: string }>;
  score: number;
  sortOrder: number;
  sectionTitle: string;
}

/** 派生卷面。 */
export interface PaperVariant {
  variantKey: string;
  rule: string;
  ruleLabel: string;
  itemCount: number;
  totalScore: number;
  items: PaperVariantItem[];
}

/** 派生卷面 DTO → 前端口径。 */
export function toPaperVariant(dto: Dto): PaperVariant {
  const items: PaperVariantItem[] = Array.isArray(dto.items)
    ? (dto.items as Dto[]).map((item) => ({
        questionId: str(item.questionId),
        questionCode: str(item.questionCode),
        type: str(item.type),
        typeLabel: str(item.typeLabel),
        stem: str(item.stem),
        options: Array.isArray(item.options)
          ? (item.options as Dto[]).map((option) => ({
              key: str(option.key),
              text: str(option.text),
            }))
          : [],
        score: num(item.score),
        sortOrder: num(item.sortOrder),
        sectionTitle: str(item.sectionTitle),
      }))
    : [];
  return {
    variantKey: str(dto.variantKey),
    rule: str(dto.rule),
    ruleLabel: str(dto.ruleLabel),
    itemCount: num(dto.itemCount),
    totalScore: num(dto.totalScore),
    items,
  };
}

/* ------------------------------------------------------------------ 蓝图 */

/** 组卷规则。 */
export interface PaperBlueprintRules {
  tagIds: string[];
  includeDescendants: boolean;
  /** `any` / `all`。 */
  matchMode: string;
  /** 难度标签 ID → 配额。 */
  difficultyQuota: Record<string, number>;
  /** 题型 → 配额。 */
  typeQuota: Record<string, number>;
  targetTotalScore: number;
  /** `by_type` / `manual`。 */
  orderRule: string;
  /** `even` / `by_difficulty`。 */
  scoreAllocation: string;
}

/** 方案里的一道题。 */
export interface BlueprintItem {
  questionId: string;
  questionCode: string;
  type: string;
  typeLabel: string;
  score: number;
  difficultyTagId: string;
  difficulty: string;
  matchReason: string[];
  sortOrder: number;
}

/** 题池缺口。 */
export interface BlueprintShortfall {
  type: string;
  difficultyTagId: string;
  difficulty: string;
  required: number;
  available: number;
  reason: string;
}

/** 组卷方案。 */
export interface AdminBlueprint {
  id: string;
  paperId: string;
  seed: string;
  status: string;
  manualModified: boolean;
  rules: PaperBlueprintRules;
  items: BlueprintItem[];
  itemCount: number;
  totalScore: number;
  shortfalls: BlueprintShortfall[];
}

/** 方案与卷面的差异条目。 */
export interface BlueprintDiffItem {
  questionId: string;
  planScore: number | null;
  currentScore: number | null;
  reason: string;
}

/** 方案与卷面的差异。 */
export interface BlueprintDiff {
  added: BlueprintDiffItem[];
  removed: BlueprintDiffItem[];
  changed: BlueprintDiffItem[];
}

/** 抽题结果。 */
export interface BlueprintGeneration {
  blueprintId: string;
  status: string;
  seed: string;
  generatedItemCount: number;
  items: BlueprintItem[];
  totalScore: number;
  diff: BlueprintDiff;
}

function toBlueprintRules(dto: Dto): PaperBlueprintRules {
  const selector = (dto.tagSelector ?? {}) as Dto;
  const difficulty: Record<string, number> = {};
  for (const [key, value] of Object.entries((dto.difficultyQuota ?? {}) as Dto)) {
    difficulty[key] = num(value);
  }
  const type: Record<string, number> = {};
  for (const [key, value] of Object.entries((dto.typeQuota ?? {}) as Dto)) {
    type[key] = num(value);
  }
  return {
    tagIds: numList(selector.tagIds),
    includeDescendants: selector.includeDescendants === true,
    matchMode: str(selector.matchMode, "any"),
    difficultyQuota: difficulty,
    typeQuota: type,
    targetTotalScore: num(dto.targetTotalScore),
    orderRule: str(dto.orderRule, "by_type"),
    scoreAllocation: str(dto.scoreAllocation, "even"),
  };
}

function toBlueprintItems(value: unknown): BlueprintItem[] {
  if (!Array.isArray(value)) return [];
  return (value as Dto[]).map((item) => ({
    questionId: str(item.questionId),
    questionCode: str(item.questionCode),
    type: str(item.type),
    typeLabel: str(item.typeLabel),
    score: num(item.score),
    difficultyTagId: str(item.difficultyTagId),
    difficulty: str(item.difficulty),
    matchReason: Array.isArray(item.matchReason) ? item.matchReason.map((r) => str(r)) : [],
    sortOrder: num(item.sortOrder),
  }));
}

function toBlueprintShortfalls(value: unknown): BlueprintShortfall[] {
  if (!Array.isArray(value)) return [];
  return (value as Dto[]).map((item) => ({
    type: str(item.type),
    difficultyTagId: str(item.difficultyTagId),
    difficulty: str(item.difficulty),
    required: num(item.required),
    available: num(item.available),
    reason: str(item.reason),
  }));
}

/** 组卷方案 DTO → 前端口径。 */
export function toBlueprint(dto: Dto): AdminBlueprint {
  return {
    id: str(dto.id),
    paperId: str(dto.paperId),
    seed: str(dto.seed),
    status: str(dto.status),
    manualModified: dto.manualModified === true,
    rules: toBlueprintRules((dto.rules ?? {}) as Dto),
    items: toBlueprintItems(dto.items),
    itemCount: num(dto.itemCount),
    totalScore: num(dto.totalScore),
    shortfalls: toBlueprintShortfalls(dto.shortfalls),
  };
}

/** 差异 DTO → 前端口径。 */
export function toBlueprintDiff(dto: Dto): BlueprintDiff {
  const read = (value: unknown): BlueprintDiffItem[] =>
    Array.isArray(value)
      ? (value as Dto[]).map((item) => ({
          questionId: str(item.questionId),
          planScore: item.planScore === null || item.planScore === undefined ? null : num(item.planScore),
          currentScore:
            item.currentScore === null || item.currentScore === undefined ? null : num(item.currentScore),
          reason: str(item.reason),
        }))
      : [];
  return {
    added: read(dto.added),
    removed: read(dto.removed),
    changed: read(dto.changed),
  };
}

/* ------------------------------------------------------------------ 模板 */

/** 卷型模板摘要。 */
export interface AdminPaperTemplate {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  variantRule: string;
  variantRuleLabel: string;
  durationMinutes: number;
  passScore: number | null;
  itemCount: number;
  totalScore: number;
  sourcePaperId: string | null;
  createdAt: string;
}

/** 卷型模板详情。 */
export interface AdminPaperTemplateDetail {
  template: AdminPaperTemplate;
  items: Array<{ questionId: string; score: number; sortOrder: number }>;
}

/** 模板摘要 DTO → 前端口径。 */
export function toPaperTemplate(dto: Dto): AdminPaperTemplate {
  return {
    id: str(dto.id),
    name: str(dto.name),
    kind: str(dto.kind, "exam"),
    kindLabel: str(dto.kindLabel),
    variantRule: str(dto.variantRule, "standard"),
    variantRuleLabel: str(dto.variantRuleLabel),
    durationMinutes: num(dto.durationMinutes),
    passScore: dto.passScore === null || dto.passScore === undefined ? null : num(dto.passScore),
    itemCount: num(dto.itemCount),
    totalScore: num(dto.totalScore),
    sourcePaperId:
      dto.sourcePaperId === null || dto.sourcePaperId === undefined ? null : str(dto.sourcePaperId),
    createdAt: str(dto.createdAt),
  };
}

/** 模板详情 DTO → 前端口径。 */
export function toPaperTemplateDetail(dto: Dto): AdminPaperTemplateDetail {
  const items = Array.isArray(dto.items)
    ? (dto.items as Dto[]).map((item) => ({
        questionId: str(item.questionId),
        score: num(item.score),
        sortOrder: num(item.sortOrder),
      }))
    : [];
  return {
    template: toPaperTemplate((dto.template ?? {}) as Dto),
    items,
  };
}

/* ------------------------------------------------------------------ 接口 */

/** 读取试卷列表。 */
export async function loadPapers(
  params: {
    kind?: string | undefined;
    status?: string | undefined;
    keyword?: string | undefined;
    page?: number | undefined;
    size?: number | undefined;
  } = {},
  client: PaperClient = httpClient,
): Promise<{ items: AdminPaperSummary[]; total: number }> {
  const res = await client.get<{ items?: Dto[]; total?: number }>(ENDPOINTS.catalog.papers, {
    query: {
      page: params.page ?? 1,
      size: params.size ?? 50,
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.keyword ? { keyword: params.keyword } : {}),
    },
  });
  const items = (res.items ?? []).map(toPaperSummary);
  return { items, total: num(res.total, items.length) };
}

/** 读取试卷详情。 */
export async function loadPaper(
  id: string,
  client: PaperClient = httpClient,
): Promise<AdminPaperDetail> {
  const res = await client.get<Dto>(`${ENDPOINTS.catalog.papers}/${id}`);
  return toPaperDetail(res);
}

/** 试卷的写入内容。 */
export interface PaperWriteInput {
  /** `exam` / `practice`；修改时不用给。 */
  kind?: string | undefined;
  name: string;
  batch?: string | null | undefined;
  description?: string | null | undefined;
  targetTotalScore: number;
  durationMinutes: number;
  passScore?: number | null | undefined;
  note?: string | null | undefined;
  tagIds: string[];
  orderRule: string;
  variantRule: string;
  answerPolicy: string;
  allowRetake: boolean;
  retakeKeepsBest: boolean;
  examRules?: Record<string, unknown> | null | undefined;
  practiceRules?: Record<string, unknown> | null | undefined;
}

function toPaperBody(input: PaperWriteInput): Record<string, unknown> {
  return {
    ...(input.kind ? { kind: input.kind } : {}),
    name: input.name,
    batch: input.batch ?? null,
    description: input.description ?? null,
    targetTotalScore: input.targetTotalScore,
    durationMinutes: input.durationMinutes,
    passScore: input.passScore ?? null,
    note: input.note ?? null,
    tagIds: input.tagIds.map(Number),
    orderRule: input.orderRule,
    variantRule: input.variantRule,
    answerPolicy: input.answerPolicy,
    allowRetake: input.allowRetake,
    retakeKeepsBest: input.retakeKeepsBest,
    examRules: input.examRules ?? null,
    practiceRules: input.practiceRules ?? null,
  };
}

/** 新建试卷（新建一律是草稿）。 */
export async function createPaper(
  input: PaperWriteInput,
  client: PaperClient = httpClient,
): Promise<AdminPaperDetail> {
  const res = await client.post<Dto>(ENDPOINTS.catalog.papers, toPaperBody(input));
  return toPaperDetail(res);
}

/** 修改试卷。 */
export async function updatePaper(
  id: string,
  input: PaperWriteInput,
  client: PaperClient = httpClient,
): Promise<AdminPaperDetail> {
  const res = await client.put<Dto>(`${ENDPOINTS.catalog.papers}/${id}`, toPaperBody(input));
  return toPaperDetail(res);
}

/** 删除试卷（只有草稿可删）。 */
export async function deletePaper(id: string, client: PaperClient = httpClient): Promise<void> {
  await client.delete(`${ENDPOINTS.catalog.papers}/${id}`);
}

/** 整体替换题位集合。 */
export async function replacePaperItems(
  id: string,
  items: Array<{ questionId: string; score: number; sortOrder: number }>,
  client: PaperClient = httpClient,
): Promise<AdminPaperDetail> {
  const res = await client.put<Dto>(`${ENDPOINTS.catalog.papers}/${id}/items`, {
    items: items.map((item) => ({
      questionId: Number(item.questionId),
      score: item.score,
      sortOrder: item.sortOrder,
    })),
  });
  return toPaperDetail(res);
}

/** 追加题位。 */
export async function addPaperItem(
  id: string,
  input: { questionId: string; score: number; sortOrder?: number },
  client: PaperClient = httpClient,
): Promise<AdminPaperDetail> {
  const res = await client.post<Dto>(`${ENDPOINTS.catalog.papers}/${id}/items`, {
    questionId: Number(input.questionId),
    score: input.score,
    sortOrder: input.sortOrder ?? null,
  });
  return toPaperDetail(res);
}

/** 调整题位分值与顺序。 */
export async function updatePaperItem(
  id: string,
  itemId: string,
  input: { score?: number; sortOrder?: number },
  client: PaperClient = httpClient,
): Promise<AdminPaperDetail> {
  const res = await client.put<Dto>(`${ENDPOINTS.catalog.papers}/${id}/items/${itemId}`, {
    score: input.score ?? null,
    sortOrder: input.sortOrder ?? null,
  });
  return toPaperDetail(res);
}

/** 移除题位。 */
export async function removePaperItem(
  id: string,
  itemId: string,
  client: PaperClient = httpClient,
): Promise<AdminPaperDetail> {
  const res = await client.delete<Dto>(`${ENDPOINTS.catalog.papers}/${id}/items/${itemId}`);
  return toPaperDetail(res);
}

/** 发布校验（不改变试卷状态）。 */
export async function validatePaper(
  id: string,
  client: PaperClient = httpClient,
): Promise<PaperValidation> {
  const res = await client.post<Dto>(`${ENDPOINTS.catalog.papers}/${id}/validate`);
  return toPaperValidation(res);
}

/** 发布试卷。警告项需要给出覆盖理由。 */
export async function publishPaper(
  id: string,
  warningOverrideReason?: string,
  client: PaperClient = httpClient,
): Promise<AdminPaperDetail> {
  const res = await client.post<Dto>(`${ENDPOINTS.catalog.papers}/${id}/publish`, {
    warningOverrideReason: warningOverrideReason ?? null,
  });
  return toPaperDetail(res);
}

/** 撤回发布（回到草稿，快照保留）。 */
export async function unpublishPaper(
  id: string,
  client: PaperClient = httpClient,
): Promise<AdminPaperDetail> {
  const res = await client.post<Dto>(`${ENDPOINTS.catalog.papers}/${id}/unpublish`);
  return toPaperDetail(res);
}

/** 预览某位答题者实际拿到的卷面。试卷未发布时服务端会拒绝。 */
export async function previewPaper(
  id: string,
  studentKey?: string,
  client: PaperClient = httpClient,
): Promise<PaperVariant> {
  const res = await client.get<Dto>(`${ENDPOINTS.catalog.papers}/${id}/preview`, {
    query: studentKey ? { studentKey } : {},
  });
  return toPaperVariant(res);
}

/* ------------------------------------------------------------------ 快照 */

/**
 * 快照摘要（版本列表里的一行）。
 *
 * 快照是**发布时冻结的一份卷面**：发布一次就是个版本，
 * 之后改卷不影响已经发出去的版本。
 */
export interface PaperSnapshotSummary {
  id: string;
  paperId: string;
  /** 版本号（从 1 起）。 */
  version: number;
  /** 内容指纹：同一份内容算出来的哈希。 */
  contentHash: string;
  /** 这一版有多少道题。 */
  itemCount: number;
  /** 这一版的总分。 */
  totalScore: number;
  createdAt: string;
  createdBy: string | null;
}

/** 快照里的一道题（冻结内容）。 */
export interface PaperSnapshotItem {
  id: string;
  questionId: string;
  questionCode: string;
  questionType: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  /** 冻结的正确答案键。 */
  correctKeys: string[];
  keypoints: Array<{ text: string; keywords: string[] }>;
  steps: Array<{
    code: string;
    prompt: string;
    referenceAnswer: string | null;
    keywords: string[];
    score: number;
  }>;
  analysis: string | null;
  referenceAnswer: string | null;
  attachments: Array<{
    objectKey: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }>;
  score: number;
  sortOrder: number;
  sectionTitle: string | null;
}

/** 快照详情。 */
export interface PaperSnapshotDetail extends PaperSnapshotSummary {
  items: PaperSnapshotItem[];
}

/** 快照摘要 DTO → 前端口径。 */
function toPaperSnapshotSummary(dto: Dto): PaperSnapshotSummary {
  return {
    id: str(dto.id),
    paperId: str(dto.paperId),
    version: num(dto.version),
    contentHash: str(dto.contentHash),
    itemCount: num(dto.itemCount),
    totalScore: num(dto.totalScore),
    createdAt: str(dto.createdAt),
    createdBy: dto.createdBy === null || dto.createdBy === undefined ? null : str(dto.createdBy),
  };
}

/** 快照里的题目 DTO → 前端口径。 */
function toPaperSnapshotItem(dto: Dto): PaperSnapshotItem {
  return {
    id: str(dto.id),
    questionId: str(dto.questionId),
    questionCode: str(dto.questionCode),
    questionType: str(dto.questionType),
    stem: str(dto.stem),
    options: Array.isArray(dto.options)
      ? (dto.options as Dto[]).map((option) => ({
          key: str(option.key),
          text: str(option.text),
        }))
      : [],
    correctKeys: numList(dto.correctKeys),
    keypoints: Array.isArray(dto.keypoints)
      ? (dto.keypoints as Dto[]).map((point) => ({
          text: str(point.text),
          keywords: numList(point.keywords),
        }))
      : [],
    steps: Array.isArray(dto.steps)
      ? (dto.steps as Dto[]).map((step) => ({
          code: str(step.code),
          prompt: str(step.prompt),
          referenceAnswer:
            step.referenceAnswer === null || step.referenceAnswer === undefined
              ? null
              : str(step.referenceAnswer),
          keywords: numList(step.keywords),
          score: num(step.score),
        }))
      : [],
    analysis: dto.analysis === null || dto.analysis === undefined ? null : str(dto.analysis),
    referenceAnswer:
      dto.referenceAnswer === null || dto.referenceAnswer === undefined
        ? null
        : str(dto.referenceAnswer),
    attachments: Array.isArray(dto.attachments)
      ? (dto.attachments as Dto[]).map((attachment) => ({
          objectKey: str(attachment.objectKey),
          fileName: str(attachment.fileName),
          contentType: str(attachment.contentType),
          sizeBytes: num(attachment.sizeBytes),
        }))
      : [],
    score: num(dto.score),
    sortOrder: num(dto.sortOrder),
    sectionTitle:
      dto.sectionTitle === null || dto.sectionTitle === undefined ? null : str(dto.sectionTitle),
  };
}

/** 快照详情 DTO → 前端口径。 */
function toPaperSnapshotDetail(dto: Dto): PaperSnapshotDetail {
  return {
    ...toPaperSnapshotSummary(dto),
    items: Array.isArray(dto.items) ? (dto.items as Dto[]).map(toPaperSnapshotItem) : [],
  };
}

/**
 * 读取试卷的版本快照列表（新版本在前）。
 *
 * 快照里冻结着正确答案与解析，所以这个接口要的是 `paper:write`——
 * 只有出题的人能看。
 */
export async function loadPaperSnapshots(
  id: string,
  client: PaperClient = httpClient,
): Promise<PaperSnapshotSummary[]> {
  const res = await client.get<{ items?: Dto[] }>(
    `${ENDPOINTS.catalog.papers}/${id}/snapshots`,
  );
  return (res.items ?? []).map(toPaperSnapshotSummary);
}

/** 取回指定版本的快照。 */
export async function loadPaperSnapshot(
  id: string,
  version: number,
  client: PaperClient = httpClient,
): Promise<PaperSnapshotDetail> {
  const res = await client.get<Dto>(`${ENDPOINTS.catalog.papers}/${id}/snapshots/${version}`);
  return toPaperSnapshotDetail(res);
}

/** 取回最新一版快照。 */
export async function loadLatestPaperSnapshot(
  id: string,
  client: PaperClient = httpClient,
): Promise<PaperSnapshotDetail> {
  const res = await client.get<Dto>(`${ENDPOINTS.catalog.papers}/${id}/snapshots/latest`);
  return toPaperSnapshotDetail(res);
}

/** 取回试卷的组卷方案。 */
export async function loadBlueprint(
  id: string,
  client: PaperClient = httpClient,
): Promise<AdminBlueprint> {
  const res = await client.get<Dto>(`${ENDPOINTS.catalog.papers}/${id}/blueprint`);
  return toBlueprint(res);
}

/** 保存组卷规则。 */
export async function saveBlueprint(
  id: string,
  input: { seed: string; rules: PaperBlueprintRules },
  client: PaperClient = httpClient,
): Promise<AdminBlueprint> {
  const res = await client.put<Dto>(`${ENDPOINTS.catalog.papers}/${id}/blueprint`, {
    seed: input.seed,
    rules: {
      tagIds: input.rules.tagIds.map(Number),
      includeDescendants: input.rules.includeDescendants,
      matchMode: input.rules.matchMode,
      difficultyQuota: Object.fromEntries(
        Object.entries(input.rules.difficultyQuota).map(([key, value]) => [Number(key), value]),
      ),
      typeQuota: input.rules.typeQuota,
      targetTotalScore: input.rules.targetTotalScore,
      orderRule: input.rules.orderRule,
      scoreAllocation: input.rules.scoreAllocation,
    },
  });
  return toBlueprint(res);
}

/** 执行抽题。题池不足时服务端返回 422 并逐条列出缺口。 */
export async function generateBlueprint(
  id: string,
  client: PaperClient = httpClient,
): Promise<BlueprintGeneration> {
  const res = await client.post<Dto>(`${ENDPOINTS.catalog.papers}/${id}/blueprint/generate`);
  return {
    blueprintId: str(res.blueprintId),
    status: str(res.status),
    seed: str(res.seed),
    generatedItemCount: num(res.generatedItemCount),
    items: toBlueprintItems(res.items),
    totalScore: num(res.totalScore),
    diff: toBlueprintDiff((res.diff ?? {}) as Dto),
  };
}

/** 方案与试卷当前题位的差异。 */
export async function loadBlueprintDiff(
  id: string,
  client: PaperClient = httpClient,
): Promise<BlueprintDiff> {
  const res = await client.get<Dto>(`${ENDPOINTS.catalog.papers}/${id}/blueprint/diff`);
  return toBlueprintDiff(res);
}

/** 读取卷型模板列表。 */
export async function loadPaperTemplates(
  params: { kind?: string | undefined; page?: number | undefined; size?: number | undefined } = {},
  client: PaperClient = httpClient,
): Promise<{ items: AdminPaperTemplate[]; total: number }> {
  const res = await client.get<{ items?: Dto[]; total?: number }>(
    ENDPOINTS.catalog.paperTemplates,
    {
      query: {
        page: params.page ?? 1,
        size: params.size ?? 50,
        ...(params.kind ? { kind: params.kind } : {}),
      },
    },
  );
  const items = (res.items ?? []).map(toPaperTemplate);
  return { items, total: num(res.total, items.length) };
}

/** 把当前试卷存成卷型模板。 */
export async function createPaperTemplate(
  input: { paperId: string; name: string },
  client: PaperClient = httpClient,
): Promise<AdminPaperTemplateDetail> {
  const res = await client.post<Dto>(ENDPOINTS.catalog.paperTemplates, {
    paperId: Number(input.paperId),
    name: input.name,
  });
  return toPaperTemplateDetail(res);
}

/** 把模板套用到目标试卷。 */
export async function applyPaperTemplate(
  templateId: string,
  paperId: string,
  client: PaperClient = httpClient,
): Promise<{
  templateId: string;
  paperId: string;
  appliedCount: number;
  skippedCount: number;
  totalScore: number;
  skipped: Array<{ questionId: string; code: string; reason: string }>;
  paper: AdminPaperDetail;
}> {
  const res = await client.post<Dto>(
    `${ENDPOINTS.catalog.paperTemplates}/${templateId}/apply`,
    { paperId: Number(paperId) },
  );
  return {
    templateId: str(res.templateId),
    paperId: str(res.paperId),
    appliedCount: num(res.appliedCount),
    skippedCount: num(res.skippedCount),
    totalScore: num(res.totalScore),
    skipped: Array.isArray(res.skipped)
      ? (res.skipped as Dto[]).map((item) => ({
          questionId: str(item.questionId),
          code: str(item.code),
          reason: str(item.reason),
        }))
      : [],
    paper: toPaperDetail((res.paper ?? {}) as Dto),
  };
}
