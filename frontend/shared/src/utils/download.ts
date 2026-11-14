/* ==========================================================================
   知行测评 · 文件下载
   --------------------------------------------------------------------------
   浏览器端生成文本文件并触发下载（成绩导出 CSV 等）。
   CSV 带 UTF-8 BOM，Excel 打开中文不乱码。
   ========================================================================== */

/** 转义单个 CSV 字段。 */
function escapeCell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * 生成 CSV 文本。
 *
 * @param rows 行数组，第一行通常是表头。
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

/** 触发浏览器下载一段文本。 */
export function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // 立刻回收会让部分浏览器来不及取用，延迟一拍。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 下载 CSV 文件（带 BOM，Excel 直接打开中文不乱码）。
 *
 * @param filename 文件名，例如 `场次成绩_计算机网络期中考试.csv`
 * @param rows 行数组，第一行通常是表头
 */
export function downloadCsv(
  filename: string,
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): void {
  // BOM 用转义写，避免源码里出现不规则空白。
  const text = `\uFEFF${toCsv(rows)}`;
  downloadText(filename, text, "text/csv;charset=utf-8");
}
