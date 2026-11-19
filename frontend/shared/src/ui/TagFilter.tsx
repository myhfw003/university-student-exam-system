/* ==========================================================================
   知行测评 · 标签筛选器
   --------------------------------------------------------------------------
   原型结构：按分组渲染 .chip.is-tag，用 aria-pressed 表示选中。
   ========================================================================== */

import type { Tag, TagMatchMode } from "../domain/types";
import { Segmented } from "./Segmented";

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
  /**
   * 命中模式：任一命中（默认）/ 全部命中。
   *
   * 给了 `onMatchModeChange` 才渲染切换控件——不是每个筛选场景都支持它
   * （学生端的考试 / 练习列表只有任一命中）。
   */
  matchMode?: TagMatchMode;
  onMatchModeChange?: (mode: TagMatchMode) => void;
  /**
   * 是否把子标签也算命中（默认开启）。
   *
   * 给了 `onIncludeDescendantsChange` 才渲染这个开关。
   */
  includeDescendants?: boolean;
  onIncludeDescendantsChange?: (value: boolean) => void;
}

/** 标签筛选器。 */
export function TagFilter({
  groups,
  selected,
  onToggle,
  groupLabel = "按标签筛选",
  matchMode = "any",
  onMatchModeChange,
  includeDescendants = true,
  onIncludeDescendantsChange,
}: TagFilterProps) {
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
      {onIncludeDescendantsChange || onMatchModeChange ? (
        <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
          {onIncludeDescendantsChange ? (
            <label className="checkline">
              <input
                type="checkbox"
                checked={includeDescendants}
                onChange={(event) => onIncludeDescendantsChange(event.target.checked)}
              />
              <span className="checkline-text">包含子标签</span>
            </label>
          ) : null}
          {onMatchModeChange ? (
            <Segmented
              label="标签命中模式"
              value={matchMode}
              onChange={onMatchModeChange}
              options={[
                { value: "any", label: "任一命中" },
                { value: "all", label: "全部命中" },
              ]}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
