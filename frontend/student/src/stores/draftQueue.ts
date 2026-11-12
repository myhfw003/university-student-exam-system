/* ==========================================================================
   知行测评 · 学生端本地持久层（L2 IndexedDB + L3 上行队列）
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §4.1：
     L2 IndexedDB 持久化 —— 表 attemptDraft
     L3 上行队列        —— 表 pendingBatches

   设计要点：
   1. 答案按 attemptId 整体存取，不按题拆行——一次读写即可恢复整个会话。
   2. 批次一旦创建就固定 clientSeq，重放不改变它，保证服务端幂等。
   3. 所有写入失败都不阻断 UI：本地存储不可用时降级为纯内存，不抛错。
   ========================================================================== */

import Dexie, { type Table } from "dexie";
import type { AnswerBatch, AnswerPayload } from "@exam/shared/domain/attempt";

/** L2：某次作答会话的本地草稿。 */
export interface AttemptDraft {
  /** 作答会话 ID（主键）。 */
  attemptId: string;
  /** 题号 → 答案载荷。 */
  answers: Record<string, AnswerPayload>;
  /** 标记「待检查」的题号。 */
  marked: number[];
  /** 当前所在题号。 */
  currentQuestionId: number | null;
  /** 已分配的最大 clientSeq。 */
  clientSeq: number;
  /** 草稿最后更新时间（ISO）。 */
  updatedAt: string;
}

/** L3：待上行的批次。 */
export interface PendingBatch {
  /** 自增主键。 */
  id?: number;
  /** 作答会话 ID。 */
  attemptId: string;
  /** 会话内单调递增的批次序号，从 1 开始。 */
  clientSeq: number;
  /** 批次内容。 */
  items: AnswerBatch["items"];
  /** 批次创建时间（ISO）。 */
  createdAt: string;
  /** 已重试次数。 */
  retries: number;
  /** 下次可重试时间（ISO）；未到点不重放。 */
  nextRetryAt: string | null;
}

/** 本地持久层数据库。 */
class ExamDraftDatabase extends Dexie {
  attemptDraft!: Table<AttemptDraft, string>;
  pendingBatches!: Table<PendingBatch, number>;

  constructor() {
    super("exam-draft");
    this.version(1).stores({
      attemptDraft: "attemptId",
      pendingBatches: "++id, attemptId, clientSeq, createdAt",
    });
  }
}

let db: ExamDraftDatabase | null = null;

/** 惰性获取数据库实例；IndexedDB 不可用时返回 null（调用方降级为内存态）。 */
function getDb(): ExamDraftDatabase | null {
  if (db) return db;
  if (typeof indexedDB === "undefined") return null;
  try {
    db = new ExamDraftDatabase();
    return db;
  } catch {
    return null;
  }
}

/** 内存降级存储：IndexedDB 不可用时兜底。 */
const memoryDrafts = new Map<string, AttemptDraft>();
const memoryBatches = new Map<number, PendingBatch>();
let memoryBatchId = 0;

/** 读取草稿；不存在返回 null。 */
export async function loadDraft(attemptId: string): Promise<AttemptDraft | null> {
  const database = getDb();
  if (!database) return memoryDrafts.get(attemptId) ?? null;
  try {
    return (await database.attemptDraft.get(attemptId)) ?? null;
  } catch {
    return memoryDrafts.get(attemptId) ?? null;
  }
}

/** 写入草稿。 */
export async function saveDraft(draft: AttemptDraft): Promise<void> {
  const database = getDb();
  if (!database) {
    memoryDrafts.set(draft.attemptId, draft);
    return;
  }
  try {
    await database.attemptDraft.put(draft);
  } catch {
    memoryDrafts.set(draft.attemptId, draft);
  }
}

/** 删除草稿（交卷成功后清理）。 */
export async function clearDraft(attemptId: string): Promise<void> {
  const database = getDb();
  memoryDrafts.delete(attemptId);
  if (!database) return;
  try {
    await database.attemptDraft.delete(attemptId);
  } catch {
    /* 清理失败不影响正确性 */
  }
}

/**
 * 创建批次并持久化。
 *
 * clientSeq 在此分配并落盘，重放时保持不变——这是服务端幂等的依据。
 */
export async function enqueueBatch(
  attemptId: string,
  clientSeq: number,
  items: AnswerBatch["items"],
): Promise<PendingBatch> {
  const batch: PendingBatch = {
    attemptId,
    clientSeq,
    items,
    createdAt: new Date().toISOString(),
    retries: 0,
    nextRetryAt: null,
  };

  const database = getDb();
  if (!database) {
    memoryBatchId += 1;
    const stored = { ...batch, id: memoryBatchId };
    memoryBatches.set(memoryBatchId, stored);
    return stored;
  }
  try {
    const id = await database.pendingBatches.add(batch);
    return { ...batch, id };
  } catch {
    memoryBatchId += 1;
    const stored = { ...batch, id: memoryBatchId };
    memoryBatches.set(memoryBatchId, stored);
    return stored;
  }
}

/** 列出某会话的待上行批次，按 clientSeq 升序。 */
export async function listBatches(attemptId: string): Promise<PendingBatch[]> {
  const database = getDb();
  if (!database) {
    return [...memoryBatches.values()]
      .filter((b) => b.attemptId === attemptId)
      .sort((a, b) => a.clientSeq - b.clientSeq);
  }
  try {
    return await database.pendingBatches.where("attemptId").equals(attemptId).sortBy("clientSeq");
  } catch {
    return [...memoryBatches.values()]
      .filter((b) => b.attemptId === attemptId)
      .sort((a, b) => a.clientSeq - b.clientSeq);
  }
}

/** 删除已确认的批次（clientSeq ≤ acceptedClientSeq）。 */
export async function deleteBatchesUpTo(attemptId: string, acceptedClientSeq: number): Promise<void> {
  const database = getDb();
  if (!database) {
    for (const [id, batch] of memoryBatches) {
      if (batch.attemptId === attemptId && batch.clientSeq <= acceptedClientSeq) {
        memoryBatches.delete(id);
      }
    }
    return;
  }
  try {
    const rows = await database.pendingBatches
      .where("attemptId")
      .equals(attemptId)
      .filter((b) => b.clientSeq <= acceptedClientSeq)
      .toArray();
    await database.pendingBatches.bulkDelete(rows.map((r) => r.id!).filter((v) => v != null));
  } catch {
    /* 清理失败不影响正确性：重放时服务端按 clientSeq 幂等去重 */
  }
}

/** 更新批次重试状态。 */
export async function updateBatch(batch: PendingBatch): Promise<void> {
  const database = getDb();
  if (!database) {
    if (batch.id != null) memoryBatches.set(batch.id, batch);
    return;
  }
  try {
    await database.pendingBatches.put(batch);
  } catch {
    if (batch.id != null) memoryBatches.set(batch.id, batch);
  }
}

/**
 * 清空整个本地存储（草稿 + 队列）。
 *
 * 用于「个人中心 → 清除本地数据」，也用于测试隔离。
 */
export async function resetDraftStore(): Promise<void> {
  memoryDrafts.clear();
  memoryBatches.clear();
  memoryBatchId = 0;

  const database = getDb();
  if (!database) return;
  try {
    await database.attemptDraft.clear();
    await database.pendingBatches.clear();
  } catch {
    /* 清理失败不影响正确性 */
  }
}

/** 统计待同步批次数（用于「离线 · 待同步 N 条」提示）。 */
export async function countPending(attemptId: string): Promise<number> {
  const batches = await listBatches(attemptId);
  return batches.length;
}
