/* ==========================================================================
   知行测评 · 题目展示辅助
   --------------------------------------------------------------------------
   把题目的标签转成题头需要的展示形态：普通标签、难度标签。
   难度标签在原型里单独占一个位置（.tag-chip.is-难度），不混在普通标签中。
   ========================================================================== */

import type { Tag, TagGroup } from "@exam/shared/domain/types";
import { useCatalog } from "@exam/shared/mock/catalog";

/** 标签分组 → TagChip 的 group 取值。 */
export const GROUP_TO_CHIP: Record<TagGroup, TagGroup> = {
  domain: "domain",
  knowledge_point: "knowledge_point",
  ability: "ability",
  difficulty: "difficulty",
};

/** 题头用的标签集合。 */
export interface DisplayTag {
  id: string;
  name: string;
  group: TagGroup;
}

/**
 * 取题目的展示标签。
 *
 * 难度标签单独返回——题头里难度有自己的位置，不进普通标签列表。
 */
export function useQuestionTags(tagIds: readonly string[]): {
  tags: DisplayTag[];
  difficulty: DisplayTag | undefined;
} {
  const allTags = useCatalog((state) => state.tags);

  const resolved = tagIds
    .map((id) => allTags.find((t) => t.id === id))
    .filter((t): t is Tag => Boolean(t));

  const difficulty = resolved.find((t) => t.group === "difficulty");
  const tags = resolved
    .filter((t) => t.group !== "difficulty")
    .map((t) => ({ id: t.id, name: t.name, group: t.group }));

  return { tags, difficulty };
}
