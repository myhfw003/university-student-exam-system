/* ==========================================================================
   知行测评 · 试题导入模板（mock 模式）
   --------------------------------------------------------------------------
   真实后端由 `GET /imports/template` 提供模板与列说明；mock 模式没有服务端，
   这里留一份**同样的**定义，让 mock 模式也能下载模板、看懂每列怎么填。

   两份定义由 `scripts/check-question-import-columns.py` 盯着：
   字段、表头、必填、说明、示例逐项对不上时 CI 直接失败——
   模板与解析规则必须同源，否则老师按模板填、导入却报错。
   ========================================================================== */

/** 导入模板里的一列。 */
export interface ImportTemplateColumn {
  /** 字段名（与服务端一致）。 */
  field: string;
  /** 表头文字。 */
  header: string;
  /** 是否必填。 */
  required: boolean;
  /** 这一列该写什么。 */
  description: string;
  /** 示例值。 */
  example: string;
}

/** 列定义（顺序即模板里的列顺序）。 */
export const IMPORT_TEMPLATE_COLUMNS: readonly ImportTemplateColumn[] = [
  {
    field: "code",
    header: "题号",
    required: false,
    description:
      "选填。留空由系统按批次自动生成（形如 IMP-12-3）。自己填时同一题库内不能重复。",
    example: "Q-001",
  },
  {
    field: "type",
    header: "题型",
    required: true,
    description:
      "必填。取值：单选题 / 多选题 / 判断题 / 简答题 / 综合题（英文 single / multi / judge / short / comprehensive 也认）。",
    example: "单选题",
  },
  {
    field: "stem",
    header: "题干",
    required: true,
    description: "必填。题干正文，可含 Markdown。",
    example: "下列关于 TCP 三次握手的说法，正确的是？",
  },
  {
    field: "options",
    header: "选项",
    required: false,
    description:
      "客观题（单选 / 多选 / 判断）必填。每行一个或用竖线分隔，形如「A. 甲|B. 乙」。判断题写「A. 正确|B. 错误」。",
    example: "A. 甲|B. 乙|C. 丙|D. 丁",
  },
  {
    field: "answer",
    header: "答案",
    required: true,
    description:
      "必填（综合题除外）：客观题填正确选项的键（多选写 A,C）；简答题填参考答案正文；判断题填 A（正确）或 B（错误）。综合题的参考答案写在「评分步骤」里。",
    example: "A",
  },
  {
    field: "steps",
    header: "评分步骤",
    required: false,
    description:
      "综合题必填。每行一步，形如「步骤编码|作答提示|分值|参考答案」，多行即多步。第四段参考答案可省，但省了发布校验过不去。",
    example: "s1|说明三次握手的每一步|5|客户端先发 SYN",
  },
  {
    field: "analysis",
    header: "解析",
    required: false,
    description: "选填。答案解析，展示给做题的人看。",
    example: "第三次握手确认了客户端的接收能力……",
  },
  {
    field: "referenceAnswer",
    header: "参考答案",
    required: false,
    description: "选填。参考答案正文（简答题建议同时填在「答案」列）。",
    example: "客户端 SYN → 服务端 SYN+ACK → 客户端 ACK",
  },
  {
    field: "score",
    header: "分值",
    required: false,
    description: "选填。1–40 之间的数字，留空按 5 分计。",
    example: "5",
  },
  {
    field: "difficulty",
    header: "难度",
    required: true,
    description:
      "必填。填系统里已存在的难度标签名（基础 / 中等 / 较难），或 1–5 的难度等级。标签不存在时该行会被跳过。",
    example: "中等",
  },
  {
    field: "tags",
    header: "知识点",
    required: false,
    description:
      "选填。知识点标签名，多个用逗号分隔。标签必须已存在，否则该行会被跳过。",
    example: "计算机网络,TCP",
  },
];

/** 模板顶部的说明。 */
export const IMPORT_TEMPLATE_NOTES: readonly string[] = [
  "本模板的列名与系统的解析规则一致：按表头自动映射，可导入 CSV（UTF-8）或 XLSX（首个工作表）。",
  "必填列：题型、题干、答案、难度（综合题的答案写在评分步骤里）。客观题还必须有选项；综合题必须有评分步骤，且分值等于各步骤分值之和。",
  "难度与知识点填的是系统里已存在的标签名，不是随便写的词——标签不存在时该行会被跳过并给出原因。",
  "一行出错只影响那一行，其余行照常导入；导入后先进候选题队列，审核发布后才生效。",
  "模板里的两行示例数据仅供对照格式，真导入前请删掉。",
];

/** 模板文件名。 */
export const IMPORT_TEMPLATE_FILE_NAME = "试题导入模板.csv";

/** 示例数据：两行，一行单选、一行简答。 */
export const IMPORT_TEMPLATE_SAMPLE_ROWS: ReadonlyArray<Record<string, string>> = [
  {
    code: "Q-001",
    type: "单选题",
    stem: "下列关于 TCP 三次握手的说法，正确的是？",
    options:
      "A. 第一次握手就能传输数据|B. 第三次握手才确认客户端接收能力|C. 三次握手是为了加密|D. 两次握手即可建立连接",
    answer: "B",
    steps: "",
    analysis: "三次握手依次确认双方的发送与接收能力，第三次握手确认客户端的接收能力。",
    referenceAnswer: "",
    score: "5",
    difficulty: "中等",
    tags: "计算机网络,TCP",
  },
  {
    code: "Q-002",
    type: "简答题",
    stem: "简述 TCP 三次握手的过程及其必要性。",
    options: "",
    answer:
      "客户端发送 SYN，服务端回复 SYN+ACK，客户端再回 ACK。三次握手用于确认双方的收发能力，避免历史连接请求造成错误建立。",
    steps: "",
    analysis: "按「谁先发起、双方各确认什么」两点作答。",
    referenceAnswer: "SYN → SYN+ACK → ACK",
    score: "10",
    difficulty: "较难",
    tags: "计算机网络",
  },
];

/** 转义单个 CSV 字段。 */
function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * 生成模板 CSV 文本。
 *
 * 带 UTF-8 BOM：Excel 打开不带 BOM 的 UTF-8 CSV 会把中文显示成乱码。
 */
export function importTemplateCsv(): string {
  const header = IMPORT_TEMPLATE_COLUMNS.map((c) => escapeCell(c.header)).join(",");
  const rows = IMPORT_TEMPLATE_SAMPLE_ROWS.map((row) =>
    IMPORT_TEMPLATE_COLUMNS.map((c) => escapeCell(row[c.field] ?? "")).join(","),
  );

  // BOM 用转义写，避免源码里出现不规则空白。
  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
}
