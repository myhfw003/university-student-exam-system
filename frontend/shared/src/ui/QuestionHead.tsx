/* ==========================================================================
   知行测评 · 题目卡头
   --------------------------------------------------------------------------
   原型结构：.q-head > .q-index + 题型徽标 + 分值徽标 + 难度标签 + 普通标签
   + （选项被置换时）"选项已置换" 标记。
   ========================================================================== */

import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "./Badge";
import { TagChip, type TagChipGroup } from "./TagChip";
import { DIFFICULTY_LABEL, TYPE_LABEL } from "../engine/paper";

/** 题型 → 徽标色调。 */
export const TYPE_BADGE_TONE: Record<string, BadgeTone> = {
  single: "primary",
  multi: "info",
  judge: "neutral",
  short: "warn",
  comprehensive: "neutral",
};

/** 题头属性。 */
export interface QuestionHeadProps {
  /** 卷面题号（1 起）。 */
  slot: number;
  /** 题型。 */
  type: string;
  /** 分值。 */
  score: number;
  /** 难度标签（名称）。缺省时按原型的 difficultyLabel 回退为「中等」。 */
  difficultyName?: string;
  /** 普通标签。 */
  tags?: Array<{ id: string; name: string; group: TagChipGroup }>;
  /** 普通标签最多展示几个；超出部分按原型显示「+N」。 */
  tagLimit?: number;
  /** 选项顺序是否被置换。 */
  permuted?: boolean;
  /** 额外内容。 */
  children?: ReactNode;
}

/** 题目卡头。 */
export function QuestionHead({
  slot,
  type,
  score,
  difficultyName,
  tags = [],
  tagLimit,
  permuted = false,
  children,
}: QuestionHeadProps) {
  // 原型 difficultyChip 恒渲染：认得出难度标签就用标签名，
  // 认不出时回退到难度等级的中文名（缺省「中等」）。
  const shown = tagLimit ? tags.slice(0, tagLimit) : tags;
  const rest = tags.length - shown.length;

  return (
    <div className="q-head">
      <span className="q-index">第 {slot} 题</span>
      <Badge tone={TYPE_BADGE_TONE[type] ?? "neutral"}>
        {TYPE_LABEL[type as keyof typeof TYPE_LABEL] ?? type}
      </Badge>
      <Badge tone="neutral">{score} 分</Badge>
      <TagChip group="difficulty" title="难度">
        {difficultyName ?? DIFFICULTY_LABEL[2]}
      </TagChip>
      {tags.length > 0 ? (
        <span className="tag-chips">
          {shown.map((tag) => (
            <TagChip key={tag.id} group={tag.group} title={tag.name}>
              {tag.name}
            </TagChip>
          ))}
          {rest > 0 ? <span className="tag-chip is-more">+{rest}</span> : null}
        </span>
      ) : null}
      {permuted ? <span className="variant-tag is-diff">选项已置换</span> : null}
      {children}
    </div>
  );
}
