/* ==========================================================================
   知行测评 · 组卷蓝图与确定性抽题引擎
   --------------------------------------------------------------------------
   对齐 docs/design/03-domain-model.md §4.2（Blueprint / BlueprintRules /
   QuestionSelectionEngine / ScoreAllocator）。

   与原型的关系：原型只有「手工勾选 + 套用模板」，**没有规则抽题**；
   本模块补齐已确认决策要求的「一键出卷」，并保留手工微调。

   确定性保证：同 Rules + 同 Seed + 同 pool 快照 → 完全相同的题位列表。

   两条硬约束：
   1. **池量不足即报错，不静默降级**——抛出携带全部缺口的异常。
   2. 分值分配后各项之和**精确等于**目标总分。
   ========================================================================== */

import type { DifficultyLevel, PaperItem, Question, QuestionType } from "../domain/types";
import { hash32, rng, shuffle } from "./random";

/** 标签匹配模式。 */
export type TagMatchMode = "any" | "all";

/** 标签选择器。 */
export interface TagSelector {
  /** 标签集合。 */
  tagIds: string[];
  /** 是否包含子标签。 */
  includeChildren: boolean;
  /** 匹配模式：任一命中 / 全部命中。 */
  matchMode: TagMatchMode;
}

/** 分值分配方式。 */
export type ScoreAllocation = "even" | "by_difficulty";

/** 组卷规则。 */
export interface BlueprintRules {
  /** 标签选择器。 */
  tagSelector: TagSelector;
  /** 各难度标签的题数配额。 */
  difficultyQuota: Record<string, number>;
  /** 各题型的题数配额。 */
  typeQuota: Partial<Record<QuestionType, number>>;
  /** 目标总分。 */
  targetTotalScore: number;
  /** 生成后的题序规则。 */
  orderRule: "type" | "manual";
  /** 分值分配方式。 */
  scoreAllocation: ScoreAllocation;
}

/** 池量缺口。 */
export interface Shortfall {
  type: QuestionType;
  difficulty: string;
  /** 需要数量。 */
  required: number;
  /** 可用数量。 */
  available: number;
}

/** 池量不足。携带全部缺口，不降级、不替代。 */
export class InsufficientQuestionPoolError extends Error {
  constructor(public readonly shortfalls: Shortfall[]) {
    super(
      `题池数量不足，共 ${shortfalls.length} 项配额无法满足：` +
        shortfalls
          .map((s) => `${s.type}/${s.difficulty} 需 ${s.required} 题、可用 ${s.available} 题`)
          .join("；"),
    );
    this.name = "InsufficientQuestionPoolError";
  }
}

/** 配额矩阵的一个格子。 */
interface Cell {
  type: QuestionType;
  difficulty: string;
  difficultyLevel: number;
  required: number;
}

/**
 * 分值分配器。
 *
 * base 取「不超过平均值的最大 0.5 倍数」，余数按 order 从前到后逐个 +0.5，
 * 保证 **各项之和精确等于 total** 且每项 ≥ 0。
 */
export function allocate(total: number, count: number, order: number[] = []): number[] {
  if (count <= 0) return [];

  const step = 0.5;
  const base = Math.floor(total / count / step) * step;
  const result = new Array<number>(count).fill(base);

  let remainder = Math.round((total - base * count) * 100) / 100;
  // 余数按 order 指定顺序分配；order 缺省时从前往后。
  const sequence = order.length === count ? order : result.map((_, i) => i);
  let cursor = 0;
  while (remainder >= step - 1e-9 && cursor < count * 100) {
    const index = sequence[cursor % count]!;
    result[index] = Math.round((result[index]! + step) * 100) / 100;
    remainder = Math.round((remainder - step) * 100) / 100;
    cursor += 1;
  }

  // 浮点兜底：把残差补到最后一项。
  const sum = result.reduce((a, b) => a + b, 0);
  const diff = Math.round((total - sum) * 100) / 100;
  if (diff !== 0) {
    result[result.length - 1] = Math.round((result[result.length - 1]! + diff) * 100) / 100;
  }

  return result;
}

/** 难度标签 → 等级。 */
export type DifficultyMap = Record<string, number>;

