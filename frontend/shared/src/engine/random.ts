/* ==========================================================================
   知行测评 · 可复现随机源
   --------------------------------------------------------------------------
   对齐原型 shared/js/engine.js：
     hash32  —— FNV-1a 32 位散列
     rng     —— mulberry32 伪随机数发生器
     shuffle —— Fisher–Yates 洗牌

   种子键的字符串格式必须与原型**逐字一致**，否则卷面不可复现。
   ========================================================================== */

/** FNV-1a 32 位散列。 */
export function hash32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 伪随机数发生器，返回 [0,1) 区间内的函数。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates 洗牌（不改原数组）。 */
export function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * 由试卷 ID 自动派生置换种子。
 *
 * 种子不由用户输入——同卷恒定，重复出卷结果一致。
 */
export function autoSeed(examId: string): string {
  const id = String(examId || "SEED");
  return `AUTO-${hash32(id).toString(36).toUpperCase()}`;
}
