/* ==========================================================================
   知行测评 · 标签片组（学生端）
   --------------------------------------------------------------------------
   原型 docs/ui-design/exam/js/student.js 的 tagChips(entity)：
   逐个标签按**自身分组**着色（is-领域 / is-知识点 / is-能力 / is-难度）。
   React 版统一用 shared 的 TagChip，group 取自标签自身的 group 字段，
   避免各处硬编码 "domain" 把知识点、能力、难度标签都染成领域色。
   ========================================================================== */

import { TagChip } from "@exam/shared";
import { useCatalog } from "@exam/shared/mock/catalog";
import type { Tag } from "@exam/shared/domain/types";

export interface TagChipsProps {
  /** 标签 ID 列表（实体上的 tags 字段）。 */
  tags: readonly string[];
  /** 最多展示几个；超出部分按原型显示「+N」。 */
  limit?: number;
}

/** 标签片组。 */
export function TagChips({ tags, limit }: TagChipsProps) {
  const all = useCatalog((state) => state.tags);
  const shown = limit ? tags.slice(0, limit) : tags;
  const rest = tags.length - shown.length;
  if (tags.length === 0) return null;

  return (
    <span className="tag-chips">
      {shown.map((id) => {
        const tag = all.find((t) => t.id === id);
        if (!tag) return null;
        return (
          <TagChip key={id} group={tag.group}>
            {tag.name}
          </TagChip>
        );
      })}
      {rest > 0 ? <span className="tag-chip is-more">+{rest}</span> : null}
    </span>
  );
}

/**
 * 实体在「知识点」分组中的标签；无知识点时回退到「领域」（原型 knowledgeTag）。
 */
export function knowledgeTag(tags: readonly string[], all: readonly Tag[]): Tag | undefined {
  for (const id of tags) {
    const tag = all.find((t) => t.id === id);
    if (tag && tag.group === "knowledge_point") return tag;
  }
  for (const id of tags) {
    const tag = all.find((t) => t.id === id);
    if (tag && tag.group === "domain") return tag;
  }
  return undefined;
}
