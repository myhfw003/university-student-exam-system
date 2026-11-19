/* ==========================================================================
   知行测评 · 管理端标签选择器
   --------------------------------------------------------------------------
   原型 admin.js 的 tagPickerHtml：按分组渲染 chip.is-tag，满 5 个后其余置灰。

   标签目录由调用方给（HTTP 模式来自服务端，mock 模式来自本地目录）：
   真实后端的标签 ID 是数字主键，本地目录里的假 ID 发到服务端会被判成未知标签。
   ========================================================================== */

import { MAX_TAGS, TAG_GROUP_LABEL, TAG_GROUP_ORDER, useCatalog } from "@exam/shared/mock/catalog";
import type { QuestionTag } from "./useCatalogTags";

export interface TagPickerProps {
  /** 已选标签 ID。 */
  selected: readonly string[];
  /** 分组的无障碍名称。 */
  label?: string;
  /** 切换回调。 */
  onToggle: (tagId: string) => void;
  /** 只显示这些分组（缺省全部四维）。 */
  groups?: readonly string[];
  /** 标签目录；缺省用本地目录。 */
  tags?: readonly QuestionTag[];
}

/** 标签选择器。 */
export function TagPicker({ selected, onToggle, groups, tags, label = "标签选择" }: TagPickerProps) {
  const localTags = useCatalog((state) => state.tags);
  const catalog: readonly QuestionTag[] =
    tags ??
    localTags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      group: tag.group,
      groupLabel: "",
      level: tag.level ?? null,
    }));
  const full = selected.length >= MAX_TAGS;

  const visibleGroups = (groups ?? TAG_GROUP_ORDER).filter((g) =>
    catalog.some((t) => t.group === g),
  );

  return (
    <div className="tag-picker" role="group" aria-label={label}>
      {visibleGroups.map((group) => {
        const list = catalog.filter((t) => t.group === group);
        if (list.length === 0) return null;
        const groupLabel =
          list[0]?.groupLabel ||
          TAG_GROUP_LABEL[group as keyof typeof TAG_GROUP_LABEL] ||
          group;
        return (
          <div className="tag-picker-group" key={group}>
            <span className="filter-group-label">{groupLabel}</span>
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
