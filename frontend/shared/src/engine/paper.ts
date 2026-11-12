/* ==========================================================================
   知行测评 · 卷面构建（标准卷 / 小梅花 / 大梅花）
   --------------------------------------------------------------------------
   对齐原型 shared/js/engine.js §4.2–4.4。

   卷型口径：
     标准卷 —— 全体答题者完全相同的题序与选项顺序。
     小梅花 —— 题目顺序全体统一保留，仅每位答题者的选项顺序独立打乱。
     大梅花 —— 保留题型分块的先后顺序，题型内部的题目顺序与选项顺序逐人打乱。

   两条硬约束：
   1. **判断题固定不参与选项置换**（只有「正确/错误」两项，置换无教学意义）。
   2. 置换种子由系统按试卷自动派生，**用户不可输入**；同卷重复出卷结果一致。

   置换种子键格式必须与原型逐字一致，否则卷面不可复现：
     题序：exam.id + "|" + seed + "|" + variantKey + "|qorder|" + 块序号 + "|" + 题型
     选项：exam.id + "|" + seed + "|" + variantKey + "|" + questionId + "|opt"
   ========================================================================== */

import type { ExamPaper, PaperItem, PaperMode, Question } from "../domain/types";
import { autoSeed, hash32, rng, shuffle } from "./random";

/** 选项字母表：卷面上按位置重新编号。 */
export const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/** 题型顺序（决定题型分块先后）。 */
export const TYPE_ORDER: Question["type"][] = [
  "single",
  "multi",
  "judge",
  "short",
  "comprehensive",
];

/** 题型中文名。 */
export const TYPE_LABEL: Record<Question["type"], string> = {
  single: "单选题",
  multi: "多选题",
  judge: "判断题",
  short: "简答题",
  comprehensive: "综合操作题",
};

/** 卷型定义。 */
export interface PaperModeInfo {
  id: PaperMode;
  label: string;
  /** 一句话说明。 */
  short: string;
  /** 详细说明。 */
  desc: string;
}

/** 三种卷型的口径说明。 */
export const PAPER_MODES: Record<PaperMode, PaperModeInfo> = {
  standard: {
    id: "standard",
    label: "标准卷",
    short: "题序 · 选项均固定",
    desc: "全体答题者拿到完全相同的题序与选项顺序；题序按题型分块、组内由易到难，用于统一测评。",
  },
  small: {
    id: "small",
    label: "小梅花",
    short: "选项随机 · 题序保留",
    desc: "题目顺序全体统一保留（按题型分块、组内由易到难），仅每位答题者的选项顺序独立打乱，防止相邻抄袭。",
  },
  large: {
    id: "large",
    label: "大梅花",
    short: "题型分块 · 组内题序随机",
    desc: "保留题型分块的先后顺序（单选→多选→判断→简答→综合操作），每个题型内部的题目顺序按答题者独立打乱，选项顺序同样独立打乱。",
  },
};

/** 卷型配置。 */
export interface PlumConfig {
  mode: PaperMode;
  seed: string;
}

/** 卷面题位。 */
export interface BuiltPaperItem {
  /** 卷面题号（1 起）。 */
  slot: number;
  qid: string;
  question: Question;
  /** 卷面配分（exam.items 优先，回退 question.score）。 */
  score: number;
  /** 基准题序中的位次（1 起）。 */
  originalIndex: number;
  /** 答题者卷面上按位置重编号的字母。 */
  displayKeys: string[];
  /** 显示字母 → 原题选项键。 */
  toOriginal: Record<string, string>;
  /** 原题选项键 → 显示字母。 */
  fromOriginal: Record<string, string>;
  /** 显示顺序串，如 "C·A·D·B"。 */
  orderText: string;
  /** 选项顺序是否与原题不同。 */
  changed: boolean;
}

/** 卷面。 */
export interface BuiltPaper {
  examId: string;
  studentId: string;
  mode: PaperMode;
  cfg: PlumConfig;
  /** 置换身份：标准卷恒为 "STD"，梅花卷为学号。 */
  variantKey: string;
  /** 卷号标签，如 "0101 号卷"。 */
  variantLabel: string;
  /** 种子标签。 */
  seedLabel: string;
  items: BuiltPaperItem[];
}

/** 题型序号；未登记题型排末尾。 */
export function typeRank(type: string): number {
  const index = TYPE_ORDER.indexOf(type as Question["type"]);
  return index === -1 ? TYPE_ORDER.length : index;
}

/** 取题目的难度等级（缺省中等）。 */
export function difficultyOf(
  question: Question | undefined,
  difficultyLevels: Record<string, number>,
): number {
  if (!question) return 2;
  for (const tagId of question.tags) {
    const level = difficultyLevels[tagId];
    if (level) return level;
  }
  return 2;
}

/**
 * 标准题序：先按题型分块，组内按难度由易到难；同题型同难度保持原选题顺序。
 */
export function canonicalOrder(
  exam: Pick<ExamPaper, "questionIds">,
  getQuestion: (id: string) => Question | undefined,
  difficultyLevels: Record<string, number>,
): string[] {
  const ids = [...exam.questionIds];
  const seq: Record<string, number> = {};
  ids.forEach((id, i) => {
    seq[id] = i;
  });

  return ids.sort((a, b) => {
    const qa = getQuestion(a);
    const qb = getQuestion(b);
    const ra = typeRank(qa?.type ?? "");
    const rb = typeRank(qb?.type ?? "");
    if (ra !== rb) return ra - rb;
    const da = difficultyOf(qa, difficultyLevels);
    const db = difficultyOf(qb, difficultyLevels);
    if (da !== db) return da - db;
    return (seq[a] ?? 0) - (seq[b] ?? 0);
  });
}

