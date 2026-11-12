export interface PaginationProps {
  /** 当前页（1 起）。 */
  page: number;
  /** 每页条数。 */
  pageSize: number;
  /** 总条数。 */
  total: number;
  /** 页码变化回调。 */
  onPageChange: (page: number) => void;
  /** 每页条数变化回调。 */
  onPageSizeChange?: (pageSize: number) => void;
  /** 每页条数候选。 */
  pageSizeOptions?: number[];
  /** 无障碍名称。 */
  label?: string;
  className?: string;
}

function buildPages(page: number, totalPages: number): number[] {
  if (totalPages <= 0) return [];
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const result: number[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous !== 0 && p - previous > 1) result.push(-1); // -1 表示省略号
    result.push(p);
    previous = p;
  }
  return result;
}

/**
 * 分页控件（服务端分页）。
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  label = "分页",
  className,
}: PaginationProps) {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  const pages = buildPages(page, totalPages);
  const classes = ["pagination", className].filter(Boolean).join(" ");

  return (
    <div className={classes} role="group" aria-label={label}>
      <span className="text-sm text-3 num">
        共 {total} 条 · 第 {page}/{Math.max(totalPages, 1)} 页
      </span>
      <div className="spacer" />
      {onPageSizeChange ? (
        <label className="row-tight">
          <span className="text-sm text-3">每页</span>
          <select
            className="select"
            style={{ width: "auto" }}
            value={pageSize}
            aria-label="每页条数"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="pagination-list">
        <button
          type="button"
          className="page-btn"
          disabled={page <= 1}
          aria-label="上一页"
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </button>
        {pages.map((p, index) =>
          p === -1 ? (
            <span key={`gap-${index}`} className="page-btn" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className="page-btn"
              aria-current={p === page ? "page" : undefined}
              aria-label={`第 ${p} 页`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="page-btn"
          disabled={page >= totalPages}
          aria-label="下一页"
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}
