/* ==========================================================================
   知行测评 · 内容目录的后端读取
   --------------------------------------------------------------------------
   把 `/api/v1/**` 的 DTO 映射成前端领域对象。约定：

   1. **ID 一律转字符串**：后端主键是数字，前端统一用字符串 ID
      （docs/design/06-frontend.md §14.3），映射只在这一层发生。
   2. **只映射真实存在的字段**：列表 DTO 不返回题目选项/答案/解析、
      试卷摘要不返回题位，缺少的部分留空字段，绝不臆造。
      需要完整内容时按 id 调详情接口（试卷在加载目录时已补详情）。
   3. 枚举值做**存储值 → 前端口径**的转换（如 `answerPolicy: immediately`
      → `on_open`），转换表集中在各映射函数里。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type { Bank, ExamPaper, PaperMode, Practice, Question, Tag } from "../domain/types";

/** 分页响应。 */
interface Paged<T> {
  items?: T[];
  total?: number;
}

/** 后端 DTO（宽松声明；字段以 OpenAPI 契约为准）。 */
type Dto = Record<string, unknown>;

/** 目录读取所需的最小客户端接口（便于端到端测试注入自定义基地址）。 */
export type CatalogClient = Pick<typeof httpClient, "get">;

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 取 ID 数组（兼容 tagIds / tags）。 */
function ids(dto: Dto, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = dto[key];
    if (Array.isArray(value)) return value.map((v) => str(v));
  }
  return [];
}

/** 映射标签（TagDto）。 */
function toTag(dto: Dto): Tag {
  const group = str(dto.group, "domain") as Tag["group"];
  const tag: Tag = { id: str(dto.id), name: str(dto.name), group };
  const level = num(dto.level, 0);
  if (level === 1 || level === 2 || level === 3) tag.level = level;
  return tag;
}

/**
 * 映射题目摘要（QuestionSummaryDto）。
 *
 * 列表接口按设计不返回选项、正确答案与解析（防泄题），
 * 因此这里 `options` 缺省、`answer` 为空数组、`analysis` 为空串。
 * 需要完整内容时走 `GET /questions/{id}`（QuestionDetailDto）。
 */
function toQuestion(dto: Dto): Question {
  return {
    id: str(dto.id),
    type: str(dto.type, "single") as Question["type"],
    score: num(dto.defaultScore, 5),
    status: str(dto.status, "draft") as Question["status"],
    source: str(dto.source, "manual") as Question["source"],
    tags: ids(dto, "tagIds"),
    stem: str(dto.stem),
    answer: [],
    analysis: "",
  };
}

/** 映射题库摘要（QuestionBankSummaryDto；接口不返回题目清单）。 */
function toBank(dto: Dto): Bank {
  return {
    id: str(dto.id),
    name: str(dto.name),
    desc: str(dto.description),
    tags: [],
    questionIds: [],
  };
}

/** 后端试卷状态 → 前端试卷状态。 */
function toPaperStatus(raw: string): ExamPaper["status"] {
  if (raw === "published") return "ongoing";
  if (raw === "archived") return "ended";
  return "draft";
}

/** 后端答案公布策略 → 前端口径。 */
function toPublishAnswer(raw: string): ExamPaper["publishAnswer"] {
  if (raw === "immediately") return "on_open";
  if (raw === "after_submit") return "after_submit";
  return "after_close";
}

/** 后端卷型规则 → 前端卷型。 */
export function toPaperMode(raw: string): PaperMode {
  if (raw === "small_plum") return "small";
  if (raw === "large_plum") return "large";
  return "standard";
}

/**
 * 映射试卷：摘要（PaperSummaryDto）+ 详情（PaperDetailDto，可选）。
 *
 * 题位、标签、卷型、答案策略只在详情里，加载目录时逐卷补详情；
 * 详情拉取失败则退回摘要，页面仍可展示名称/时长/总分等基本信息。
 */
function toExam(summary: Dto, detail: Dto | null): ExamPaper {
  const paper = (detail?.paper as Dto | undefined) ?? summary;
  const rawStatus = str(paper.status, "draft");

  const rawItems = Array.isArray(detail?.items) ? (detail.items as Dto[]) : [];
  const items = rawItems.map((item) => ({
    qid: str(item.questionId ?? item.qid),
    score: num(item.score, 5),
  }));

  return {
    id: str(paper.id),
    name: str(paper.name),
    batch: str(paper.batch),
    tags: ids(detail ?? {}, "tagIds"),
    durationMin: num(paper.durationMinutes, 60),
    totalScore: num(paper.targetTotalScore, 100),
    passScore: num(paper.passScore, 60),
    openAt: "",
    closeAt: "",
    status: toPaperStatus(rawStatus),
    published: rawStatus === "published",
    allowRetake: bool(detail?.allowRetake),
    publishAnswer: toPublishAnswer(str(detail?.answerPolicy, "after_close")),
    scope: [],
    questionIds: items.map((item) => item.qid),
    items,
    orderRule: str(detail?.orderRule, "by_type") === "manual" ? "manual" : "type",
    plum: { mode: toPaperMode(str(detail?.variantRule, "standard")) },
    note: str(detail?.note),
  };
}

