/* ==========================================================================
   知行测评 · 能力画像（能力维度的聚合）
   --------------------------------------------------------------------------
   对应 design 03 §7.2 的 AbilityProfile：按「能力」维度的标签聚合学生表现，
   给出掌握度（0..1）与样本量；样本量不足的由服务端标注「样本不足」。

   **统计口径都在服务端**：掌握度、样本量、全对数、「样本不足」的判定与排序
   都是后端算好的，前端只呈现，不重算、也不自己判定「样本不足」。

   `masteryLabel`（掌握 / 熟悉 / 薄弱 / 样本不足）是**服务端给的中文判定**，
   前端照抄展示，不另立一套词表——服务端改文案时页面不会显示成另一个名字。
   ========================================================================== */

/**
 * 能力画像的判定词表（**前后端共用的词表**）。
 *
 * 后端按掌握度与样本量算出一个中文判定（AbilityQueries.Label）：
 * 样本量不足 →「样本不足」；否则按掌握度分档：掌握 / 熟悉 / 薄弱。
 *
 * 前端**不重算**这个判定（重算的口径与服务端不一致时，两边会显示成两个名字），
 * 这里登记的是服务端会写出的那几个词，供 mock 模式造示例数据用。
 * 两边对不上时 CI 会报错（`scripts/check-ability-mastery-labels.py`）。
 */
export const MASTERY_LABEL = {
  /** 掌握。 */
  mastered: "掌握",
  /** 熟悉。 */
  familiar: "熟悉",
  /** 薄弱。 */
  weak: "薄弱",
  /** 样本不足（样本量不够，不参与排序）。 */
  insufficient: "样本不足",
} as const;

/** 能力画像的判定文案。 */
export type MasteryLabel = (typeof MASTERY_LABEL)[keyof typeof MASTERY_LABEL];

/** 一项能力上的掌握情况。 */
export interface AbilityProfileItem {
  /** 能力标签 ID（前端领域层统一用字符串）。 */
  abilityTagId: string;
  /** 能力标签名。 */
  tagName: string;
  /** 掌握度，0..1。 */
  masteryRate: number;
  /** 样本量（参与计算的已定分成绩条数）。 */
  sampleSize: number;
  /** 完全正确的样本数。 */
  correctCount: number;
  /** 样本量是否足够：不足则不参与能力排序。 */
  sampleSufficient: boolean;
  /** 服务端给的中文判定（掌握 / 熟悉 / 薄弱 / 样本不足）。 */
  masteryLabel: string;
}

/** 能力画像。 */
export interface AbilityProfile {
  /** 各项能力（服务端已排好序：样本足够的在前，再按掌握度降序）。 */
  items: AbilityProfileItem[];
  /** 能力项总数。 */
  total: number;
  /** 样本不足的项数。 */
  insufficientCount: number;
}

/**
 * mock 侧的能力画像行。
 *
 * 与接口返回的差别只有两处：按答题者分开，标签名不写死
 * （由标签表带出，改了标签名画像跟着改）。
 */
export interface AbilityProfileSeed {
  /** 答题者 ID。 */
  studentId: string;
  /** 能力标签 ID。 */
  abilityTagId: string;
  /** 掌握度 0..1。 */
  masteryRate: number;
  /** 样本量。 */
  sampleSize: number;
  /** 全对数。 */
  correctCount: number;
  /** 样本量是否足够。 */
  sampleSufficient: boolean;
  /** 服务端给的中文判定。 */
  masteryLabel: string;
}
