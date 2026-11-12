/* ==========================================================================
   知行测评 · 管理端标签选择器
   --------------------------------------------------------------------------
   原型 admin.js 的 tagPickerHtml：按分组渲染 chip.is-tag，满 5 个后其余置灰。
   ========================================================================== */

import { MAX_TAGS, TAG_GROUP_LABEL, TAG_GROUP_ORDER, useCatalog } from "@exam/shared/mock/catalog";
import type { Tag } from "@exam/shared/domain/types";

export interface TagPickerProps {
  /** 已选标签 ID。 */
  selected: readonly string[];
  /** 分组的无障碍名称。 */
  label?: string;
  /** 切换回调。 */
  onToggle: (tagId: string) => void;
  /** 只显示这些分组（缺省全部四维）。 */
  groups?: readonly string[];
}

/** 标签选择器。 */
export function TagPicker({ selected, onToggle, groups, label = "标签选择" }: TagPickerProps) {
  const tags = useCatalog((state) => state.tags);
  const full = selected.length >= MAX_TAGS;

  const visibleGroups = (groups ?? TAG_GROUP_ORDER).filter((g) =>
    tags.some((t) => t.group === g),
  );

  return (
    <div className="tag-picker" role="group" aria-label={label}>
      {visibleGroups.map((group) => {
        const list = tags.filter((t: Tag) => t.group === group);
        if (list.length === 0) return null;
        return (
          <div className="tag-picker-group" key={group}>
            <span className="filter-group-label">
              {TAG_GROUP_LABEL[group as keyof typeof TAG_GROUP_LABEL] ?? group}
            </span>
            <div className="row-tight">
              {list.map((tag) => {
                const on = selected.includes(tag.id);
                const disabled = full && !on;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`chip is-tag${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    disabled={disabled}
                    aria-disabled={disabled || undefined}
                    onClick={() => onToggle(tag.id)}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
