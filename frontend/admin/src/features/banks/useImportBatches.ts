/* ==========================================================================
   知行测评 · 管理端导入批次
   --------------------------------------------------------------------------
   导入是三步：上传（服务端解析）→ 调整列映射（重新解析）→ 采纳为候选题。

   这一层管的是**批次列表**与**打开批次**：
   上传当下就能看到逐行结果，但过一阵再回来看这个批次，
   逐行结果存在服务端，得重新取回来（`GET /imports/{id}`）。

   两处口径差异要注意（页面不知道，数据通路知道）：

   1. **逐行结果**：真实后端的每行是「行号 / 是否有效 / 错误明细 / 解析出的 JSON」，
      mock 的每行是已经转成题目的结构。页面预览表要的是后一种，
      转换在 `toPreviewRow` 里做。
   2. **文件表头**：真实后端只在**解析当场**返回文件表头，
      批次详情接口不给（表头没有存）。所以重新打开的批次
      **改不了列映射**——要改就得重新上传原文件。
      这一点在页面上要说清楚，不能让人对着空的列名下拉发呆。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isBackendEnabled,
  loadImportBatches,
  loadImportBatch,
  type ImportBatchDetail,
} from "@exam/shared/api";
import { useCatalog } from "@exam/shared/mock/catalog";

/** 导入批次列表的一行（mock 与 HTTP 同一形状）。 */
export interface ImportBatchRow {
  id: string;
  fileName: string;
  createdAt: string;
  /** 总行数。 */
  rowCount: number;
  /** 状态：`parsed` 已解析待采纳 / `adopted` 已采纳 / `failed` 解析失败。 */
  status: string;
  /** 已采纳的题目数。 */
  adoptedCount: number;
}

/**
 * 导入批次列表。
 *
 * HTTP 模式读 `GET /imports`；mock 模式读本地内容仓库里的批次。
 */
export function useImportBatches(): {
  batches: ImportBatchRow[];
  loading: boolean;
  refresh: () => void;
} {
  const remote = isBackendEnabled();
  const mockImports = useCatalog((state) => state.imports);

  const [batches, setBatches] = useState<ImportBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const page = await loadImportBatches({ size: 20 });
        if (cancelled) return;
        setBatches(
          page.items.map((batch) => ({
            id: batch.id,
            fileName: batch.fileName,
            createdAt: batch.createdAt,
            rowCount: batch.totalRows,
            status: batch.status,
            adoptedCount: batch.adoptedCount,
          })),
        );
      } catch {
        if (!cancelled) setBatches([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remote, token]);

  const mockBatches = useMemo<ImportBatchRow[]>(
    () =>
      mockImports.map((batch) => ({
        id: batch.id,
        fileName: batch.fileName,
        createdAt: batch.createdAt,
        rowCount: batch.rowCount,
        status: batch.status,
        adoptedCount: batch.adoptedCount ?? 0,
      })),
    [mockImports],
  );

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return { batches: remote ? batches : mockBatches, loading, refresh };
}

/**
 * 打开一个批次（取它的逐行结果）。
 *
 * mock 模式不需要取：本地内容仓库里就有整份批次。
 * 返回 null 表示 mock 模式（调用方改走本地数据）。
 */
export async function fetchImportBatchDetail(
  id: string,
): Promise<ImportBatchDetail | null> {
  if (!isBackendEnabled()) return null;
  return loadImportBatch(id);
}
