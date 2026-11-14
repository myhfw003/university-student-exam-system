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
    const last = result.length - 1;
    result[last] = Math.round((result[last]! + diff) * 100) / 100;
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

/**
 * 把一组整数配额按权重等比缩放到目标总量（最大余数法）。
 *
 * 用于「难度配额之和与题型配额之和不一致」时，把难度配额归一到题型配额的
 * 总量——题型配额决定卷面题量，难度配额只决定难度分布。
 */
function scaleToTotal(values: readonly number[], target: number): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0 || target <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v * target) / sum);
  const floors = raw.map((v) => Math.floor(v));
  let leftover = target - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  let cursor = 0;
  while (leftover > 0 && order.length > 0) {
    const index = order[cursor % order.length]!.index;
    floors[index] = (floors[index] ?? 0) + 1;
    leftover -= 1;
    cursor += 1;
  }
  return floors;
}

/* ==========================================================================
   配额矩阵：行和 = 题型配额、列和 = 难度配额
   --------------------------------------------------------------------------
   题型配额与难度配额**都是绝对题数**（docs/design/03-domain-model.md §4.2），
   因此配额矩阵必须同时满足两个边际。

   建模为运输问题，用最小费用最大流求解：
     源点 → 题型（容量 = 题型配额）
     题型 → 难度（容量 = 该格在题池里的候选数，每单位一条平行边）
     难度 → 汇点（容量 = 难度配额）

   费用让解尽量贴近「按难度配额比例分摊到每个题型」：第 k 单位放进格 (i,j)
   的边际费用为 total·(2k−1) − 2·Rᵢ·Cⱼ，于是总费用
   = total·Σ(xᵢⱼ − pᵢⱼ)² − 常数（pᵢⱼ = Rᵢ·Cⱼ/total），
   即在满足两个边际的前提下取**最接近比例分摊**的整数矩阵。

   最大流小于目标题量 → 题池撑不起这份规则，按设计文档抛
   InsufficientQuestionPoolError 并携带全部缺口。
   ========================================================================== */

/** 流网络的一条边。 */
interface FlowEdge {
  to: number;
  rev: number;
  cap: number;
  cost: number;
}

/** 加一条有向边（含反向边）。 */
function addFlowEdge(
  graph: FlowEdge[][],
  from: number,
  to: number,
  cap: number,
  cost: number,
): void {
  const forward: FlowEdge = { to, rev: graph[to]?.length ?? 0, cap, cost };
  const backward: FlowEdge = { to: from, rev: graph[from]?.length ?? 0, cap: 0, cost: -cost };
  (graph[from] ??= []).push(forward);
  (graph[to] ??= []).push(backward);
}

/**
 * 最小费用最大流（Bellman-Ford 最短路增广）。
 *
 * 网络规模极小（节点数 = 题型数 + 难度数 + 2），Bellman-Ford 完全够用且结果确定。
 */
