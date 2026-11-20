/* ==========================================================================
   知行测评 · 试题导入批次
   --------------------------------------------------------------------------
   导入是三步：上传（服务端解析）→ 调整列映射（重新解析）→ 采纳为候选题。

   解析在**服务端**做：前端不再自己读文件算列——两边各算一套，
   管理员看到的预览与最终入库的题目就会对不上。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { httpClient } from "./httpClient";

/** 导入接口所需的客户端。 */
export type ImportClient = Pick<typeof httpClient, "get" | "post" | "put">;

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

/** 导入批次概览。 */
export interface ImportBatch {
  id: string;
  fileName: string;
  /** 文件类型（csv / xlsx）。 */
  fileType: string;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  adoptedCount: number;
  /** 列映射：字段名 → 文件里的列名。 */
  columnMapping: Record<string, string>;
  adoptedBy: string | null;
  adoptedAt: string | null;
  createdAt: string;
}

/** 导入的一行。 */
export interface ImportRow {
  rowNumber: number;
  valid: boolean;
  /** 错误明细。 */
  errors: string[];
  /** 解析出来的内容（服务端给的 JSON 文本）。 */
  parsed: string;
}

/** 导入批次详情：批次 + 逐行结果 + 文件表头。 */
export interface ImportBatchDetail {
  batch: ImportBatch;
  rows: ImportRow[];
  /** 文件表头：管理员按表头调列映射。 */
  headers: string[];
}

/** 采纳结果。 */
export interface ImportAdoptResult {
  batchId: string;
  status: string;
  /** 采纳了多少道候选题。 */
  adopted: number;
  /** 跳过的行与原因。 */
  failures: Array<{ rowNumber: number; reason: string }>;
  /** 重复采纳时为真。 */
  alreadyAdopted: boolean;
}

/** 导入批次 DTO → 前端口径。 */
export function toImportBatch(dto: Dto): ImportBatch {
  const mapping = (dto.columnMapping ?? {}) as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping)) normalized[key] = str(value);

  return {
    id: str(dto.id),
    fileName: str(dto.fileName),
    fileType: str(dto.fileType),
    status: str(dto.status),
    totalRows: num(dto.totalRows),
    validRows: num(dto.validRows),
    invalidRows: num(dto.invalidRows),
    adoptedCount: num(dto.adoptedCount),
    columnMapping: normalized,
    adoptedBy: dto.adoptedBy === null || dto.adoptedBy === undefined ? null : str(dto.adoptedBy),
    adoptedAt: dto.adoptedAt ? str(dto.adoptedAt) : null,
    createdAt: str(dto.createdAt),
  };
}

/** 读取导入批次列表（看板上的「最近生产批次」）。 */
export async function loadImportBatches(
  params: { page?: number | undefined; size?: number | undefined } = {},
  client: ImportClient = httpClient,
): Promise<{ items: ImportBatch[]; total: number }> {
  const res = await client.get<{ items?: Record<string, unknown>[]; total?: number }>(
    ENDPOINTS.catalog.imports,
    { query: { page: params.page ?? 1, size: params.size ?? 20 } },
  );
  const items = (res.items ?? []).map(toImportBatch);
  return { items, total: num(res.total, items.length) };
}

/**
 * 读取导入批次详情（含逐行结果与文件表头）。
 *
 * 上传后拿到的是**当次**的详情；过一阵再回来看这个批次，
 * 要靠这个接口重新取——批次的逐行结果存在服务端，不在前端手里。
 */
export async function loadImportBatch(
  id: string,
  client: ImportClient = httpClient,
): Promise<ImportBatchDetail> {
  const res = await client.get<Dto>(`${ENDPOINTS.catalog.imports}/${id}`);
  return toImportBatchDetail(res);
}

/** 上传试题文件并解析（服务端给出列映射建议与逐行结果）。 */
export async function uploadImportBatch(
  file: File,
  client: ImportClient = httpClient,
): Promise<ImportBatchDetail> {
  const form = new FormData();
  form.append("file", file, file.name);

  const res = await client.post<Dto>(ENDPOINTS.catalog.imports, form);
  return toImportBatchDetail(res);
}

/** 调整列映射并重新解析。 */
export async function updateImportMapping(
  id: string,
  mapping: Record<string, string>,
  client: ImportClient = httpClient,
): Promise<ImportBatchDetail> {
  const res = await client.put<Dto>(`${ENDPOINTS.catalog.imports}/${id}/mapping`, { mapping });
  return toImportBatchDetail(res);
}

/** 采纳批次为候选题（草稿）。重复采纳是幂等的。 */
export async function adoptImportBatch(
  id: string,
  client: ImportClient = httpClient,
): Promise<ImportAdoptResult> {
  const res = await client.post<{
    batchId?: number;
    status?: string;
    adopted?: number;
    failures?: Array<{ rowNumber?: number; reason?: string }>;
    alreadyAdopted?: boolean;
  }>(`${ENDPOINTS.catalog.imports}/${id}/adopt`);

  return {
    batchId: str(res.batchId, id),
    status: str(res.status),
    adopted: num(res.adopted),
    failures: (res.failures ?? []).map((f) => ({
      rowNumber: num(f.rowNumber),
      reason: str(f.reason),
    })),
    alreadyAdopted: res.alreadyAdopted === true,
  };
}

/** 导入批次详情 DTO → 前端口径。 */
export function toImportBatchDetail(dto: Dto): ImportBatchDetail {
  return {
    batch: toImportBatch((dto.batch ?? {}) as Dto),
    headers: Array.isArray(dto.headers) ? dto.headers.map((h) => str(h)) : [],
    rows: Array.isArray(dto.rows)
      ? (dto.rows as Dto[]).map((row) => ({
          rowNumber: num(row.rowNumber),
          valid: row.valid === true,
          errors: Array.isArray(row.errors)
            ? (row.errors as Array<unknown>).map((e) =>
                typeof e === "string" ? e : str((e as Dto)?.message ?? (e as Dto)?.reason),
              )
            : [],
          parsed: str(row.parsed),
        }))
      : [],
  };
}
