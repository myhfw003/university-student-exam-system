/* ==========================================================================
   CSV 解析
   --------------------------------------------------------------------------
   零依赖的 CSV 读取：试题导入（FR-CAT-07）与人员名单导入（FR-IAM-05）共用。

   - 分隔符自动识别（逗号 / 制表符 / 分号）
   - 引号包裹、字段内换行、双引号转义
   - UTF-8 优先；解出替换字符时按 GBK 重解（Excel 另存为 CSV 的常见编码）
   ========================================================================== */

/** 猜分隔符（逗号 / 制表符 / 分号）。 */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const counts: Array<[string, number]> = [
    [",", (firstLine.match(/,/g) ?? []).length],
    ["\t", (firstLine.match(/\t/g) ?? []).length],
    [";", (firstLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const best = counts[0];
  return best && best[1] > 0 ? best[0] : ",";
}

/**
 * 解析 CSV 文本为行数组。
 *
 * 支持引号包裹、字段内换行与双引号转义；去掉 UTF-8 BOM；跳过空行。
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

/**
 * 把二进制内容解码成 CSV 文本。
 *
 * UTF-8 优先；解出替换字符（U+FFFD）说明多半是 GBK 编码，再试一次。
 */
export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("�")) {
    try {
      text = new TextDecoder("gbk").decode(bytes);
    } catch {
      // 浏览器不支持 gbk 时保持 UTF-8 结果。
    }
  }
  return text;
}