/** 取题目的难度等级。 */
export function questionDifficulty(question: Question, difficultyMap: DifficultyMap): number {
  for (const tagId of question.tags) {
    const level = difficultyMap[tagId];
    if (level) return level as DifficultyLevel;
  }
  return 2;
}

/** 题目是否命中标签选择器。 */
export function matchesSelector(
  question: Question,
  selector: TagSelector,
  childTags: Record<string, string[]> = {},
): boolean {
  if (selector.tagIds.length === 0) return true;

  const expanded = new Set<string>(selector.tagIds);
  if (selector.includeChildren) {
    for (const tagId of selector.tagIds) {
      for (const child of childTags[tagId] ?? []) expanded.add(child);
    }
  }

  const questionTags = question.tags.filter((t) => expanded.has(t));
  if (questionTags.length === 0) return false;
  return selector.matchMode === "all"
    ? selector.tagIds.every((t) => expanded.has(t) && question.tags.includes(t))
    : true;
}

/** 计算配额矩阵。 */
function buildCells(rules: BlueprintRules, difficultyMap: DifficultyMap): Cell[] {
  const cells: Cell[] = [];
  const difficultyEntries = Object.entries(rules.difficultyQuota).filter(([, n]) => n > 0);
  const totalDifficulty = difficultyEntries.reduce((sum, [, n]) => sum + n, 0);

  for (const [type, typeCount] of Object.entries(rules.typeQuota) as Array<[QuestionType, number]>) {
    if (!typeCount || typeCount <= 0) continue;

    if (difficultyEntries.length === 0) {
      cells.push({ type, difficulty: "不限", difficultyLevel: 2, required: typeCount });
      continue;
    }

    // 题型配额按难度配额比例分摊到各难度，余数补给题量最大的难度格。
    let assigned = 0;
    const perDifficulty = difficultyEntries.map(([difficulty, quota]) => {
      const count = Math.floor((typeCount * quota) / totalDifficulty);
      assigned += count;
      return { difficulty, count };
    });
    let leftover = typeCount - assigned;
    const sorted = [...perDifficulty].sort((a, b) => b.count - a.count);
    let index = 0;
    while (leftover > 0 && sorted.length > 0) {
      sorted[index % sorted.length]!.count += 1;
      leftover -= 1;
      index += 1;
    }

    for (const entry of perDifficulty) {
      if (entry.count <= 0) continue;
      cells.push({
        type,
        difficulty: entry.difficulty,
        difficultyLevel: difficultyMap[entry.difficulty] ?? 2,
        required: entry.count,
      });
    }
  }

  return cells;
}

/** 抽题结果。 */
export interface BlueprintResult {
  /** 题位（配分已定）。 */
  items: PaperItem[];
  /** 目标总分。 */
  totalScore: number;
  /** 实际题量。 */
  itemCount: number;
}

/**
 * 确定性抽题。
 *
 * @param rules 组卷规则
 * @param pool 候选池（已按「已发布 + 标签 + 难度」过滤）
 * @param seed 随机种子；同 Rules + 同 Seed + 同 pool 快照 → 结果完全一致
 * @param difficultyMap 难度标签 → 等级
 */
