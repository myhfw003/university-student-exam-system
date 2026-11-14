/* ==========================================================================
   知行测评 · 管理端多选下拉
   --------------------------------------------------------------------------
   对应原型 admin-workbench.js 的 mselectHtml：一个可展开的多选面板，
   带「已选 N / 总数」计数与全选 / 清空。类名沿用 .mselect 系列。
   ========================================================================== */

import { useEffect, useRef, useState } from "react";

/** 可选项。 */
export interface MultiSelectItem {
  value: string;
  label: string;
  /** 右侧补充信息（如题量）。 */
  meta?: string;
}

export interface MultiSelectProps {
  /** 面板标题，同时用于无障碍标签（如「题库」「题型」）。 */
  title: string;
  /** 未选择时触发器上显示的文案。 */
  allLabel: string;
  /** 可选项。 */
  items: MultiSelectItem[];
  /** 当前已选值。 */
  selected: readonly string[];
  /** 选中项变化。 */
  onChange: (next: string[]) => void;
  /** 触发器最小宽度（px）。 */
  minWidth?: number;
  /** 触发器的无障碍名称后缀，默认「筛选（可多选）」。 */
  ariaSuffix?: string;
}

/** 摘要文案：未选 → allLabel；选 1 项 → 该项文案；选多项 → 「已选 N 项」。 */
function summaryOf(selected: readonly string[], items: MultiSelectItem[], allLabel: string): string {
  if (selected.length === 0) return allLabel;
  if (selected.length === 1) {
    const hit = items.find((it) => it.value === selected[0]);
    return hit ? hit.label : selected[0]!;
  }
  return `已选 ${selected.length} 项`;
}

/**
 * 多选下拉。展开时显示复选列表，可单选 / 全选 / 清空。
 */
export function MultiSelect({
  title,
  allLabel,
  items,
  selected,
  onChange,
  minWidth,
  ariaSuffix = "筛选（可多选）",
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击面板外部或按 Esc 时收起。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const node = rootRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const classes = ["mselect", open ? "is-open" : null, selected.length > 0 ? "is-on" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      ref={rootRef}
      style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
    >
      <button
        type="button"
        className="mselect-trigger"
        aria-haspopup="true"
        aria-expanded={open ? "true" : "false"}
        aria-label={`${title}${ariaSuffix}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="mselect-value">{summaryOf(selected, items, allLabel)}</span>
        <span className="mselect-caret" aria-hidden="true" />
      </button>
      <div className="mselect-panel" role="group" aria-label={title}>
        <div className="mselect-head">
          <span className="mselect-count text-xs text-3">
            {title} · 已选 {selected.length} / {items.length}
          </span>
          <div className="row-tight">
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => onChange(items.map((it) => it.value))}
            >
              全选
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => onChange([])}>
              清空
            </button>
          </div>
        </div>
        <div className="mselect-options">
          {items.map((it) => (
            <label className="mselect-option" key={it.value}>
              <input
                type="checkbox"
                checked={selected.includes(it.value)}
                onChange={() => toggle(it.value)}
              />
              <span className="mselect-option-text">{it.label}</span>
              {it.meta ? <span className="mselect-option-meta">{it.meta}</span> : null}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
