/* ==========================================================================
   知行测评 · 管理端纯函数
   --------------------------------------------------------------------------
   与 bits.tsx 分开：bits.tsx 只导出组件，本文件只导出函数，
   避免 react-refresh 的「文件应只导出组件」告警。
   ========================================================================== */

/** 名单范围文案。 */
export function scopeLabel(
  scope: readonly string[],
  classNameOf: (id: string) => string,
): string {
  if (scope.length === 0) return "全员开放";
  return scope.map((id) => classNameOf(id)).join("、");
}

/** 题目总分。 */
export function sumScore(items: ReadonlyArray<{ score: number }>): number {
  return items.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
}
