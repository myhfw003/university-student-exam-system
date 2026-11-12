/* ==========================================================================
   知行测评 · 题目卡头
   --------------------------------------------------------------------------
   原型结构：.q-head > .q-index + 题型徽标 + 分值徽标 + 难度标签 + 普通标签
   + （选项被置换时）"选项已置换" 标记。
   ========================================================================== */

import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "./Badge";
import { TagChip, type TagChipGroup } from "./TagChip";
import { TYPE_LABEL } from "../engine/paper";

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
  /** 难度标签（名称）。 */
  difficultyName?: string;
  /** 普通标签。 */
  tags?: Array<{ id: string; name: string; group: TagChipGroup }>;
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
  permuted = false,
  children,
}: QuestionHeadProps) {
  return (
    <div className="q-head">
      <span className="q-index">第 {slot} 题</span>
      <Badge tone={TYPE_BADGE_TONE[type] ?? "neutral"}>
        {TYPE_LABEL[type as keyof typeof TYPE_LABEL] ?? type}
      </Badge>
      <Badge tone="neutral">{score} 分</Badge>
      {difficultyName ? (
        <TagChip group="difficulty" title="难度">
          {difficultyName}
        </TagChip>
      ) : null}
      {tags.map((tag) => (
        <TagChip key={tag.id} group={tag.group} title={tag.name}>
          {tag.name}
        </TagChip>
      ))}
      {permuted ? <span className="variant-tag is-diff">选项已置换</span> : null}
      {children}
    </div>
  );
}
