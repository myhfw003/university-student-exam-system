/* ==========================================================================
   知行测评 · 标签筛选器
   --------------------------------------------------------------------------
   原型结构：按分组渲染 .chip.is-tag，用 aria-pressed 表示选中。
   ========================================================================== */

import type { Tag } from "../domain/types";

/** 筛选器属性。 */
export interface TagFilterProps {
  /**
   * 按分组顺序的标签。
   *
   * 只要 ID 与名称：HTTP 模式的标签来自服务端目录，难度等级可能是空，
   * 与本地目录的 `Tag` 不是同一个形状。
   */
  groups: Array<{ group: string; label: string; tags: Array<Pick<Tag, "id" | "name">> }>;
  /** 已选标签 ID。 */
  selected: readonly string[];
  /** 切换回调。 */
  onToggle: (tagId: string) => void;
  /** 分组标签文案。 */
  groupLabel?: string;
}

/** 标签筛选器。 */
export function TagFilter({ groups, selected, onToggle, groupLabel = "按标签筛选" }: TagFilterProps) {
  const selectedSet = new Set(selected);

  return (
    <div className="filter-block">
      <span className="text-sm text-3 filter-group-label">{groupLabel}</span>
      {groups.map((group) => (
        <div key={group.group} className="row" style={{ alignItems: "flex-start", marginBottom: "var(--sp-2)" }}>
          <span className="text-sm text-3 filter-group-label">{group.label}</span>
          <div className="row-tight">
            {group.tags.map((tag) => {
              const on = selectedSet.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className="chip is-tag"
                  aria-pressed={on}
                  onClick={() => onToggle(tag.id)}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
