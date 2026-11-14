/* ==========================================================================
   知行测评 · 试题导入解析
   --------------------------------------------------------------------------
   按 FR-CAT-07 与「已确认决策 9」实现真实解析：

   - 文件：.csv（UTF-8，含/不含 BOM；GBK 兜底）与 .xlsx（读取首个工作表）
   - 三步：上传并**列映射**（可编辑）→ 解析预览（错误行标红并给出原因）
     → 采纳为候选题（draft + source=import + 关联批次号）

   **零依赖**：CSV 自己解析；XLSX 用浏览器内置的 `DecompressionStream`
   解 ZIP，再用 `DOMParser` 读 XML，不引入表格库。
   ========================================================================== */

import { decodeCsvBuffer, parseCsv } from "@exam/shared";
import type { ImportRow, QuestionOption, QuestionType } from "@exam/shared/domain/types";

/** 解析出的表格。 */
export interface ParsedTable {
  /** 表头（第一行）。 */
  headers: string[];
  /** 数据行（不含表头），每行与 headers 一一对应。 */
  rows: string[][];
}

/** 导入目标字段。 */
export interface ImportFieldDef {
  key: string;
  label: string;
  /** 是否必填。 */
  required: boolean;
  /** 表头自动匹配用的关键词。 */
  keywords: string[];
}

/** 可映射的目标字段（对应设计文档 §5.1 的列定义）。 */
export const IMPORT_FIELDS: readonly ImportFieldDef[] = [
  { key: "stem", label: "题干", required: true, keywords: ["题干", "题目", "stem", "question"] },
  { key: "type", label: "题型", required: true, keywords: ["题型", "类型", "type", "题目类型"] },
  { key: "options", label: "选项", required: false, keywords: ["选项", "option"] },
  { key: "answer", label: "答案", required: true, keywords: ["答案", "answer", "正确答案"] },
  { key: "analysis", label: "解析", required: false, keywords: ["解析", "analysis", "explanation"] },
  { key: "knowledge", label: "知识点", required: false, keywords: ["知识点", "knowledge", "标签", "tag"] },
  { key: "score", label: "分值", required: false, keywords: ["分值", "分数", "score", "point"] },
];

/** 题型取值（中英文标签都认）。 */
const TYPE_LABELS: Record<string, QuestionType> = {
  单选题: "single",
  单选: "single",
  single: "single",
  多选题: "multi",
  多选: "multi",
  multi: "multi",
  判断题: "judge",
  判断: "judge",
  judge: "judge",
  简答题: "short",
  简答: "short",
  short: "short",
  综合操作题: "comprehensive",
  综合题: "comprehensive",
  综合: "comprehensive",
  comprehensive: "comprehensive",
};

/** 难度标签（值 → 标签 ID）。 */
const DIFFICULTY_TAGS: Record<string, string> = {
  基础: "t-df1",
  中等: "t-df2",
  较难: "t-df3",
  "1": "t-df1",
  "2": "t-df2",
  "3": "t-df3",
  易: "t-df1",
  难: "t-df3",
};

/* --------------------------------------------------------------- CSV */

/** CSV 解析复用 shared 的实现（与人员名单导入同一套口径）。 */
export { parseCsv };

/* -------------------------------------------------------------- XLSX */

/** ZIP 中央目录条目。 */
interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** 读取 ZIP 中央目录。 */
function readZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // EOCD 记录在文件尾部（注释最长 65535 字节）。
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66_000); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 xlsx 文件（缺少 ZIP 结构）");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder("utf-8");

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 解压一个 ZIP 条目的内容。 */
async function readZipEntry(
  buffer: ArrayBuffer,
  entry: ZipEntry,
): Promise<ArrayBuffer> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (view.getUint32(entry.localOffset, true) !== 0x04034b50) {
    throw new Error(`ZIP 条目损坏：${entry.name}`);
  }
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return data.slice().buffer;
  if (entry.method !== 8) throw new Error(`不支持的压缩方式：${entry.method}`);

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).arrayBuffer();
}