/** 题型分块：沿基准题序切「连续同类型」段。 */
export function typeBlocks(
  ids: string[],
  getQuestion: (id: string) => Question | undefined,
): Array<{ type: string; ids: string[] }> {
  const blocks: Array<{ type: string; ids: string[] }> = [];
  ids.forEach((id) => {
    const question = getQuestion(id);
    const type = question?.type ?? "";
    const last = blocks[blocks.length - 1];
    if (last && last.type === type) {
      last.ids.push(id);
    } else {
      blocks.push({ type, ids: [id] });
    }
  });
  return blocks;
}

/** 归一化卷型配置：模式非法时回退到试卷自带配置。 */
export function normalizeConfig(
  exam: Pick<ExamPaper, "id" | "plum">,
  input?: Partial<PlumConfig>,
): PlumConfig {
  const mode: PaperMode =
    input?.mode && input.mode in PAPER_MODES ? input.mode : exam.plum?.mode ?? "standard";
  const seed = input?.seed && input.seed.trim() ? input.seed.trim() : autoSeed(exam.id);
  return { mode, seed };
}

/** 置换身份：标准卷恒为 "STD"；梅花卷按答题者区分。 */
export function variantKeyOf(cfg: PlumConfig, studentId: string): string {
  return cfg.mode === "standard" ? "STD" : studentId;
}

/** 卷号标签。 */
export function variantLabelOf(cfg: PlumConfig, studentId: string): string {
  if (cfg.mode === "standard") return "标准卷";
  return `${studentId.slice(-4)} 号卷`;
}

/**
 * 出卷题序。
 *
 * 标准卷 / 小梅花：基准题序不变。
 * 大梅花：保留题型块先后，块内打乱。
 */
export function questionOrderOf(
  exam: Pick<ExamPaper, "id" | "questionIds" | "orderRule">,
  cfg: PlumConfig,
  variantKey: string,
  getQuestion: (id: string) => Question | undefined,
  difficultyLevels: Record<string, number>,
): string[] {
  const base =
    exam.orderRule === "manual"
      ? [...exam.questionIds]
      : canonicalOrder(exam, getQuestion, difficultyLevels);

  if (cfg.mode !== "large") return base;

  const blocks = typeBlocks(base, getQuestion);
  const out: string[] = [];
  blocks.forEach((block, bi) => {
    const seedKey = `${exam.id}|${cfg.seed}|${variantKey}|qorder|${bi}|${block.type}`;
    out.push(...shuffle(block.ids, rng(hash32(seedKey))));
  });
  return out;
}

/**
 * 取题目的卷面配分。
 *
 * `exam.items` 是配分口径的唯一来源，回退到题目默认分值。
 */
export function itemScoreOf(
  items: readonly PaperItem[] | undefined,
  questionId: string,
  question?: Question,
): number {
  for (const item of items ?? []) {
    if (item.qid === questionId) {
      const value = Number(item.score);
      if (!Number.isNaN(value)) return value;
    }
  }
  return question ? Number(question.score) || 0 : 0;
}

/** 构建答题者卷面。 */
export function buildPaper(
  exam: ExamPaper,
  studentId: string,
  cfgInput: Partial<PlumConfig> | undefined,
  getQuestion: (id: string) => Question | undefined,
  difficultyLevels: Record<string, number> = {},
): BuiltPaper {
  const cfg = normalizeConfig(exam, cfgInput);
  const variantKey = variantKeyOf(cfg, studentId);
  const order = questionOrderOf(exam, cfg, variantKey, getQuestion, difficultyLevels);

  const items: BuiltPaperItem[] = order.map((qid, index) => {
    const question = getQuestion(qid);
    const originalKeys = (question?.options ?? []).map((o) => o.key);

    // 标准卷与判断题都不置换选项。
    let displayKeys = [...originalKeys];
    if (cfg.mode !== "standard" && question?.type !== "judge") {
      const seedKey = `${exam.id}|${cfg.seed}|${variantKey}|${qid}|opt`;
      displayKeys = shuffle(originalKeys, rng(hash32(seedKey)));
    }

    // displayKeys 是**按显示顺序排列的原题选项键**。
    // 显示字母按位置重新编号（LETTERS），toOriginal 记录「显示字母 → 原题键」，
    // fromOriginal 记录「原题键 → 显示字母」——判分时用 toOriginal 还原。
    const toOriginal: Record<string, string> = {};
    const fromOriginal: Record<string, string> = {};
    displayKeys.forEach((originalKey, position) => {
      const displayLetter = LETTERS[position];
      if (!displayLetter) return;
      toOriginal[displayLetter] = originalKey;
      fromOriginal[originalKey] = displayLetter;
    });

    return {
      slot: index + 1,
      qid,
      question: question as Question,
      score: itemScoreOf(exam.items, qid, question),
      originalIndex: index + 1,
      displayKeys,
      toOriginal,
      fromOriginal,
      orderText: displayKeys.join("·"),
      changed:
        displayKeys.length !== originalKeys.length ||
        displayKeys.some((key, i) => key !== originalKeys[i]),
    };
  });

  return {
    examId: exam.id,
    studentId,
    mode: cfg.mode,
    cfg,
    variantKey,
    variantLabel: variantLabelOf(cfg, studentId),
    seedLabel: cfg.seed,
    items,
  };
}
