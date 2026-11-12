import type { ReactNode } from "react";

/** 标签分组，与原型 tag-chip 的五维分组对应。 */
export type TagChipGroup = "domain" | "knowledge_point" | "ability" | "difficulty" | "organization";

export interface TagChipProps {
  group?: TagChipGroup;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** 分组 → 原型修饰类名。 */
const GROUP_CLASS: Record<TagChipGroup, string> = {
  domain: "is-domain",
  knowledge_point: "is-knowledge-point",
  ability: "is-ability",
  difficulty: "is-difficulty",
  organization: "is-organization",
};

/**
 * 标签片。类名沿用原型 .tag-chip + 分组修饰类。
 */
export function TagChip({ group = "domain", children, className, title }: TagChipProps) {
  const classes = ["tag-chip", GROUP_CLASS[group], className].filter(Boolean).join(" ");
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