/**
 * 映射练习（PracticeSummaryDto）。
 *
 * 该接口只返回练习摘要：标题、题量、总分、标签名与规则。
 * 题库外的题位要按 paperId 另取试卷详情，这里不额外发请求，
 * 因此 `items` / `questionIds` 为空。
 */
function toPractice(dto: Dto): Practice {
  const feedback = str(dto.feedbackTiming, "after_submit");
  return {
    id: str(dto.id),
    name: str(dto.title),
    tags: [],
    questionIds: [],
    items: [],
    durationMin: num(dto.suggestedMinutes, 30),
    totalScore: num(dto.totalScore),
    status: "published",
    published: true,
    scope: [],
    repeats: num(dto.maxAttempts),
    feedback: feedback === "immediate" ? "immediate" : "after_submit",
    mistakeReflow: bool(dto.reflowMistakes, true),
    orderRule: "type",
    note: "",
  };
}

/** 从后端读回的内容目录快照。 */
export interface CatalogSnapshot {
  tags: Tag[];
  banks: Bank[];
  questions: Question[];
  exams: ExamPaper[];
  practices: Practice[];
}

/** 读一条列表（后端可能返回 { items, total }，也可能直接返回数组）。 */
async function fetchList(
  client: CatalogClient,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<Dto[]> {
  const res = await client.get<Paged<Dto> | Dto[]>(path, {
    query: { page: 1, size: 200, ...query },
  });
  if (Array.isArray(res)) return res;
  return res.items ?? [];
}

/** 读标签：接口按维度分组返回 `{ groups: [{ group, tags }] }`。 */
async function fetchTags(client: CatalogClient): Promise<Tag[]> {
  interface TagGroupsDto {
    groups?: Array<{ group?: string; tags?: Dto[] }>;
  }

  const res = await client.get<TagGroupsDto | Dto[]>(ENDPOINTS.catalog.tags);
  if (Array.isArray(res)) return res.map(toTag);

  const tags: Tag[] = [];
  for (const group of res.groups ?? []) {
    // 组织维度标签只挂用户，不属于内容目录（前端 Tag 只有四个内容维度）。
    if (group.group === "organization") continue;
    for (const dto of group.tags ?? []) tags.push(toTag(dto));
  }
  return tags;
}

/** 读考试卷：列表 + 逐卷详情（题位/标签/卷型/答案策略在详情里）。 */
async function fetchExams(client: CatalogClient): Promise<ExamPaper[]> {
  const summaries = await fetchList(client, ENDPOINTS.catalog.papers, { kind: "exam" });
  const details = await Promise.all(
    summaries.map(async (summary) => {
      const id = str(summary.id);
      if (!id) return null;
      try {
        return await client.get<Dto>(`${ENDPOINTS.catalog.papers}/${id}`);
      } catch {
        return null;
      }
    }),
  );
  return summaries.map((summary, index) => toExam(summary, details[index] ?? null));
}

/** 单个来源不可用（例如学生无权读题库）不应拖垮整份目录。 */
async function optional<T>(task: Promise<T[]>): Promise<T[]> {
  try {
    return await task;
  } catch {
    return [];
  }
}

/**
 * 读回整个内容目录。可注入自定义客户端（端到端测试打真实后端时用）。
 *
 * 五个来源**互相独立**：某一类数据 403 / 网络失败只让该类为空，
 * 其余目录照常可用。学生角色没有 `bank:read`，题库列表必然是空。
 */
export async function loadCatalogSnapshot(
  client: CatalogClient = httpClient,
): Promise<CatalogSnapshot> {
  const [tags, banks, questions, exams, practices] = await Promise.all([
    optional(fetchTags(client)),
    optional(fetchList(client, ENDPOINTS.catalog.banks).then((items) => items.map(toBank))),
    optional(fetchList(client, ENDPOINTS.catalog.questions).then((items) => items.map(toQuestion))),
    optional(fetchExams(client)),
    optional(
      fetchList(client, ENDPOINTS.delivery.practices).then((items) => items.map(toPractice)),
    ),
  ]);
  return { tags, banks, questions, exams, practices };
}
