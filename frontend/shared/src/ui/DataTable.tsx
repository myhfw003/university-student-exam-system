import type { CSSProperties, ReactNode } from "react";

/** 排序方向。 */
export type SortDirection = "asc" | "desc";

export interface DataTableColumn<T> {
  /** 列键，用于排序标识。 */
  key: string;
  /** 表头文本。 */
  header: ReactNode;
  /** 单元格渲染。缺省渲染原始值。 */
  render?: (row: T, index: number) => ReactNode;
  /** 是否可排序。 */
  sortable?: boolean;
  /** 对齐方式。 */
  align?: "left" | "center" | "right";
  /** 列宽。 */
  width?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  /** 行 key。 */
  rowKey: (row: T, index: number) => string;
  /** 当前排序列。 */
  sortBy?: string;
  /** 当前排序方向。 */
  sortDir?: SortDirection;
  /** 排序变化回调（服务端排序）。 */
  onSortChange?: (sortBy: string, sortDir: SortDirection) => void;
  /** 加载中：显示骨架占位。 */
  loading?: boolean;
  /** 空状态。 */
  empty?: ReactNode;
  /** 表格无障碍名称。 */
  label?: string;
  /** 行点击回调。 */
  onRowClick?: (row: T, index: number) => void;
  className?: string;
}

/**
 * 数据表格（服务端分页 + 服务端排序）。
 *
 * - 表头使用 `scope="col"`；
 * - 可排序表头带 `aria-sort`，内部用 button 触发排序；
 * - 加载中渲染骨架行，避免整表消失造成布局跳动。
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sortBy,
  sortDir = "asc",
  onSortChange,
  loading = false,
  empty,
  label = "数据表格",
  onRowClick,
  className,
}: DataTableProps<T>) {
  const handleSort = (column: DataTableColumn<T>) => {
    if (!column.sortable || !onSortChange) return;
    const nextDir: SortDirection = sortBy === column.key && sortDir === "asc" ? "desc" : "asc";
    onSortChange(column.key, nextDir);
  };

  const renderCell = (column: DataTableColumn<T>, row: T, index: number): ReactNode => {
    if (column.render) return column.render(row, index);
    const value = (row as Record<string, unknown>)[column.key];
    if (value === null || value === undefined) return "—";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const classes = ["table", className].filter(Boolean).join(" ");

  return (
    <div className="table-wrap">
      <table className={classes} aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => {
              const isSorted = sortBy === column.key;
              const ariaSort = column.sortable
                ? isSorted
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
                : undefined;
              const alignStyle: CSSProperties | undefined =
                column.align === undefined ? undefined : { textAlign: column.align };
              const headStyle =
                column.width === undefined && alignStyle === undefined
                  ? undefined
                  : {
                      ...alignStyle,
                      ...(column.width === undefined ? {} : { width: column.width }),
                    };

              if (!column.sortable) {
                return (
                  <th key={column.key} scope="col" style={headStyle}>
                    {column.header}
                  </th>
                );
              }

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className="is-sortable"
                  style={headStyle}
                >
                  <button type="button" onClick={() => handleSort(column)}>
                    {column.header}
                    <span className="sort-mark" aria-hidden="true">
                      {isSorted ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 3 }, (_, i) => (
                <tr key={`skeleton-${i}`}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <span className="skeleton" style={{ height: 14, width: "70%" }} />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key}>{renderCell(column, row, index)}</td>
                  ))}
                </tr>
              ))}
          {!loading && rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                {empty ?? <span className="text-3 text-sm">暂无数据</span>}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
