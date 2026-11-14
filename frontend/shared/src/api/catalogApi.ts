/* ==========================================================================
   知行测评 · 内容目录的后端读取
   --------------------------------------------------------------------------
   把 `/api/v1/**` 的 DTO 映射成前端领域对象。两条约定：

   1. **ID 一律转字符串**：后端主键是数字，前端统一用字符串 ID
      （docs/design/06-frontend.md §14.3），映射只在这一层发生。
   2. **字段名容错**：后端 DTO 用 `tagIds` / `questionIds` 等复数形式，
      映射层同时接受单复数两种写法，避免后端微调字段就要改页面。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type {
  Bank,
  DifficultyLevel,
  ExamPaper,
  Practice,
  Question,
  Tag,
} from "../domain/types";

/** 分页响应。 */
interface Paged<T> {
  items: T[];
  total?: number;
}

/** 后端 DTO（宽松声明）。 */
type Dto = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 取 ID 数组（兼容 tagIds / tags、questionIds / questions）。 */
function ids(dto: Dto, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = dto[key];
    if (Array.isArray(value)) return value.map((v) => str(v));
  }
  return [];
}

/** 映射标签。 */
function toTag(dto: Dto): Tag {
  const group = str(dto.group, "domain") as Tag["group"];
  const level = dto.level === undefined || dto.level === null ? undefined : num(dto.level);
  const tag: Tag = { id: str(dto.id), name: str(dto.name), group };
  if (level) tag.level = level as DifficultyLevel;
  return tag;
}

/** 映射题目。 */
function toQuestion(dto: Dto): Question {
  const options = Array.isArray(dto.options)
        ? (dto.options as Dto[]).map((o) => ({ key: str(o.key), text: str(o.text) }))
        : undefined;
  const answer = Array.isArray(dto.answer) ? dto.answer.map((a) => str(a)) : [];
  const question: Question = {
    id: str(dto.id),
    type: str(dto.type, "single") as Question["type"],
    score: num(dto.score, 5),
    status: str(dto.status, "draft") as Question["status"],
    source: str(dto.source, "manual") as Question["source"],
    tags: ids(dto, "tagIds", "tags"),
    stem: str(dto.stem),
    answer,
    analysis: str(dto.analysis),
  };
  if (options && options.length > 0) question.options = options;
  return question;
}

/** 映射题库。 */
function toBank(dto: Dto): Bank {
  return {
    id: str(dto.id),
    name: str(dto.name),
    desc: str(dto.desc),
    tags: ids(dto, "tagIds", "tags"),
    questionIds: ids(dto, "questionIds", "questions"),
  };
}

/** 映射试卷。 */
function toExam(dto: Dto): ExamPaper {
  const items = Array.isArray(dto.items)
    ? (dto.items as Dto[]).map((item) => ({ qid: str(item.qid ?? item.questionId), score: num(item.score, 5) }))
    : [];
  const plum = (dto.plum ?? {}) as Dto;
  const exam: ExamPaper = {
    id: str(dto.id),
    name: str(dto.name),
    batch: str(dto.batch),
    tags: ids(dto, "tagIds", "tags"),
    durationMin: num(dto.durationMin, 60),
    totalScore: num(dto.totalScore, 100),
    passScore: num(dto.passScore, 60),
    openAt: str(dto.openAt),
    closeAt: str(dto.closeAt),
    status: str(dto.status, "draft") as ExamPaper["status"],
    published: bool(dto.published, str(dto.status, "draft") === "published"),
    allowRetake: bool(dto.allowRetake),
    publishAnswer: (str(dto.publishAnswer, "after_close") as ExamPaper["publishAnswer"]),
    scope: ids(dto, "scope", "scopeIds", "classIds"),
    questionIds: ids(dto, "questionIds", "questions"),
    items,
    orderRule: (str(dto.orderRule, "type") as ExamPaper["orderRule"]),
    plum: { mode: (str(plum.mode, "standard") as ExamPaper["plum"]["mode"]) },
    note: str(dto.note),
  };
  return exam;
}

/** 映射练习。 */
function toPractice(dto: Dto): Practice {
  const items = Array.isArray(dto.items)
    ? (dto.items as Dto[]).map((item) => ({ qid: str(item.qid ?? item.questionId), score: num(item.score, 5) }))
    : [];
  return {
    id: str(dto.id),
    name: str(dto.name),
    tags: ids(dto, "tagIds", "tags"),
    durationMin: num(dto.durationMin, 30),
    totalScore: num(dto.totalScore, items.reduce((sum, i) => sum + i.score, 0)),
    status: str(dto.status, "draft") as Practice["status"],
    published: bool(dto.published, str(dto.status, "draft") === "published"),
    scope: ids(dto, "scope", "scopeIds", "classIds"),
    repeats: num(dto.repeats, 0),
    feedback: (str(dto.feedback, "after_submit") as Practice["feedback"]),
    mistakeReflow: bool(dto.mistakeReflow, true),
    questionIds: ids(dto, "questionIds", "questions"),
    items,
    orderRule: (str(dto.orderRule, "type") as Practice["orderRule"]),
    note: str(dto.note),
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

/** 读一条分页列表（后端返回 { items, total }）。 */
async function fetchList<T>(path: string, map: (dto: Dto) => T): Promise<T[]> {
  const res = await httpClient.get<Paged<Dto> | Dto[]>(path, {
    query: { page: 1, size: 200 },
  });
  const items = Array.isArray(res) ? res : (res?.items ?? []);
  return items.map(map);
}

/** 读回整个内容目录。 */
export async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  const [tags, banks, questions, exams, practices] = await Promise.all([
    fetchList(ENDPOINTS.catalog.tags, toTag),
    fetchList(ENDPOINTS.catalog.banks, toBank),
    fetchList(ENDPOINTS.catalog.questions, toQuestion),
    fetchList(ENDPOINTS.catalog.papers, toExam),
    fetchList(ENDPOINTS.delivery.assignments, toPractice),
  ]);
  return { tags, banks, questions, exams, practices };
}
