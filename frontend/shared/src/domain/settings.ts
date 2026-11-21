/* ==========================================================================
   系统级设置（前端词表）
   --------------------------------------------------------------------------
   设置项的**取值**是前后端共用的词表：后端存什么，前端就认什么。

   两边对不上，后果是**静默**的：服务端改了取值，前端认不出来，
   页面会悄悄退回默认值——看起来一切正常，只有单元测试全绿。

   所以两边必须一致，由 `scripts/check-system-setting-values.py` 守着。
   ========================================================================== */

/** 重做正确后的错题处理口径（需求 FR-LRN-01）。 */
export const MISTAKE_RESOLUTION_POLICY = {
  /** 移出错题本：这道题不再出现在错题本里。 */
  remove: "remove",
  /** 保留但标记已掌握：留在错题本里，标成「已掌握」。 */
  keepMastered: "keep_mastered",
} as const;

export type MistakeResolutionPolicy =
  (typeof MISTAKE_RESOLUTION_POLICY)[keyof typeof MISTAKE_RESOLUTION_POLICY];

/**
 * 口径的中文名。
 *
 * **键是取值本身**（`remove` / `keep_mastered`），不是对象属性名——
 * 页面拿到的是后端给的取值，按取值查表才对得上。
 */
export const MISTAKE_RESOLUTION_POLICY_LABEL: Record<MistakeResolutionPolicy, string> = {
  remove: "移出错题本",
  keep_mastered: "保留但标记已掌握",
};

/** 口径对学生的实际影响（管理端页面上的说明）。 */
export const MISTAKE_RESOLUTION_POLICY_HINT: Record<MistakeResolutionPolicy, string> = {
  remove: "重做正确的题目会移出错题本：「只看未掌握」与「含已掌握」里都看不到它。",
  keep_mastered: "重做正确的题目留在错题本里，标成「已掌握」，在「含已掌握」筛选下能看到。",
};

/** 缺省口径。与后端的缺省值一致。 */
export const DEFAULT_MISTAKE_RESOLUTION_POLICY: MistakeResolutionPolicy =
  MISTAKE_RESOLUTION_POLICY.remove;

/** 系统级设置（mock 与 HTTP 同一形状）。 */
export interface SystemSettings {
  /** 重做正确后的错题处理口径。 */
  mistakeResolutionPolicy: MistakeResolutionPolicy;
  /** 最后修改时间。没改过就是空。 */
  updatedAt: string | null;
  /** 最后修改人。没改过就是空。 */
  updatedBy: string | null;
}

/**
 * 取值 → 口径。认不出来退回缺省口径。
 *
 * 后端只会写出这两个取值；这里兜底是为了「后端加了一档、前端还没跟上」
 * 时页面不会崩成空白。
 */
export function toMistakeResolutionPolicy(
  value: string | undefined | null,
): MistakeResolutionPolicy {
  return value === MISTAKE_RESOLUTION_POLICY.keepMastered
    ? MISTAKE_RESOLUTION_POLICY.keepMastered
    : DEFAULT_MISTAKE_RESOLUTION_POLICY;
}