/** 解析 XML 文本。 */
function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("xlsx 内部结构无法解析");
  }
  return doc;
}

/** 读 sharedStrings.xml，返回共享字符串数组。 */
function readSharedStrings(doc: Document): string[] {
  const out: string[] = [];
  for (const si of Array.from(doc.getElementsByTagName("si"))) {
    let text = "";
    for (const t of Array.from(si.getElementsByTagName("t"))) {
      text += t.textContent ?? "";
    }
    out.push(text);
  }
  return out;
}

/** 单元格引用（如 "B7"）→ 列索引。 */
function columnIndexOf(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** 读首个工作表，返回二维数组。 */
function readSheet(doc: Document, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of Array.from(doc.getElementsByTagName("row"))) {
    const cells: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const ref = cell.getAttribute("r") ?? "";
      const index = ref ? columnIndexOf(ref) : cells.length;
      const type = cell.getAttribute("t");
      let value = "";
      if (type === "s") {
        const v = cell.getElementsByTagName("v")[0]?.textContent ?? "";
        value = shared[Number(v)] ?? "";
      } else if (type === "inlineStr") {
        value = Array.from(cell.getElementsByTagName("t"))
          .map((t) => t.textContent ?? "")
          .join("");
      } else {
        value = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      }
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** 解析 xlsx（读取首个工作表）。 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const entries = readZipEntries(buffer);
  const sheetEntry = entries.find((e) => /^xl\/worksheets\/sheet1\.xml$/.test(e.name));
  if (!sheetEntry) throw new Error("xlsx 中没有找到首个工作表");

  let shared: string[] = [];
  const sharedEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  if (sharedEntry) {
    const xml = new TextDecoder("utf-8").decode(await readZipEntry(buffer, sharedEntry));
    shared = readSharedStrings(parseXml(xml));
  }

  const sheetXml = new TextDecoder("utf-8").decode(await readZipEntry(buffer, sheetEntry));
  return readSheet(parseXml(sheetXml), shared);
}

/** 解析上传的试题文件（.csv / .xlsx）。 */
export async function parseImportFile(file: File): Promise<ParsedTable> {
  const lower = file.name.toLowerCase();
  let grid: string[][];

  if (lower.endsWith(".xlsx")) {
    grid = await parseXlsx(await file.arrayBuffer());
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    grid = parseCsv(decodeCsvBuffer(await file.arrayBuffer()));
  } else {
    throw new Error("仅支持 .csv 与 .xlsx 试题文件");
  }

  const headers = (grid[0] ?? []).map((h, i) => h.trim() || `列${i + 1}`);
  const rows = grid.slice(1).map((r) => headers.map((_, i) => (r[i] ?? "").trim()));
  return { headers, rows };
}

/* --------------------------------------------------------- 列映射与解析 */

/** 列映射：目标字段 → 来源列名。 */
export type ColumnMapping = Record<string, string>;

/** 按表头自动猜测列映射。 */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find((header) => {
      const lower = header.toLowerCase();
      return field.keywords.some((kw) => lower.includes(kw.toLowerCase()));
    });
    if (hit) mapping[field.key] = hit;
  }
  return mapping;
}

/** 解析选项列：支持 "A. xxx|B. xxx"、"A、xxx"、"A=xxx" 与换行分隔。 */
export function parseOptions(text: string): QuestionOption[] {
  const source = text.trim();
  if (!source) return [];
  const parts = source.includes("|")
    ? source.split("|")
    : source.includes("\n")
      ? source.split(/\r?\n/)
      : source.split("；");
  const options: QuestionOption[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = /^([A-Ha-h])\s*[.、：:=|)）]\s*(.+)$/.exec(trimmed);
    if (match) {
      options.push({ key: match[1]!.toUpperCase(), text: match[2]!.trim() });
    } else {
      options.push({ key: String.fromCharCode(65 + options.length), text: trimmed });
    }
  }
  return options;
}