export function selectQuestions(
  rules: BlueprintRules,
  pool: readonly Question[],
  seed: string,
  difficultyMap: DifficultyMap,
  childTags: Record<string, string[]> = {},
): BlueprintResult {
  // 1. 稳定基序：按题号升序。
  const ordered = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 2. 配额矩阵。
  const cells = buildCells(rules, difficultyMap);

  // 3. 逐格确定性抽取。
  const shortfalls: Shortfall[] = [];
  const picked: Question[] = [];

  for (const cell of cells) {
    const candidates = ordered.filter(
      (q) =>
        q.type === cell.type &&
        (cell.difficulty === "不限" ||
          q.tags.some((t) => t === cell.difficulty)) &&
        matchesSelector(q, rules.tagSelector, childTags),
    );

    if (candidates.length < cell.required) {
      shortfalls.push({
        type: cell.type,
        difficulty: cell.difficulty,
        required: cell.required,
        available: candidates.length,
      });
      continue;
    }

    const cellKey = `${cell.type}|${cell.difficulty}`;
    const shuffled = shuffle(candidates, rng(hash32(`${seed}|${cellKey}`)));
    picked.push(...shuffled.slice(0, cell.required));
  }

  // 4. 池量不足即报错，携带全部缺口（不降级、不替代）。
  if (shortfalls.length > 0) {
    throw new InsufficientQuestionPoolError(shortfalls);
  }

  // 5. 题序。
  const orderedPicked =
    rules.orderRule === "manual"
      ? picked
      : [...picked].sort((a, b) => {
          const ra = typeRankOf(a.type);
          const rb = typeRankOf(b.type);
          if (ra !== rb) return ra - rb;
          const da = questionDifficulty(a, difficultyMap);
          const db = questionDifficulty(b, difficultyMap);
          if (da !== db) return da - db;
          return 0;
        });

  // 同题型同难度内用同一种子洗牌。
  const shuffledWithin = [...orderedPicked];
  const groups = new Map<string, Question[]>();
  for (const q of shuffledWithin) {
    const key = `${q.type}|${questionDifficulty(q, difficultyMap)}`;
    const list = groups.get(key) ?? [];
    list.push(q);
    groups.set(key, list);
  }
  const finalOrder: Question[] = [];
  for (const [key, list] of groups) {
    const shuffled = shuffle(list, rng(hash32(`${seed}|order|${key}`)));
    finalOrder.push(...shuffled);
  }
  const finalPicked = rules.orderRule === "manual" ? shuffledWithin : finalOrder;

  // 6. 分值分配。
  const cellTotals = allocateCellTotals(rules, cells, finalPicked, difficultyMap);

  const items: PaperItem[] = [];
  for (const cell of cells) {
    const inCell = finalPicked.filter(
      (q) =>
        q.type === cell.type &&
        (cell.difficulty === "不限" || q.tags.some((t) => t === cell.difficulty)),
    );
    if (inCell.length === 0) continue;

    const total = cellTotals.get(`${cell.type}|${cell.difficulty}`) ?? 0;
    const scores = allocate(total, inCell.length);
    inCell.forEach((q, index) => {
      items.push({ qid: q.id, score: scores[index] ?? 0 });
    });
  }

  // 保持题序与 items 顺序一致。
  const orderedItems = finalPicked.map((q) => items.find((i) => i.qid === q.id)!).filter(Boolean);

  return {
    items: orderedItems,
    totalScore: orderedItems.reduce((sum, i) => sum + i.score, 0),
    itemCount: orderedItems.length,
  };
}

/** 题型固定序。 */
function typeRankOf(type: QuestionType): number {
  const order: QuestionType[] = ["single", "multi", "judge", "short", "comprehensive"];
  const index = order.indexOf(type);
  return index === -1 ? order.length : index;
}

/** 按分配方式分摊各格的题位总分。 */
function allocateCellTotals(
  rules: BlueprintRules,
  cells: Cell[],
  picked: readonly Question[],
  difficultyMap: DifficultyMap,
): Map<string, number> {
  const totals = new Map<string, number>();
  const weights = new Map<string, number>();

  for (const cell of cells) {
    const inCell = picked.filter(
      (q) =>
        q.type === cell.type &&
        (cell.difficulty === "不限" || q.tags.some((t) => t === cell.difficulty)),
    );
    if (inCell.length === 0) continue;

    const key = `${cell.type}|${cell.difficulty}`;
    const weight =
      rules.scoreAllocation === "by_difficulty"
        ? inCell.length * cell.difficultyLevel
        : inCell.length;
    weights.set(key, weight);
  }

  const sumWeight = [...weights.values()].reduce((a, b) => a + b, 0);
  const target = rules.targetTotalScore;

  // 每个格按权重分摊目标总分，余数由分值分配器在格内消化。
  for (const [key, weight] of weights) {
    const share = sumWeight > 0 ? (target * weight) / sumWeight : 0;
    totals.set(key, Math.round(share * 100) / 100);
  }

  // 修正各格之和与目标总分的差，落到权重最大的格。
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  const diff = Math.round((target - sum) * 100) / 100;
  if (diff !== 0 && totals.size > 0) {
    const largest = [...weights.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    totals.set(largest, Math.round((totals.get(largest)! + diff) * 100) / 100);
  }

  void difficultyMap;
  return totals;
}