function minCostMaxFlow(graph: FlowEdge[][], source: number, sink: number): number {
  const nodeCount = graph.length;
  let flow = 0;

  for (;;) {
    const dist = new Array<number>(nodeCount).fill(Number.POSITIVE_INFINITY);
    const prevNode = new Array<number>(nodeCount).fill(-1);
    const prevEdge = new Array<number>(nodeCount).fill(-1);
    dist[source] = 0;

    // Bellman-Ford：网络里存在负费用边（凸成本），不能用 Dijkstra。
    for (let round = 0; round < nodeCount - 1; round += 1) {
      let changed = false;
      for (let node = 0; node < nodeCount; node += 1) {
        const base = dist[node];
        if (base === undefined || base === Number.POSITIVE_INFINITY) continue;
        const edges = graph[node] ?? [];
        for (let i = 0; i < edges.length; i += 1) {
          const edge = edges[i];
          if (!edge || edge.cap <= 0) continue;
          const next = base + edge.cost;
          const current = dist[edge.to];
          if (current === undefined || next < current - 1e-9) {
            dist[edge.to] = next;
            prevNode[edge.to] = node;
            prevEdge[edge.to] = i;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    const sinkDist = dist[sink];
    if (sinkDist === undefined || sinkDist === Number.POSITIVE_INFINITY) break;

    // 增广量取路径上最小剩余容量。
    let add = Number.POSITIVE_INFINITY;
    for (let node = sink; node !== source; node = prevNode[node] ?? -1) {
      const parent = prevNode[node];
      const edgeIndex = prevEdge[node];
      if (parent === undefined || parent < 0 || edgeIndex === undefined || edgeIndex < 0) {
        add = 0;
        break;
      }
      const edge = graph[parent]?.[edgeIndex];
      if (!edge) {
        add = 0;
        break;
      }
      add = Math.min(add, edge.cap);
    }
    if (!Number.isFinite(add) || add <= 0) break;

    for (let node = sink; node !== source; node = prevNode[node] ?? -1) {
      const parent = prevNode[node];
      const edgeIndex = prevEdge[node];
      if (parent === undefined || parent < 0 || edgeIndex === undefined || edgeIndex < 0) break;
      const edge = graph[parent]?.[edgeIndex];
      if (!edge) break;
      edge.cap -= add;
      const reverse = graph[node]?.[edge.rev];
      if (reverse) reverse.cap += add;
    }
    flow += add;
  }

  return flow;
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

/** 配额矩阵的求解结果。 */
interface QuotaSolution {
  /** cells[i][j] = 该（题型 × 难度）格需要的题数。 */
  cells: number[][];
  /** 是否满额（最大流等于目标题量）。 */
  satisfied: boolean;
  /** 各格按比例分摊的实数份额。 */
  share: number[][];
  /** 各格在题池里的可用候选数。 */
  available: number[][];
}

/**
 * 解配额矩阵：行和 = 题型配额，列和 = 难度配额。
 *
 * 每格题数不超过该格在题池里的候选数；题池撑不起时返回未满额的解，
 * 由调用方按缺口抛异常。
 */
function solveQuotaMatrix(
  types: Array<[QuestionType, number]>,
  difficulties: Array<[string, number]>,
  available: number[][],
): QuotaSolution {
  const rowCount = types.length;
  const colCount = difficulties.length;
  const total = types.reduce((sum, [, n]) => sum + n, 0);

  const share: number[][] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < colCount; j += 1) {
      row.push(total > 0 ? (types[i]![1] * difficulties[j]![1]) / total : 0);
    }
    share.push(row);
  }

  // 节点编号：0 源点；1..rowCount 题型；其后是难度；末位汇点。
  const source = 0;
  const typeBase = 1;
  const diffBase = typeBase + rowCount;
  const sink = diffBase + colCount;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);

  for (let i = 0; i < rowCount; i += 1) {
    addFlowEdge(graph, source, typeBase + i, types[i]![1], 0);
  }
  for (let j = 0; j < colCount; j += 1) {
    addFlowEdge(graph, diffBase + j, sink, difficulties[j]![1], 0);
  }

  // 平行边：第 k 单位一条，容量 1，费用递增（凸成本）。
  const cells: number[][] = Array.from({ length: rowCount }, () =>
    new Array<number>(colCount).fill(0),
  );
  const edgeRefs: Array<Array<Array<{ edge: FlowEdge; cap: number }>>> = [];
  for (let i = 0; i < rowCount; i += 1) {
    const rowRefs: Array<Array<{ edge: FlowEdge; cap: number }>> = [];
    for (let j = 0; j < colCount; j += 1) {
      const cellRefs: Array<{ edge: FlowEdge; cap: number }> = [];
      const cap = Math.max(0, available[i]?.[j] ?? 0);
      const limit = Math.min(cap, types[i]![1], difficulties[j]![1]);
      for (let k = 1; k <= limit; k += 1) {
        const cost = total * (2 * k - 1) - 2 * types[i]![1] * difficulties[j]![1];
        const from = typeBase + i;
        const before = graph[from]?.length ?? 0;
        addFlowEdge(graph, from, diffBase + j, 1, cost);
        const edge = graph[from]?.[before];
        if (edge) cellRefs.push({ edge, cap: 1 });
      }
      rowRefs.push(cellRefs);
    }
    edgeRefs.push(rowRefs);
  }

  const flow = minCostMaxFlow(graph, source, sink);

  for (let i = 0; i < rowCount; i += 1) {
    for (let j = 0; j < colCount; j += 1) {
      const refs = edgeRefs[i]?.[j] ?? [];
      let count = 0;
      for (const ref of refs) count += ref.cap - ref.edge.cap;
      const row = cells[i];
      if (row) row[j] = count;
    }
  }

  return { cells, satisfied: flow >= total, share, available };
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

  // 2. 题型配额（决定卷面题量）。
  const typeEntries = (Object.entries(rules.typeQuota) as Array<[QuestionType, number]>).filter(
    ([, n]) => n > 0,
  );

  // 3. 难度配额（决定难度分布）：归一到题型配额的总量。
  let difficultyEntries = Object.entries(rules.difficultyQuota).filter(([, n]) => n > 0);
  const totalItems = typeEntries.reduce((sum, [, n]) => sum + n, 0);
  if (difficultyEntries.length === 0) {
    difficultyEntries = [["不限", totalItems]];
  } else {
    const scaled = scaleToTotal(
      difficultyEntries.map(([, n]) => n),
      totalItems,
    );
    difficultyEntries = difficultyEntries.map(([difficulty], index) => [
      difficulty,
      scaled[index] ?? 0,
    ]);
  }

  // 4. 每格的候选（题型 + 难度标签 + 标签选择器）。
  const candidateMap = new Map<string, Question[]>();
  const available: number[][] = [];
  for (let i = 0; i < typeEntries.length; i += 1) {
    const type = typeEntries[i]![0];
    const row: number[] = [];
    for (let j = 0; j < difficultyEntries.length; j += 1) {
      const difficulty = difficultyEntries[j]![0];
      const candidates = ordered.filter(
        (q) =>
          q.type === type &&
          (difficulty === "不限" || q.tags.some((t) => t === difficulty)) &&
          matchesSelector(q, rules.tagSelector, childTags),
      );
      candidateMap.set(`${type}|${difficulty}`, candidates);
      row.push(candidates.length);
    }
    available.push(row);
  }

  // 5. 配额矩阵：行和 = 题型配额，列和 = 难度配额，每格不超过候选数。
  const solution = solveQuotaMatrix(typeEntries, difficultyEntries, available);

  const cells: Cell[] = [];
  for (let i = 0; i < typeEntries.length; i += 1) {
    const type = typeEntries[i]![0];
    for (let j = 0; j < difficultyEntries.length; j += 1) {
      const required = solution.cells[i]?.[j] ?? 0;
      if (required <= 0) continue;
      const difficulty = difficultyEntries[j]![0];
      cells.push({
        type,
        difficulty,
        difficultyLevel: difficultyMap[difficulty] ?? 2,
        required,
      });
    }
  }

  // 6. 逐格确定性抽取。同一题可能被多个格共享（多难度标签），取过就不再用。
  const shortfalls: Shortfall[] = [];
  const picked: Question[] = [];
  const used = new Set<string>();
  const cellMembers = new Map<string, Question[]>();

  for (const cell of cells) {
    const key = `${cell.type}|${cell.difficulty}`;
    const candidates = candidateMap.get(key) ?? [];
    const free = candidates.filter((q) => !used.has(q.id));

    if (free.length < cell.required) {
      shortfalls.push({
        type: cell.type,
        difficulty: cell.difficulty,
        required: cell.required,
        available: free.length,
      });
      continue;
    }

    const shuffled = shuffle(free, rng(hash32(`${seed}|${key}`)));
    const members = shuffled.slice(0, cell.required);
    for (const question of members) used.add(question.id);
    cellMembers.set(key, members);
    picked.push(...members);
  }

  // 7. 池量不足即报错，携带全部缺口（不降级、不替代）。
  if (!solution.satisfied || shortfalls.length > 0) {
    if (shortfalls.length === 0) {
      // 矩阵本身满不了额：按「比例份额 vs 实际可用」逐格报缺口。
      for (let i = 0; i < typeEntries.length; i += 1) {
        const type = typeEntries[i]![0];
        for (let j = 0; j < difficultyEntries.length; j += 1) {
          const difficulty = difficultyEntries[j]![0];
          const want = solution.share[i]?.[j] ?? 0;
          if (want <= 0) continue;
          const got = solution.cells[i]?.[j] ?? 0;
          if (got >= want) continue;
          shortfalls.push({
            type,
            difficulty,
            required: Math.round(want),
            available: solution.available[i]?.[j] ?? 0,
          });
        }
      }
    }
    throw new InsufficientQuestionPoolError(shortfalls);
  }

  // 8. 题序。
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

  // 9. 分值分配。
  const cellTotals = allocateCellTotals(rules, cells, cellMembers, difficultyMap);

  const items: PaperItem[] = [];
  for (const cell of cells) {
    const key = `${cell.type}|${cell.difficulty}`;
    const members = cellMembers.get(key) ?? [];
    if (members.length === 0) continue;

    const total = cellTotals.get(key) ?? 0;
    const scores = allocate(total, members.length);
    members.forEach((q, index) => {
      items.push({ qid: q.id, score: scores[index] ?? 0 });
    });
  }

  // 保持题序与 items 顺序一致。
  const scoreByQid = new Map(items.map((item) => [item.qid, item.score]));
  const orderedItems = finalPicked
    .map((q) => ({ qid: q.id, score: scoreByQid.get(q.id) ?? 0 }))
    .filter((item) => scoreByQid.has(item.qid));

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
  cellMembers: Map<string, Question[]>,
  difficultyMap: DifficultyMap,
): Map<string, number> {
  const totals = new Map<string, number>();
  const weights = new Map<string, number>();

  for (const cell of cells) {
    const key = `${cell.type}|${cell.difficulty}`;
    const members = cellMembers.get(key) ?? [];
    if (members.length === 0) continue;

    // Even：按格内题数等权；ByDifficulty：按难度等级加权。
    const weight =
      rules.scoreAllocation === "by_difficulty"
        ? members.length * cell.difficultyLevel
        : members.length;
    weights.set(key, weight);
  }

  const sumWeight = [...weights.values()].reduce((a, b) => a + b, 0);
  const target = rules.targetTotalScore;

  // 每个格按权重分摊目标总分。
  //
  // 分值分配器的步长是 0.5，因此格内合计也落在 0.5 网格上，
  // 格内再分配时不会出现 33.17 这类分数（分值口径见
  // docs/design/03-domain-model.md §4.2 的 ScoreAllocator）。
  const halfUnits = Math.round(target * 2);
  if (Number.isInteger(halfUnits) && halfUnits >= 0 && sumWeight > 0) {
    const units = scaleToTotal(
      [...weights.values()].map((weight) => Math.max(1, Math.round(weight * 1000))),
      halfUnits,
    );
    let cursor = 0;
    for (const [key] of weights) {
      totals.set(key, (units[cursor] ?? 0) / 2);
      cursor += 1;
    }
    return totals;
  }

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