/** 解析答案列：支持 "AB"、"A B"、"A,B"、"正确/错误"。 */
export function parseAnswer(text: string, type: QuestionType): string[] {
  const source = text.trim();
  if (!source) return [];
  if (type === "judge") {
    if (source.includes("正确") || source.toUpperCase() === "T" || source === "对") return ["A"];
    if (source.includes("错误") || source.toUpperCase() === "F" || source === "错") return ["B"];
  }
  const letters = source
    .replace(/[^A-Ha-h]/g, "")
    .toUpperCase()
    .split("");
  return [...new Set(letters)];
}

/** 一行解析结果。 */
export interface ImportPreviewRow extends ImportRow {
  /** 错误原因（valid 为 false 时有值）。 */
  error?: string | undefined;
}

/**
 * 按列映射把原始行解析成候选题。
 *
 * 逐行校验：题干缺失、题型不认识、答案缺失等都在**该行**标红并给出原因，
 * 不阻断整批（FR-CAT-07 / FR-IAM-05 的同一口径）。
 */
export function buildImportRows(
  rawRows: readonly string[][],
  headers: readonly string[],
  mapping: ColumnMapping,
  knownTagIds: readonly string[] = [],
): ImportPreviewRow[] {
  const columnIndex = (field: string): number => {
    const name = mapping[field];
    if (!name) return -1;
    return headers.indexOf(name);
  };

  return rawRows.map((raw, index) => {
    const no = index + 1;
    const cell = (field: string): string => {
      const i = columnIndex(field);
      return i >= 0 ? (raw[i] ?? "") : "";
    };

    const stem = cell("stem").trim();
    const typeText = cell("type").trim();
    const type = TYPE_LABELS[typeText.toLowerCase()] ?? TYPE_LABELS[typeText];
    const scoreText = cell("score").trim();
    const score = scoreText ? Number(scoreText) : 5;
    const options = parseOptions(cell("options"));
    const answer = parseAnswer(cell("answer"), type ?? "single");
    const analysis = cell("analysis").trim();
    const knowledge = cell("knowledge").trim();

    const errors: string[] = [];
    if (!stem) errors.push("题干为空");
    if (!typeText) errors.push("未指定题型");
    else if (!type) errors.push(`题型「${typeText}」无法识别`);
    if (scoreText && (!Number.isFinite(score) || score < 1 || score > 40)) {
      errors.push("分值需在 1..40 之间");
    }
    if (type === "single" || type === "multi") {
      if (options.length < 2) errors.push("选择题至少需要两个选项");
      if (answer.length === 0) errors.push("答案为空");
      if (type === "single" && answer.length > 1) errors.push("单选题只能有一个正确选项");
      if (type === "multi" && answer.length < 2) errors.push("多选题至少需要两个正确选项");
      const keys = new Set(options.map((o) => o.key));
      if (answer.some((a) => !keys.has(a))) errors.push("答案包含不存在的选项");
    }

    // 知识点：能对上已有标签就挂上，对不上只记文本，不阻断导入。
    const tags: string[] = [];
    for (const name of knowledge.split(/[、,，;；\s]+/).filter(Boolean)) {
      const hit = knownTagIds.includes(name) ? name : null;
      if (hit && !tags.includes(hit)) tags.push(hit);
    }
    const difficulty = DIFFICULTY_TAGS[knowledge] ?? DIFFICULTY_TAGS[scoreText];
    if (difficulty && !tags.includes(difficulty)) tags.push(difficulty);

    const row: ImportPreviewRow = {
      no,
      stem,
      type: type ?? "single",
      score: Number.isFinite(score) && score >= 1 && score <= 40 ? score : 5,
      options,
      answer: type === "judge" ? answer.slice(0, 1) : answer,
      analysis,
      tags,
      valid: errors.length === 0,
      error: errors.length > 0 ? errors.join("；") : undefined,
    };
    return row;
  });
}
