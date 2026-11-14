/* ==========================================================================
   知行测评 · 示例数据层（mock seed）
   --------------------------------------------------------------------------
   对齐原型 docs/ui-design/shared/js/seed.js：**逐条转写**，不缩写、不改写中文原文。
   题干 / 选项 / 解析 / 评分要点 / 评分步骤的文本均与原型逐字一致。

   组织轴：标签。题库 / 题目 / 试卷 / 练习统一挂载标签，单个对象最多 5 个。
   题目状态机：draft（草稿）→ published（已发布）→ disabled（已停用）。
   题目来源：manual（手工录入）/ import（批量导入）/ ai（AI 生成）。

   与原型的口径差异（均有明确依据，不改变数据语义）：
   1. 标签分组在 types.ts 中是英文枚举（domain / knowledge_point / ability /
      difficulty），原型用中文（领域 / 知识点 / 能力 / 难度）。本文件按 types.ts
      写英文值；中文标签仍由 TAG_GROUPS 保留，二者用 TAG_GROUP_BY_LABEL 互转。
   2. 学生用 types.ts 的 classId（c2301 / c2302）代替原型的 className
      （名单组 A / 名单组 B）；名单组显示名仍在 classes 中。
   3. types.ts 的 Question.answer 必填且为数组：主观题（简答 / 综合操作题）在原型
      没有该字段，本文件按约定写空数组 []。
   4. types.ts 的 ExamPaper 要求 passScore 与 orderRule，Practice 要求 orderRule，
      按原型 createExam / createPractice 的默认值补齐（60 / "type"）。
   5. 原型 seed 的 import / generation 批次不含 rows，types.ts 要求 rows；
      本文件用这两个批次实际采纳的候选题（q-c-01…q-c-03、q-c-04…q-c-06）回填，
      与 rowCount / count 保持一致。
   6. 原型引用了三个未定义的标签 ID（t-dom-math / t-pt-calc / t-pt-tree），
      本文件补齐，保证「引用即存在」。
   ========================================================================== */

import type {
  Bank,
  ClassGroup,
  ExamPaper,
  GenerationBatch,
  ImportBatch,
  ImportRow,
  Mistake,
  PaperTemplate,
  Practice,
  Question,
  QuestionFigure,
  QuestionKeypoint,
  QuestionOption,
  QuestionSource,
  QuestionStatus,
  QuestionStep,
  QuestionType,
  ReviewItem,
  ScoreRecord,
  Student,
  Tag,
  TagGroup,
} from "../domain/types";

/** 标签分组的中文标签（与原型一致，用于展示）。 */
export const TAG_GROUPS = ["领域", "知识点", "能力", "难度"] as const;

/** 中文标签 → types.ts 的分组枚举。 */
export const TAG_GROUP_BY_LABEL: Record<string, TagGroup> = {
  领域: "domain",
  知识点: "knowledge_point",
  能力: "ability",
  难度: "difficulty",
};

/** 单个对象最多挂载的标签数。 */
export const MAX_TAGS = 5;

/** 题型定义。 */
export const QUESTION_TYPES: ReadonlyArray<{ id: QuestionType; label: string }> =   [
      { id: "single", label: "单选题" },
      { id: "multi", label: "多选题" },
      { id: "judge", label: "判断题" },
      { id: "short", label: "简答题" },
      { id: "comprehensive", label: "综合操作题" }
    ];

/** 题型中文名。 */
export const TYPE_LABEL: Record<QuestionType, string> =   {
      single: "单选题",
      multi: "多选题",
      judge: "判断题",
      short: "简答题",
      comprehensive: "综合操作题"
    };

/** 题目状态中文名。 */
export const STATUS_LABEL: Record<QuestionStatus, string> = {
  draft: "草稿",
  published: "已发布",
  disabled: "已停用",
};

/** 题目来源中文名。 */
export const SOURCE_LABEL: Record<QuestionSource, string> = {
  manual: "手工录入",
  import: "批量导入",
  ai: "AI 生成",
};

/* ==========================================================================
   标签
   ========================================================================== */

export const TAGS: Tag[] =   [
      { id: "t-dom-calc", name: "高等数学", group: "domain" },
      { id: "t-dom-net", name: "计算机网络", group: "domain" },
      { id: "t-dom-ds", name: "数据结构", group: "domain" },
      { id: "t-dom-eng", name: "大学英语", group: "domain" },
      { id: "t-dom-marx", name: "马克思主义基础", group: "domain" },

      { id: "t-pt-limit", name: "极限与连续", group: "knowledge_point" },
      { id: "t-pt-deriv", name: "导数与微分", group: "knowledge_point" },
      { id: "t-pt-intg", name: "定积分", group: "knowledge_point" },
      { id: "t-pt-series", name: "级数", group: "knowledge_point" },
      { id: "t-pt-osi", name: "OSI 与分层模型", group: "knowledge_point" },
      { id: "t-pt-switch", name: "交换与局域网", group: "knowledge_point" },
      { id: "t-pt-ip", name: "IP 与路由", group: "knowledge_point" },
      { id: "t-pt-tcp", name: "TCP 与可靠传输", group: "knowledge_point" },
      { id: "t-pt-app", name: "应用层协议", group: "knowledge_point" },
      { id: "t-pt-subnet", name: "子网划分", group: "knowledge_point" },
      { id: "t-pt-linear", name: "线性表结构", group: "knowledge_point" },
      { id: "t-pt-stack", name: "栈与队列", group: "knowledge_point" },
      { id: "t-pt-sort", name: "排序算法", group: "knowledge_point" },
      { id: "t-pt-list", name: "链表操作", group: "knowledge_point" },
      { id: "t-pt-complex", name: "复杂度分析", group: "knowledge_point" },
      { id: "t-pt-vocab", name: "词汇语义", group: "knowledge_point" },
      { id: "t-pt-grammar", name: "语法结构", group: "knowledge_point" },
      { id: "t-pt-writing", name: "学术写作", group: "knowledge_point" },
      { id: "t-pt-practice", name: "实践与认识", group: "knowledge_point" },
      { id: "t-pt-contra", name: "矛盾与普遍性", group: "knowledge_point" },
    { id: "t-dom-math", name: "数学基础", group: "domain" },
    { id: "t-pt-calc", name: "公式与计算", group: "knowledge_point" },
    { id: "t-pt-tree", name: "树与二叉树", group: "knowledge_point" },

      { id: "t-ab-calc", name: "计算求解", group: "ability" },
      { id: "t-ab-understand", name: "概念理解", group: "ability" },
      { id: "t-ab-apply", name: "应用迁移", group: "ability" },
      { id: "t-ab-express", name: "论述表达", group: "ability" },
      { id: "t-ab-implement", name: "编程实现", group: "ability" },
      { id: "t-ab-analyze", name: "归纳分析", group: "ability" },

      { id: "t-df1", name: "基础", group: "difficulty", level: 1 },
      { id: "t-df2", name: "中等", group: "difficulty", level: 2 },
      { id: "t-df3", name: "较难", group: "difficulty", level: 3 }
    ];

/* ==========================================================================
   题目
   ========================================================================== */

/** seed 阶段的题目：状态、来源、答案数组由后处理统一补齐。 */
interface SeedQuestion {
  id: string;
  type: QuestionType;
  score: number;
  status?: QuestionStatus;
  source?: QuestionSource;
  tags: string[];
  stem: string;
  options?: QuestionOption[];
  answer?: string[];
  analysis: string;
  reference?: string;
  keypoints?: QuestionKeypoint[];
  steps?: QuestionStep[];
  figure?: QuestionFigure;
  batchId?: string;
}

const BASE_QUESTIONS: SeedQuestion[] =   [
      /* ---------------- 单选题 ---------------- */
      {
        id: "q-m-01",
        type: "single",
        score: 5,
        tags: ["t-dom-calc","t-pt-limit","t-ab-calc","t-df1"],
        stem: "求极限 lim(x→0) (sin 2x) / x 的值。",
        options: [
          { key: "A", text: "2" },
          { key: "B", text: "1" },
          { key: "C", text: "0" },
          { key: "D", text: "极限不存在" }
        ],
        answer: ["A"],
        analysis: "由 sin(2x) = 2x · (sin(2x)/(2x))，当 x→0 时 sin(2x)/(2x)→1，故原式 = 2 × 1 = 2。"
      },
      {
        id: "q-m-02",
        type: "single",
        score: 5,
        tags: ["t-dom-calc","t-pt-deriv","t-ab-calc","t-df2"],
        stem: "设 f(x) = x³ − 2x² + x，则 f′(1) 的值为（　）。",
        options: [
          { key: "A", text: "0" },
          { key: "B", text: "1" },
          { key: "C", text: "2" },
          { key: "D", text: "3" }
        ],
        answer: ["A"],
        analysis: "f′(x) = 3x² − 4x + 1，代入 x = 1 得 f′(1) = 3 − 4 + 1 = 0。"
      },
      {
        id: "q-m-03",
        type: "single",
        score: 5,
        tags: ["t-dom-calc","t-pt-intg","t-ab-calc","t-df2"],
        stem: "曲线 y = eˣ 在区间 [0, ln 2] 上与 x 轴所围成的面积为（　）。",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
          { key: "C", text: "2 − e⁻¹" },
          { key: "D", text: "e² − 1" }
        ],
        answer: ["A"],
        analysis: "面积 = ∫₀^{ln2} eˣ dx = eˣ |₀^{ln2} = 2 − 1 = 1。"
      },
      {
        id: "q-e-01",
        type: "single",
        score: 5,
        tags: ["t-dom-eng","t-pt-vocab","t-ab-understand","t-df1"],
        stem: "Choose the word closest in meaning to \"Nevertheless\":",
        options: [
          { key: "A", text: "However" },
          { key: "B", text: "Moreover" },
          { key: "C", text: "Therefore" },
          { key: "D", text: "Furthermore" }
        ],
        answer: ["A"],
        analysis: "Nevertheless 表示\"尽管如此\"，与 However 意义最接近；Moreover / Furthermore 表示递进，Therefore 表示因果。"
      },
      {
        id: "q-e-02",
        type: "single",
        score: 5,
        tags: ["t-dom-eng","t-pt-grammar","t-ab-understand","t-df2"],
        stem: "Neither of the two students ___ been to the national library.",
        options: [
          { key: "A", text: "has" },
          { key: "B", text: "have" },
          { key: "C", text: "is" },
          { key: "D", text: "are" }
        ],
        answer: ["A"],
        analysis: "Neither of + 复数名词作主语时，谓语动词用单数；neither 本身即否定意义，句中不再加 not。"
      },
      {
        id: "q-n-01",
        type: "single",
        score: 5,
        tags: ["t-dom-net","t-pt-osi","t-ab-understand","t-df1"],
        stem: "在 OSI 参考模型中，负责为端到端连接提供可靠数据传输的是（　）。",
        options: [
          { key: "A", text: "传输层" },
          { key: "B", text: "网络层" },
          { key: "C", text: "数据链路层" },
          { key: "D", text: "会话层" }
        ],
        answer: ["A"],
        analysis: "传输层（TCP/UDP）负责端到端的可靠传输；网络层负责分组路由，数据链路层负责帧转发，会话层负责会话管理。"
      },
      {
        id: "q-n-02",
        type: "single",
        score: 5,
        tags: ["t-dom-net","t-pt-ip","t-ab-understand","t-df1"],
        stem: "IPv4 地址由多少位二进制数构成？",
        options: [
          { key: "A", text: "32 位" },
          { key: "B", text: "48 位" },
          { key: "C", text: "64 位" },
          { key: "D", text: "128 位" }
        ],
        answer: ["A"],
        analysis: "IPv4 地址长度为 32 位，通常以点分十进制表示；IPv6 地址长度为 128 位。"
      },
      {
        id: "q-d-01",
        type: "single",
        score: 5,
        tags: ["t-dom-ds","t-pt-linear","t-ab-calc","t-df2"],
        stem: "在长度为 n 的顺序表中删除任意一个元素，所需移动元素的平均次数为（　）。",
        options: [
          { key: "A", text: "(n − 1) / 2" },
          { key: "B", text: "n" },
          { key: "C", text: "n / 2" },
          { key: "D", text: "1" }
        ],
        answer: ["A"],
        analysis: "删除第 i 个元素需移动 n − i 个元素，i 取 1…n 时平均为 (n−1)/2 次。"
      },
      {
        id: "q-p-01",
        type: "single",
        score: 5,
        tags: ["t-dom-marx","t-pt-practice","t-ab-understand","t-df1"],
        stem: "在实践与认识的关系中，起决定作用的是（　）。",
        options: [
          { key: "A", text: "实践" },
          { key: "B", text: "认识" },
          { key: "C", text: "理论" },
          { key: "D", text: "经验" }
        ],
        answer: ["A"],
        analysis: "实践是认识的基础：实践是认识的来源、动力、目的，也是检验认识真理性的唯一标准。"
      },

      /* ---------------- 多选题 ---------------- */
      {
        id: "q-m-04",
        type: "multi",
        score: 6,
        tags: ["t-dom-calc","t-pt-limit","t-ab-understand","t-df2"],
        stem: "下列函数中，在 ℝ 上处处连续的有（　）。",
        options: [
          { key: "A", text: "f(x) = x² + 1" },
          { key: "B", text: "f(x) = |x − 1|" },
          { key: "C", text: "f(x) = 1 / (x − 2)" },
          { key: "D", text: "f(x) = sin x" }
        ],
        answer: ["A", "B", "D"],
        analysis: "多项式与复合函数在定义域上连续；C 在 x = 2 处无定义，不满足处处连续。"
      },
      {
        id: "q-m-05",
        type: "multi",
        score: 6,
        tags: ["t-dom-calc","t-pt-series","t-ab-apply","t-df3"],
        stem: "下列级数中绝对收敛的有（　）。",
        options: [
          { key: "A", text: "∑ (−1)ⁿ / n" },
          { key: "B", text: "∑ 1 / n²" },
          { key: "C", text: "∑ (−1)ⁿ / √n" },
          { key: "D", text: "∑ 2ⁿ / n!" }
        ],
        answer: ["B", "D"],
        analysis: "B 为 p 级数 p = 2 绝对收敛；D 由比值判别法收敛且 ∑2ⁿ/n! = e² − 1；A、C 条件收敛而非绝对收敛。"
      },
      {
        id: "q-e-03",
        type: "multi",
        score: 6,
        tags: ["t-dom-eng","t-pt-writing","t-ab-apply","t-df2"],
        stem: "在学术写作中，下列表达与 \"conduct a study\" 意义相近的有（　）。",
        options: [
          { key: "A", text: "carry out research" },
          { key: "B", text: "perform an experiment" },
          { key: "C", text: "make a discovery" },
          { key: "D", text: "undertake an investigation" }
        ],
        answer: ["A", "B", "D"],
        analysis: "conduct a study 强调\"开展一项研究\"，可替换为 carry out research / perform an experiment / undertake an investigation；make a discovery 强调\"做出发现\"，语义不同。"
      },
      {
        id: "q-n-03",
        type: "multi",
        score: 6,
        tags: ["t-dom-net","t-pt-app","t-ab-understand","t-df2"],
        stem: "下列协议中，属于 TCP/IP 体系结构应用层协议的有（　）。",
        options: [
          { key: "A", text: "HTTP" },
          { key: "B", text: "FTP" },
          { key: "C", text: "SMTP" },
          { key: "D", text: "IP" }
        ],
        answer: ["A", "B", "C"],
        analysis: "HTTP、FTP、SMTP 都是应用层协议；IP 属于网际层（网络层）协议。"
      },
      {
        id: "q-d-02",
        type: "multi",
        score: 6,
        tags: ["t-dom-ds","t-pt-linear","t-ab-understand","t-df1"],
        stem: "下列数据结构中，属于线性结构的有（　）。",
        options: [
          { key: "A", text: "栈" },
          { key: "B", text: "队列" },
          { key: "C", text: "二叉树" },
          { key: "D", text: "图" }
        ],
        answer: ["A", "B"],
        analysis: "栈与队列是操作受限的线性表；树与图属于非线性结构。"
      },
      {
        id: "q-p-02",
        type: "multi",
        score: 6,
        tags: ["t-dom-marx","t-pt-contra","t-ab-analyze","t-df3"],
        stem: "关于矛盾的普遍性与特殊性的关系，下列说法正确的有（　）。",
        options: [
          { key: "A", text: "普遍性寓于特殊性之中" },
          { key: "B", text: "特殊性包含普遍性" },
          { key: "C", text: "二者在一定条件下相互转化" },
          { key: "D", text: "普遍性可以脱离特殊性独立存在" }
        ],
        answer: ["A", "B", "C"],
        analysis: "普遍性寓于特殊性之中，并通过特殊性表现出来；特殊性中包含普遍性，二者在一定条件下可以相互转化；普遍性不能脱离特殊性而独立存在，故 D 错误。"
      },

      /* ---------------- 判断题 ---------------- */
      {
        id: "q-n-04",
        type: "judge",
        score: 4,
        tags: ["t-dom-net","t-pt-switch","t-ab-understand","t-df1"],
        stem: "以太网交换机的主要功能工作在数据链路层。",
        answer: ["A"],
        analysis: "交换机依据 MAC 地址表转发数据帧，属于数据链路层设备；路由器工作在网络层，依据 IP 路由表转发分组。"
      },
      {
        id: "q-m-06",
        type: "judge",
        score: 4,
        tags: ["t-dom-calc","t-pt-limit","t-ab-understand","t-df2"],
        stem: "若函数在闭区间 [a, b] 上连续，则它在 [a, b] 上必能取到最大值和最小值。",
        answer: ["A"],
        analysis: "这正是闭区间上连续函数的最值定理：最值存在且可取到。"
      },
      {
        id: "q-e-04",
        type: "judge",
        score: 4,
        tags: ["t-dom-eng","t-pt-grammar","t-ab-understand","t-df1"],
        stem: "句子 \"There is a lot of people at the party.\" 的主谓一致是正确的。",
        answer: ["B"],
        analysis: "a lot of 修饰可数名词复数时谓语用复数，应改为 There are a lot of people at the party."
      },
      {
        id: "q-d-03",
        type: "judge",
        score: 4,
        tags: ["t-dom-ds","t-pt-sort","t-ab-analyze","t-df2"],
        stem: "快速排序在最好情况下的时间复杂度为 O(n log n)。",
        answer: ["A"],
        analysis: "快速排序最好情况是每次划分较均衡，递归深度 log n，每层 O(n)，总复杂度 O(n log n)；最坏情况（已有序）为 O(n²)。"
      },

      /* ---------------- 简答题 ---------------- */
      {
        id: "q-m-07",
        type: "short",
        score: 8,
        tags: ["t-dom-calc","t-pt-limit","t-ab-express","t-df2"],
        stem: "简述函数在一点处连续与在该点处极限存在之间的关系，并写出连续函数的运算性质。",
        keypoints: [
          { text: "连续的定义：f(x₀) 有定义，且 lim(x→x₀) f(x) = f(x₀)", keywords: ["定义", "f(x0)", "f(x₀)", "极限等于函数值", "存在", "有定义"] },
          { text: "极限存在是连续的必要条件，连续是极限存在的充分条件之一", keywords: ["必要", "充分", "极限"] },
          { text: "四则运算：和、差、积在连续点处连续", keywords: ["四则", "和", "差", "积", "运算"] },
          { text: "复合函数与反函数在对应点处保持连续性", keywords: ["复合", "反函数"] }
        ],
        reference: "f(x) 在 x₀ 连续 ⇔ f(x₀) 有定义且 lim(x→x₀⁺) f(x) = lim(x→x₀⁻) f(x) = f(x₀)。因此极限存在只是连续的必要条件。连续函数在一点处连续，则在该点的邻域内保持同样的连续性；和、差、积以及复合函数在相应点处仍然连续（商要求分母不为零）。",
        analysis: "评分要点：连续的定义式、极限与连续的条件关系、四则运算与复合函数的连续性三条主线。"
      },
      {
        id: "q-n-05",
        type: "short",
        score: 8,
        tags: ["t-dom-net","t-pt-tcp","t-ab-express","t-df3"],
        stem: "简述 TCP 建立连接的三次握手过程，并说明为什么需要三次而不能只握手两次。",
        keypoints: [
          { text: "第一次：客户端发送 SYN(seq=x) 进入 SYN_SENT", keywords: ["第一次", "SYN", "seq", "客户端"] },
          { text: "第二次：服务器回送 SYN(seq=y)+ACK(ack=x+1) 进入 SYN_RCVD", keywords: ["第二次", "SYN", "ACK", "服务器", "seq", "ack"] },
          { text: "第三次：客户端发送 ACK(ack=y+1)，连接建立", keywords: ["第三次", "ACK", "ack", "客户端"] },
          { text: "两次握手无法确认客户端收到服务器的 SYN，可能因历史延迟报文导致错误建立连接", keywords: ["两次", "延迟", "确认", "历史", "错误"] }
        ],
        reference: "三次握手的目的不只是交换序号，还要让通信双方互相确认对方的收发能力正常，并同步双方的初始序号。两次握手时服务器无法确认客户端的接收能力，旧的重复 SYN 报文到达时服务器可能错误地建立连接；第三次握手使客户端确认了服务器的 SYN，避免这一缺陷。",
        analysis: "评分要点：三次报文各自的状态与序号、以及\"两次握手为何不安全\"的原因分析。"
      },
      {
        id: "q-d-04",
        type: "short",
        score: 8,
        tags: ["t-dom-ds","t-pt-stack","t-ab-express","t-df2"],
        stem: "比较栈与队列的存储结构和典型应用场景。",
        keypoints: [
          { text: "栈的特点：后进先出（LIFO），只允许在一端（栈顶）插入和删除", keywords: ["后进先出", "LIFO", "栈顶", "一端"] },
          { text: "队列的特点：先进先出（FIFO），队尾插入、队头删除", keywords: ["先进先出", "FIFO", "队尾", "队头"] },
          { text: "存储方式：顺序存储与链式存储", keywords: ["顺序", "链式", "存储"] },
          { text: "典型应用：栈用于函数调用/表达式求值/回溯，队列用于排队调度/缓冲区/广度优先搜索", keywords: ["调用", "表达式", "回溯", "调度", "缓冲", "广度"] }
        ],
        reference: "栈与队列都是操作受限的线性表。栈为后进先出，队列为先进先出。两者均可采用顺序存储（数组）或链式存储（链表），顺序存储实现简单但需预估容量，链式存储动态灵活。二者典型应用：栈—函数调用栈、表达式求值、深度优先搜索、回溯；队列—打印任务排队、生产者消费者缓冲区、广度优先搜索、消息中间件。",
        analysis: "评分要点：操作特性、存储实现方式、典型应用各占一条。"
      },
      {
        id: "q-e-05",
        type: "short",
        score: 8,
        tags: ["t-dom-eng","t-pt-writing","t-ab-express","t-df2"],
        stem: "简述学术论文写作中使用被动语态的原则，并给出一处恰当使用被动语态的情境。",
        keypoints: [
          { text: "被动语态用于动作执行者不重要或不明确时", keywords: ["执行者", "不重要", "不明确", "不明确"] },
          { text: "用于描述客观事实、实验过程或方法步骤", keywords: ["客观", "实验", "过程", "方法", "步骤"] },
          { text: "避免过度使用，被动语态过多会削弱句子的主动性与责任主体", keywords: ["避免", "过度", "削弱", "主动"] },
          { text: "举例：实验结果被记录在日志中 / 数据由实验者采集", keywords: ["例如", "被记录", "日志", "采集", "例"] }
        ],
        reference: "学术写作强调客观性，当动作执行者不重要、或需要突出受事与过程时使用被动语态，如 \"The samples were collected at a depth of 200 m.\" 但过度使用被动语态会弱化句子的主动性，正式文体中宜在保证客观性的前提下适度使用主动语态。",
        analysis: "评分要点：使用条件、客观性作用、限度提醒、具体情境示例。"
      },
      {
        id: "q-p-03",
        type: "short",
        score: 8,
        tags: ["t-dom-marx","t-pt-practice","t-ab-express","t-df2"],
        stem: "简述实践是检验真理的唯一标准的原理，并说明其方法论意义。",
        keypoints: [
          { text: "实践是主观与客观相联系的桥梁", keywords: ["桥梁", "主观", "客观", "联系"] },
          { text: "实践具有直接现实性，能把主观认识与客观实际加以对照", keywords: ["直接现实性", "对照", "检验"] },
          { text: "逻辑证明不能代替实践检验，两者是相互补充的关系", keywords: ["逻辑证明", "补充", "不能代替", "相互"] },
          { text: "方法论意义：坚持实践第一的观点，反对教条主义与经验主义", keywords: ["方法论", "第一", "教条主义", "经验主义", "反对"] }
        ],
        reference: "实践之所以是检验真理的唯一标准，在于实践具有直接现实性，能把主观认识同客观实际联系起来加以对照。逻辑证明在实践检验中起辅助作用，二者相辅相成。方法论上要求坚持实践第一的观点，一切从实际出发，反对教条主义和经验主义。",
        analysis: "评分要点：直接现实性、逻辑证明的地位、方法论结论。"
      },

      /* ---------------- 综合操作题 ---------------- */
      {
        id: "q-d-05",
        type: "comprehensive",
        score: 18,
        tags: ["t-dom-ds","t-pt-list","t-ab-implement","t-df3"],
        stem: "给定带头结点的单链表 L，要求就地反转链表并返回新的头结点。请写出算法思想、C 代码与复杂度分析。",
        steps: [
          {
            id: "s1",
            prompt: "第一步：写出算法思想（不少于 3 条要点）。",
            answer: "采用\"三指针\"一趟扫描法：pre 指向当前结点的前驱（初值为 NULL），cur 指向当前结点（初值为头结点的 next），next 保存 cur 的后继。每轮循环先把 cur->next 指向 pre 实现指针翻转，再让 pre、cur 后移，直到 cur 为 NULL。注意头结点不参与反转，最终返回 pre。",
            keywords: ["三指针", "pre", "cur", "next", "翻转", "头结点"],
            score: 5
          },
          {
            id: "s2",
            prompt: "第二步：写出可编译的 C 代码。",
            answer: "Node * reverse(Node *head) {\n  Node *pre = NULL, *cur = head->next, *next;\n  while (cur != NULL) {\n    next = cur->next;\n    cur->next = pre;\n    pre = cur;\n    cur = next;\n  }\n  head->next = pre;\n  return head;\n}",
            keywords: ["reverse", "pre = NULL", "cur = head->next", "cur->next = pre", "head->next = pre", "return head"],
            score: 8
          },
          {
            id: "s3",
            prompt: "第三步：分析时间复杂度与空间复杂度，并说明为何不需要重新申请结点空间。",
            answer: "每个结点只被访问一次，时间复杂度 O(n)；只使用了三个指针变量，空间复杂度 O(1)。之所以不需要额外空间，是因为就地翻转通过改变已有结点的 next 指针完成，未创建新结点。",
            keywords: ["O(n)", "O(1)", "一次", "指针变量", "没有申请", "未创建", "就地"],
            score: 5
          }
        ],
        analysis: "综合题按分步给分：算法思想 5 分、代码 8 分、复杂度分析 5 分，代码需体现头结点不参与反转。"
      },
      {
        id: "q-n-06",
        type: "comprehensive",
        score: 18,
        tags: ["t-dom-net","t-pt-subnet","t-ab-apply","t-df3"],
        stem: "某单位申请到地址块 192.168.10.0/24，需要划分为 4 个等大的子网并分配给 4 个部门。请完成子网划分、地址范围计算，并写出部门 B 主机 192.168.10.100 到部门 D 主机 192.168.10.200 的路由表项。",
        steps: [
          {
            id: "s1",
            prompt: "第一步：写出子网掩码与各子网的网络地址。",
            answer: "借 2 位主机位，子网掩码为 255.255.255.192（/26）。四个子网网络地址依次为 192.168.10.0、192.168.10.64、192.168.10.128、192.168.10.192，依次分配给 A、B、C、D 部门。",
            keywords: ["255.255.255.192", "/26", "192.168.10.0", "192.168.10.64", "192.168.10.128", "192.168.10.192", "借 2 位", "借2位"],
            score: 6
          },
          {
            id: "s2",
            prompt: "第二步：列出每个子网的可用主机地址范围与可用主机数。",
            answer: "子网 1（部门 A）：192.168.10.1 ~ 192.168.10.62，可用 62 台；子网 2（部门 B）：192.168.10.65 ~ 192.168.10.126，可用 62 台；子网 3（部门 C）：192.168.10.129 ~ 192.168.10.190，可用 62 台；子网 4（部门 D）：192.168.10.193 ~ 192.168.10.254，可用 62 台。每个子网主机位 6 位，主机数 2⁶ − 2 = 62。",
            keywords: ["192.168.10.65", "192.168.10.126", "192.168.10.129", "192.168.10.190", "192.168.10.193", "192.168.10.254", "62", "2⁶", "2^6"],
            score: 6
          },
          {
            id: "s3",
            prompt: "第三步：写出路由表项（目的网络、下一跳、接口）。",
            answer: "目的网络 192.168.10.128/26（部门 C），下一跳为路由器 R1 的内网地址 10.0.0.1，出口接口 eth0；目的网络 192.168.10.192/26（部门 D），下一跳为路由器 R2 的内网地址 10.0.0.2，出口接口 eth0。",
            keywords: ["192.168.10.128", "192.168.10.192", "10.0.0.1", "10.0.0.2", "eth0", "下一跳"],
            score: 6
          }
        ],
        analysis: "综合题按步骤给分：掩码与网络地址 6 分、地址范围与主机数 6 分、路由表 6 分。"
      },
      {
        id: "q-m-08",
        type: "comprehensive",
        score: 18,
        tags: ["t-dom-calc","t-pt-intg","t-ab-apply","t-df3"],
        stem: "设平面区域 D 由抛物线 y = x² 与直线 y = x + 2 围成。求 D 的面积、绕 x 轴旋转所得旋转体的体积，并计算 D 的形心横坐标。",
        figure: { type: "parabola" },
        steps: [
          {
            id: "s1",
            prompt: "第一步：求交点并确定积分上下限。",
            answer: "令 x² = x + 2，得 x² − x − 2 = 0，解得 x = −1 或 x = 2。当 x ∈ [−1, 2] 时直线 y = x + 2 在抛物线 y = x² 之上，故积分上下限为 −1 到 2。",
            keywords: ["x = -1", "x = 2", "x = −1", "x = 2", "[-1, 2]", "[−1, 2]", "交点", "上下限"],
            score: 5
          },
          {
            id: "s2",
            prompt: "第二步：计算面积。",
            answer: "S = ∫₋₁² [(x + 2) − x²] dx = [x²/2 + 2x − x³/3]₋₁² = (2 + 4 − 8/3) − (1/2 − 2 + 1/3) = 10/3 + 7/6 = 9/2，即面积为 9/2。",
            keywords: ["9/2", "4.5", "积分", "x + 2 - x^2", "x²"],
            score: 6
          },
          {
            id: "s3",
            prompt: "第三步：计算绕 x 轴的旋转体体积与形心横坐标。",
            answer: "V = π ∫₋₁² [(x + 2)² − x⁴] dx = π ∫₋₁² (−x⁴ + x² + 4x + 4) dx = π·(23/5 + 8/3 + 8) = π·(259/15)。形心横坐标 x̄ = ∫₋₁² x[(x+2) − x²] dx ÷ (9/2) = (1/6) ÷ (9/2) = 1/27。",
            keywords: ["259", "23/5", "1/27", "旋转体", "形心", "圆盘法"],
            score: 7
          }
        ],
        analysis: "综合题按步骤给分：交点与上下限 5 分、面积 6 分、体积与形心 7 分。"
      }
    ];

const STOPPED_QUESTIONS: SeedQuestion[] =   [
      {
        id: "q-d-06",
        type: "single",
        score: 5,
        tags: ["t-dom-ds", "t-pt-stack", "t-df1"],
        stem: "若一个栈的入栈序列依次为 1、2、3、4，则不可能的出栈序列是：",
        options: [
          { key: "A", text: "4, 3, 2, 1" },
          { key: "B", text: "1, 4, 3, 2" },
          { key: "C", text: "2, 1, 4, 3" },
          { key: "D", text: "4, 1, 2, 3" }
        ],
        answer: ["D"],
        analysis: "4 最先出栈说明 1、2、3 已全部压栈，此时栈顶必为 3，随后只能依次弹出 3、2、1，因此 4,1,2,3 不可能出现。"
      },
      {
        id: "q-n-07",
        type: "judge",
        score: 2,
        tags: ["t-dom-net", "t-pt-app", "t-df1"],
        stem: "HTTP/2 在应用层使用二进制分帧编码，并可在同一条连接上并发承载多个请求。",
        options: [{ key: "A", text: "正确" }, { key: "B", text: "错误" }],
        answer: ["A"],
        analysis: "HTTP/2 引入二进制分帧层，把请求与响应拆成帧复用到同一条 TCP 连接，天然支持多路复用。"
      }
    ];

const CANDIDATE_QUESTIONS: SeedQuestion[] =   [
      {
        id: "q-c-01",
        type: "single",
        score: 5,
        tags: ["t-dom-math", "t-pt-calc", "t-df2"],
        stem: "在等差数列 {a_n} 中，若 a_3 = 7，a_7 = 15，则该数列的通项公式是：",
        options: [
          { key: "A", text: "a_n = 2n + 1" },
          { key: "B", text: "a_n = 2n + 3" },
          { key: "C", text: "a_n = 2n - 1" },
          { key: "D", text: "a_n = 4n - 5" }
        ],
        answer: ["A"],
        analysis: "公差 d = (15 - 7) / (7 - 3) = 2，a_1 = 7 - 2 × 2 = 3，故 a_n = 3 + 2(n - 1) = 2n + 1。",
        status: "draft",
        source: "import",
        batchId: "imp-2026-11-10-01"
      },
      {
        id: "q-c-02",
        type: "multi",
        score: 6,
        tags: ["t-dom-math", "t-pt-calc", "t-df2"],
        stem: "下列说法中，属于一元二次方程特征的有：",
        options: [
          { key: "A", text: "只含一个未知数" },
          { key: "B", text: "未知数最高次数为 2" },
          { key: "C", text: "未知数系数均为常数且不为 0" },
          { key: "D", text: "含两个未知数" }
        ],
        answer: ["A", "B", "C"],
        analysis: "一元二次方程只含一个未知数，未知数最高次数为 2，且二次项系数不为 0；含两个未知数则属二元方程。",
        status: "draft",
        source: "import",
        batchId: "imp-2026-11-10-01"
      },
      {
        id: "q-c-03",
        type: "single",
        score: 5,
        tags: ["t-dom-net", "t-pt-tcp", "t-df2"],
        stem: "TCP 三次握手中，客户端发送的第一个报文段携带的标志位是：",
        options: [
          { key: "A", text: "SYN = 1, ACK = 0" },
          { key: "B", text: "SYN = 1, ACK = 1" },
          { key: "C", text: "FIN = 1, ACK = 0" },
          { key: "D", text: "RST = 1, ACK = 1" }
        ],
        answer: ["A"],
        analysis: "第一次握手由客户端发起 SYN 且尚未收到任何数据，故 ACK 位置 0；服务器回 SYN + ACK，客户端再回 ACK 完成握手。",
        status: "draft",
        source: "import",
        batchId: "imp-2026-11-10-01"
      },
      {
        id: "q-c-04",
        type: "single",
        score: 5,
        tags: ["t-dom-ds", "t-pt-sort", "t-df2"],
        stem: "对长度为 n 的序列做归并排序，其时间复杂度是：",
        options: [
          { key: "A", text: "O(log n)" },
          { key: "B", text: "O(n)" },
          { key: "C", text: "O(n log n)" },
          { key: "D", text: "O(n²)" }
        ],
        answer: ["C"],
        analysis: "归并排序把序列分成两半递归排序再合并，层数为 log n，每层合并代价为 O(n)，故总复杂度为 O(n log n)。",
        status: "draft",
        source: "ai",
        batchId: "gen-2026-11-10-01"
      },
      {
        id: "q-c-05",
        type: "multi",
        score: 6,
        tags: ["t-dom-ds", "t-pt-tree", "t-df3"],
        stem: "关于二叉搜索树（BST），下列说法正确的有：",
        options: [
          { key: "A", text: "中序遍历得到有序序列" },
          { key: "B", text: "任意节点的左子树所有键值均小于该节点" },
          { key: "C", text: "任意节点的右子树所有键值均大于该节点" },
          { key: "D", text: "插入顺序不会影响树形" }
        ],
        answer: ["A", "B", "C"],
        analysis: "BST 的定义即左小右大，因此中序遍历必为有序序列；插入顺序不同会得到不同树形，故 D 错误。",
        status: "draft",
        source: "ai",
        batchId: "gen-2026-11-10-01"
      },
      {
        id: "q-c-06",
        type: "judge",
        score: 2,
        tags: ["t-dom-net", "t-pt-app", "t-df1"],
        stem: "在传输层中，UDP 是面向连接的协议，TCP 是无连接的协议。",
        options: [{ key: "A", text: "正确" }, { key: "B", text: "错误" }],
        answer: ["B"],
        analysis: "恰好相反：UDP 无连接、开销小；TCP 面向连接，提供可靠传输与拥塞控制。",
        status: "draft",
        source: "ai",
        batchId: "gen-2026-11-10-01"
      }
    ];

/**
 * 判断题只有「正确 / 错误」两项，缺选项时统一补齐，
 * 保证题面渲染与梅花卷置换算法统一处理。
 */
function defaultOptionsOf(question: SeedQuestion): QuestionOption[] | undefined {
  if (
    (question.type === "judge" || question.type === "single" || question.type === "multi") &&
    !question.options
  ) {
    return [
      { key: "A", text: "正确" },
      { key: "B", text: "错误" },
    ];
  }
  return question.options;
}

/** 把 seed 阶段的题目装配成 types.ts 的 Question。 */
function toQuestion(seed: SeedQuestion, status: QuestionStatus, source: QuestionSource): Question {
  const question: Question = {
    id: seed.id,
    type: seed.type,
    score: seed.score,
    status,
    source,
    tags: seed.tags,
    stem: seed.stem,
    answer: seed.answer ?? [],
    analysis: seed.analysis,
  };
  const options = defaultOptionsOf(seed);
  if (options) question.options = options;
  if (seed.reference !== undefined) question.reference = seed.reference;
  if (seed.keypoints !== undefined) question.keypoints = seed.keypoints;
  if (seed.steps !== undefined) question.steps = seed.steps;
  if (seed.figure !== undefined) question.figure = seed.figure;
  if (seed.batchId !== undefined) question.batchId = seed.batchId;
  return question;
}

/**
 * 原型 seed 的后处理，逐条照搬：
 * 1. 客观题缺选项时补「正确 / 错误」两项。
 * 2. 历史题目统一为「已发布」状态，来源记为手工录入。
 * 3. 已停用题目保留在库内但不再参与组卷与练习，可随时恢复。
 * 4. 候选题保持草稿状态，来源与批次 ID 不变。
 */
function normalizeSeedQuestions(): Question[] {
  const base = BASE_QUESTIONS.map((question) => toQuestion(question, "published", "manual"));
  const stopped = STOPPED_QUESTIONS.map((question) => toQuestion(question, "disabled", "manual"));
  const candidates = CANDIDATE_QUESTIONS.map((question) =>
    toQuestion(question, "draft", question.source ?? "manual"),
  );
  return [...base, ...stopped, ...candidates];
}

export const questions: Question[] = normalizeSeedQuestions();

/* ==========================================================================
   题库 / 名单组 / 答题者
   ========================================================================== */

export const banks: Bank[] =   [
      {
        id: "bank-calc-basic",
        name: "高等数学基础题库",
        desc: "覆盖极限、导数、定积分的基础题与综合题，用于夯实计算能力。",
        tags: ["t-dom-calc", "t-ab-calc"],
        questionIds: ["q-m-01", "q-m-02", "q-m-03", "q-m-04", "q-m-05", "q-m-06", "q-m-07", "q-m-08", "q-c-01", "q-c-02"]
      },
      {
        id: "bank-net-proto",
        name: "计算机网络协议题库",
        desc: "围绕 OSI 分层、IP 路由、TCP 可靠传输与应用层协议整理。",
        tags: ["t-dom-net", "t-pt-tcp"],
        questionIds: ["q-n-01", "q-n-02", "q-n-03", "q-n-04", "q-n-05", "q-n-06", "q-n-07", "q-c-03", "q-c-06"]
      },
      {
        id: "bank-ds-algo",
        name: "数据结构算法题库",
        desc: "线性表、栈队列、排序算法与链表编程题集合。",
        tags: ["t-dom-ds", "t-ab-implement"],
        questionIds: ["q-d-01", "q-d-02", "q-d-03", "q-d-04", "q-d-05", "q-d-06", "q-c-04", "q-c-05"]
      },
      {
        id: "bank-eng-write",
        name: "英语表达与学术写作题库",
        desc: "词汇语义、语法一致性与学术写作常见错误订正。",
        tags: ["t-dom-eng", "t-pt-writing"],
        questionIds: ["q-e-01", "q-e-02", "q-e-03", "q-e-04", "q-e-05"]
      },
      {
        id: "bank-marx-theory",
        name: "思政理论题库",
        desc: "马克思主义认识论与矛盾观的单选、论述题目。",
        tags: ["t-dom-marx", "t-ab-express"],
        questionIds: ["q-p-01", "q-p-02", "q-p-03"]
      }
    ];

export const classes: ClassGroup[] =   [
      { id: "c2301", name: "名单组 A" },
      { id: "c2302", name: "名单组 B" }
    ];

export const students: Student[] =   [
      { id: "2023120101", name: "林知远", classId: "c2301", enrollYear: 2023 },
      { id: "2023120102", name: "沈书桐", classId: "c2301", enrollYear: 2023 },
      { id: "2023120103", name: "周慕安", classId: "c2301", enrollYear: 2023 },
      { id: "2023120104", name: "陆延川", classId: "c2301", enrollYear: 2023 },
      { id: "2023120105", name: "许清和", classId: "c2301", enrollYear: 2023 },
      { id: "2023120106", name: "何见微", classId: "c2301", enrollYear: 2023 },
      { id: "2023120207", name: "程明澈", classId: "c2302", enrollYear: 2023 },
      { id: "2023120208", name: "苏见月", classId: "c2302", enrollYear: 2023 },
      { id: "2023120209", name: "顾行知", classId: "c2302", enrollYear: 2023 },
      { id: "2023120210", name: "袁昭明", classId: "c2302", enrollYear: 2023 },
      { id: "2023120211", name: "孟怀瑾", classId: "c2302", enrollYear: 2023 },
      { id: "2023120212", name: "夏承宇", classId: "c2302", enrollYear: 2023 }
    ];

/* ==========================================================================
   试卷 / 练习
   ========================================================================== */

export const exams: ExamPaper[] =   [
      {
        id: "exam-net-mid",
        passScore: 60,
        orderRule: "type",
        name: "计算机网络期中考试",
        batch: "2026—2027 学年第一学期 · 期中考试",
        tags: ["t-dom-net","t-pt-tcp","t-df2"],
        durationMin: 90,
        totalScore: 100,
        openAt: "2026-11-09 08:30",
        closeAt: "2026-11-09 12:00",
        status: "ongoing",
        published: true,
        allowRetake: false,
        publishAnswer: "after_close",
        scope: ["c2301", "c2302"],
        questionIds: ["q-n-01", "q-n-02", "q-n-03", "q-n-04", "q-n-05", "q-n-06", "q-m-01", "q-e-01", "q-d-01", "q-p-01"],
        items: [
          { qid: "q-n-01", score: 10 }, { qid: "q-n-02", score: 10 }, { qid: "q-n-03", score: 10 },
          { qid: "q-n-04", score: 10 }, { qid: "q-n-05", score: 10 }, { qid: "q-n-06", score: 10 },
          { qid: "q-m-01", score: 10 }, { qid: "q-e-01", score: 10 }, { qid: "q-d-01", score: 10 },
          { qid: "q-p-01", score: 10 }
        ],
        plum: { mode: "large" },
        note: "开考 20 分钟后不允许中途离场，客观题与主观题同时提交。本卷按大梅花生成：题型分块顺序不变，每个题型内部的题目顺序与选项顺序逐人打乱。"
      },
      {
        id: "exam-math-final",
        passScore: 60,
        orderRule: "type",
        name: "高等数学期末考试",
        batch: "2025—2026 学年第二学期 · 期末考试",
        tags: ["t-dom-calc","t-df3"],
        durationMin: 120,
        totalScore: 100,
        openAt: "2026-06-18 09:00",
        closeAt: "2026-06-18 11:00",
        status: "ended",
        published: true,
        allowRetake: false,
        publishAnswer: "after_close",
        scope: ["c2301", "c2302"],
        questionIds: ["q-m-01", "q-m-02", "q-m-03", "q-m-04", "q-m-05", "q-m-06", "q-m-07", "q-m-08", "q-d-02"],
        items: [
          { qid: "q-m-01", score: 10 }, { qid: "q-m-02", score: 10 }, { qid: "q-m-03", score: 10 },
          { qid: "q-m-04", score: 10 }, { qid: "q-m-05", score: 10 }, { qid: "q-m-06", score: 10 },
          { qid: "q-m-07", score: 20 }, { qid: "q-m-08", score: 10 }, { qid: "q-d-02", score: 10 }
        ],
        plum: { mode: "small" },
        note: "试卷按小梅花卷生成：题目顺序全体统一，仅每位答题者的选项顺序完全打乱，互不相同。"
      },
      {
        id: "exam-ds-quiz",
        passScore: 60,
        orderRule: "type",
        name: "数据结构随堂测验",
        batch: "2026—2027 学年第一学期 · 随堂测验",
        tags: ["t-dom-ds","t-df1"],
        durationMin: 30,
        totalScore: 30,
        openAt: "2026-10-14 10:00",
        closeAt: "2026-10-14 10:30",
        status: "ended",
        published: true,
        allowRetake: true,
        publishAnswer: "after_close",
        scope: ["c2301"],
        questionIds: ["q-d-01", "q-d-02", "q-d-03", "q-d-04"],
        items: [
          { qid: "q-d-01", score: 10 }, { qid: "q-d-02", score: 10 },
          { qid: "q-d-03", score: 5 }, { qid: "q-d-04", score: 5 }
        ],
        plum: { mode: "standard" },
        note: "标准卷，题序与选项均固定；允许重考，成绩按最高分计入。"
      }
    ];

/** seed 阶段的练习：条目、总分与上架标记由后处理补齐。 */
type PracticeSeed = Omit<Practice, "items" | "totalScore" | "published">;

const PRACTICE_SEEDS: PracticeSeed[] =   [
      {
        id: "prac-math-limit",
        orderRule: "type",
        name: "高等数学 · 极限与连续专项练习",
        tags: ["t-dom-calc","t-pt-limit","t-ab-calc"],
        questionIds: ["q-m-01", "q-m-02", "q-m-03", "q-m-04", "q-m-05", "q-m-06", "q-m-07"],
        durationMin: 25,
        status: "published",
        scope: [],
        repeats: 0,
        feedback: "after_submit",
        mistakeReflow: true,
        note: "无限次练习，提交后即时展示解析，错题自动回流至错题本。"
      },
      {
        id: "prac-net-tp",
        orderRule: "type",
        name: "计算机网络 · 传输层与协议强化练习",
        tags: ["t-dom-net","t-pt-tcp"],
        questionIds: ["q-n-01", "q-n-02", "q-n-03", "q-n-04", "q-n-05", "q-n-06"],
        durationMin: 30,
        status: "published",
        scope: ["c2301", "c2302"],
        repeats: 3,
        feedback: "after_submit",
        mistakeReflow: true,
        note: "最多可练习 3 次，提交后展示解析。"
      },
      {
        id: "prac-ds-linear",
        orderRule: "type",
        name: "数据结构 · 线性结构与算法复杂度专项",
        tags: ["t-dom-ds","t-pt-linear","t-pt-sort"],
        questionIds: ["q-d-01", "q-d-02", "q-d-03", "q-d-04", "q-d-05"],
        durationMin: 30,
        status: "published",
        scope: [],
        repeats: 0,
        feedback: "immediate",
        mistakeReflow: false,
        note: "每题作答后即时反馈解析，不回流错题本。"
      },
      {
        id: "prac-en-write",
        orderRule: "type",
        name: "大学英语 · 学术写作常见错误订正",
        tags: ["t-dom-eng","t-pt-writing"],
        questionIds: ["q-e-01", "q-e-02", "q-e-03", "q-e-04", "q-e-05"],
        durationMin: 20,
        status: "published",
        scope: [],
        repeats: 0,
        feedback: "after_submit",
        mistakeReflow: true,
        note: "提交后统一展示解析，错题回流错题本。"
      },
      {
        id: "prac-ds-draft",
        orderRule: "type",
        name: "数据结构 · 树与查找专题（草稿）",
        tags: ["t-dom-ds","t-pt-tree"],
        questionIds: ["q-d-01", "q-d-03"],
        durationMin: 20,
        status: "draft",
        scope: [],
        repeats: 0,
        feedback: "after_submit",
        mistakeReflow: true,
        note: "尚未上架，答题端不可见。"
      }
    ];

/**
 * 原型 seed 的后处理：练习卷条目与总分——每题 10 分，按题目顺序固定；
 * 上架标记由状态推导（published ⇔ status === "published"）。
 */
export const practices: Practice[] = PRACTICE_SEEDS.map((seed) => {
  // 练习配分按**题目自身分值**（与原型一致）：练习没有单独的配分表，
  // 分值就是题目在题库里的分值；总分 = 各题分值之和。
  const items = (seed.questionIds ?? []).map((qid) => ({
    qid,
    score: questions.find((q) => q.id === qid)?.score ?? 0,
  }));
  return {
    ...seed,
    items,
    totalScore: items.reduce((sum, item) => sum + item.score, 0),
    published: seed.status === "published",
  };
});

/* ==========================================================================
   内容生产：导入批次与生成批次
   ========================================================================== */

/** 导入批次实际采纳的三行（对应候选题 q-c-01 / q-c-02 / q-c-03）。 */
const IMPORT_BATCH_ROWS: ImportRow[] =   [
    {
      no: 1,
      stem: "在等差数列 {a_n} 中，若 a_3 = 7，a_7 = 15，则该数列的通项公式是：",
      type: "single",
      score: 5,
      options: [
        { key: "A", text: "a_n = 2n + 1" },
        { key: "B", text: "a_n = 2n + 3" },
        { key: "C", text: "a_n = 2n - 1" },
        { key: "D", text: "a_n = 4n - 5" }
      ],
      answer: ["A"],
      analysis:
        "公差 d = (15 - 7) / (7 - 3) = 2，a_1 = 7 - 2 × 2 = 3，故 a_n = 3 + 2(n - 1) = 2n + 1。",
      tags: ["t-dom-math", "t-pt-calc", "t-df2"],
      valid: true
    },
    {
      no: 2,
      stem: "下列说法中，属于一元二次方程特征的有：",
      type: "multi",
      score: 6,
      options: [
        { key: "A", text: "只含一个未知数" },
        { key: "B", text: "未知数最高次数为 2" },
        { key: "C", text: "未知数系数均为常数且不为 0" },
        { key: "D", text: "含两个未知数" }
      ],
      answer: ["A", "B", "C"],
      analysis:
        "一元二次方程只含一个未知数，未知数最高次数为 2，且二次项系数不为 0；含两个未知数则属二元方程。",
      tags: ["t-dom-math", "t-pt-calc", "t-df2"],
      valid: true
    },
    {
      no: 3,
      stem: "TCP 三次握手中，客户端发送的第一个报文段携带的标志位是：",
      type: "single",
      score: 5,
      options: [
        { key: "A", text: "SYN = 1, ACK = 0" },
        { key: "B", text: "SYN = 1, ACK = 1" },
        { key: "C", text: "FIN = 1, ACK = 0" },
        { key: "D", text: "RST = 1, ACK = 1" }
      ],
      answer: ["A"],
      analysis:
        "第一次握手由客户端发起 SYN 且尚未收到任何数据，故 ACK 位置 0；服务器回 SYN + ACK，客户端再回 ACK 完成握手。",
      tags: ["t-dom-net", "t-pt-tcp", "t-df2"],
      valid: true
    }
  ];

/** 生成批次实际采纳的三行（对应候选题 q-c-04 / q-c-05 / q-c-06）。 */
const GENERATION_BATCH_ROWS: ImportRow[] =   [
    {
      no: 1,
      stem: "对长度为 n 的序列做归并排序，其时间复杂度是：",
      type: "single",
      score: 5,
      options: [
        { key: "A", text: "O(log n)" },
        { key: "B", text: "O(n)" },
        { key: "C", text: "O(n log n)" },
        { key: "D", text: "O(n²)" }
      ],
      answer: ["C"],
      analysis:
        "归并排序把序列分成两半递归排序再合并，层数为 log n，每层合并代价为 O(n)，故总复杂度为 O(n log n)。",
      tags: ["t-dom-ds", "t-pt-sort", "t-df2"],
      valid: true
    },
    {
      no: 2,
      stem: "关于二叉搜索树（BST），下列说法正确的有：",
      type: "multi",
      score: 6,
      options: [
        { key: "A", text: "中序遍历得到有序序列" },
        { key: "B", text: "任意节点的左子树所有键值均小于该节点" },
        { key: "C", text: "任意节点的右子树所有键值均大于该节点" },
        { key: "D", text: "插入顺序不会影响树形" }
      ],
      answer: ["A", "B", "C"],
      analysis:
        "BST 的定义即左小右大，因此中序遍历必为有序序列；插入顺序不同会得到不同树形，故 D 错误。",
      tags: ["t-dom-ds", "t-pt-tree", "t-df3"],
      valid: true
    },
    {
      no: 3,
      stem: "在传输层中，UDP 是面向连接的协议，TCP 是无连接的协议。",
      type: "judge",
      score: 2,
      options: [
        { key: "A", text: "正确" },
        { key: "B", text: "错误" }
      ],
      answer: ["B"],
      analysis:
        "恰好相反：UDP 无连接、开销小；TCP 面向连接，提供可靠传输与拥塞控制。",
      tags: ["t-dom-net", "t-pt-app", "t-df1"],
      valid: true
    }
  ];

/** seed 阶段的批次：rows 由后处理回填。 */
type ImportSeed = Omit<ImportBatch, "rows">;
type GenerationSeed = Omit<GenerationBatch, "rows">;

const IMPORT_SEEDS: ImportSeed[] =   [
      {
        id: "imp-2026-11-10-01",
        fileName: "2026秋季期中试题汇总.csv",
        operator: "陈砚之",
        createdAt: "2026-11-10 09:12",
        status: "adopted",
        rowCount: 3,
        adoptedAt: "2026-11-10 09:26",
        adoptedCount: 3,
        columns: ["题干", "题型", "选项", "答案", "解析", "知识点"],
        mapping: { stem: "题干", type: "题型", options: "选项", answer: "答案", analysis: "解析", tags: "知识点" }
      }
    ];

const GENERATION_SEEDS: GenerationSeed[] =   [
      {
        id: "gen-2026-11-10-01",
        operator: "陈砚之",
        createdAt: "2026-11-10 10:04",
        status: "adopted",
        count: 3,
        type: "single",
        difficulty: "中等",
        prompt: "围绕数据结构中的排序与树结构生成基础选择题",
        tagIds: ["t-dom-ds", "t-pt-sort"],
        adoptedAt: "2026-11-10 10:11",
        adoptedCount: 3
      }
    ];

export const imports: ImportBatch[] = IMPORT_SEEDS.map((batch, index) => ({
  ...batch,
  rows: index === 0 ? IMPORT_BATCH_ROWS : [],
}));

export const generations: GenerationBatch[] = GENERATION_SEEDS.map((batch, index) => ({
  ...batch,
  rows: index === 0 ? GENERATION_BATCH_ROWS : [],
}));

/* ==========================================================================
   卷型模板
   ========================================================================== */

export const paperTemplates: PaperTemplate[] =   [
      {
        id: "tpl-mid-standard",
        name: "期中考试 · 标准卷模板",
        kind: "exam",
        mode: "standard",
        durationMin: 90,
        passScore: 60,
        items: [
          { qid: "q-n-01", score: 10 }, { qid: "q-n-02", score: 10 }, { qid: "q-n-03", score: 10 },
          { qid: "q-n-04", score: 10 }, { qid: "q-m-01", score: 10 }, { qid: "q-m-02", score: 10 },
          { qid: "q-e-01", score: 10 }, { qid: "q-d-01", score: 10 }, { qid: "q-p-01", score: 20 }
        ]
      },
      {
        id: "tpl-final-large",
        name: "期末考试 · 大梅花卷模板",
        kind: "exam",
        mode: "large",
        durationMin: 120,
        passScore: 60,
        items: [
          { qid: "q-m-01", score: 10 }, { qid: "q-m-02", score: 10 }, { qid: "q-m-04", score: 10 },
          { qid: "q-m-05", score: 10 }, { qid: "q-m-06", score: 10 }, { qid: "q-m-07", score: 20 },
          { qid: "q-d-02", score: 10 }, { qid: "q-d-03", score: 10 }
        ]
      },
      {
        id: "tpl-practice-quick",
        name: "课后练习 · 固定顺序模板",
        kind: "practice",
        mode: "fixed",
        durationMin: 25,
        passScore: 0,
        items: [
          { qid: "q-m-01", score: 10 }, { qid: "q-m-02", score: 10 }, { qid: "q-m-03", score: 10 },
          { qid: "q-m-04", score: 10 }, { qid: "q-m-05", score: 10 }
        ]
      }
    ];

/* ==========================================================================
   历史成绩与错题
   ========================================================================== */

export const records: ScoreRecord[] =   [
      { examId: "exam-math-final", studentId: "2023120101", name: "高等数学期末考试", date: "2026-06-18", score: 76, total: 100, status: "done" },
      { examId: "exam-ds-quiz", studentId: "2023120101", name: "数据结构随堂测验", date: "2026-10-14", score: 24, total: 30, status: "done" },
      { examId: "prac-en-write", studentId: "2023120101", name: "大学英语 · 学术写作常见错误订正", date: "2026-09-26", score: 88, total: 100, status: "done" },
      { examId: "prac-net-tp", studentId: "2023120101", name: "计算机网络 · 传输层与协议强化练习", date: "2026-09-12", score: 65, total: 100, status: "done" },
      { examId: "prac-math-limit", studentId: "2023120101", name: "高等数学 · 极限与连续专项练习", date: "2026-09-05", score: 71, total: 100, status: "done" }
    ];

export const mistakes: Mistake[] =   [
      { qid: "q-m-05", studentId: "2023120101", wrongCount: 3, lastWrongAt: "2026-10-02", reason: "条件收敛与绝对收敛混淆" },
      { qid: "q-n-03", studentId: "2023120101", wrongCount: 2, lastWrongAt: "2026-09-28", reason: "把 IP 误当作应用层协议" },
      { qid: "q-d-03", studentId: "2023120101", wrongCount: 2, lastWrongAt: "2026-09-21", reason: "快速排序复杂度判断错误" },
      { qid: "q-e-04", studentId: "2023120101", wrongCount: 1, lastWrongAt: "2026-09-15", reason: "主谓一致：a lot of + 复数名词" },
      { qid: "q-m-04", studentId: "2023120101", wrongCount: 1, lastWrongAt: "2026-08-30", reason: "未注意定义域的存在性" }
    ];

/* ==========================================================================
   待阅卷宗（主观题）
   ========================================================================== */

/** 各简答题的作答样本，长度递降，用于模拟真实答卷质量差异。 */
const SHORT_ANSWER_POOL: Record<string, string[]> =   {
      "q-m-07": [
        "连续要求函数在该点有定义并且左右极限都存在且等于函数值；极限存在只是连续的必要条件。连续函数在一点连续则在该点邻域保持连续，四则运算和复合函数都保持连续。",
        "连续就是极限存在并且极限值等于函数值。四则运算法则可以保持连续性，复合函数也可以。",
        "极限存在是连续的必要条件，连续函数满足四则运算和复合的连续性。"
      ],
      "q-n-05": [
        "第一次客户端发 SYN，第二次服务器回 SYN+ACK，第三次客户端发 ACK。三次是为了确认双方的收发能力正常并同步序号，两次握手无法确认客户端收到服务器的 SYN。",
        "三次握手：客户端 SYN，服务器 SYN+ACK，客户端 ACK。第三次握手确认服务器同步了初始序号，防止历史重复报文。",
        "第一次SYN，第二次SYN+ACK，第三次ACK。两次握手不能让服务器确认客户端收到了响应。"
      ],
      "q-d-04": [
        "栈后进先出，队列先进先出；两者都可用顺序或链式存储。栈用于函数调用与表达式求值，队列用于调度与广度优先搜索。",
        "栈是后进先出，队列是先进先出。栈可以顺序存储也可以链式存储。",
        "栈和队列都是线性结构，栈LIFO，队列FIFO，都能顺序或链式存储。"
      ],
      "q-e-05": [
        "当动作执行者不重要或需要突出客观过程时使用被动语态，例如实验数据被记录；但要避免过度使用。",
        "被动语态用于执行者不明确的情况，比如样品被采集。学术写作中要适度使用。",
        "被动语态能保持客观性，但不宜过多使用。"
      ],
      "q-p-03": [
        "实践具有直接现实性，能把主观认识与客观实际联系起来加以对照，所以是检验真理的唯一标准。方法论上要求坚持实践第一。",
        "因为实践是主观与客观联系的桥梁，所以是检验真理的唯一标准，反对教条主义。",
        "实践是检验真理的唯一标准。"
      ]
    };

interface ReviewSeedEntry {
  studentId: string;
  examId: string;
  qid: string;
  stepId?: string;
  at: string;
  index: number;
  text?: string;
}

const REVIEW_ENTRIES: ReviewSeedEntry[] =   [
        { studentId: "2023120101", examId: "exam-math-final", qid: "q-m-07", at: "2026-06-18 10:41", index: 0 },
        { studentId: "2023120102", examId: "exam-math-final", qid: "q-m-07", at: "2026-06-18 10:52", index: 0 },
        { studentId: "2023120103", examId: "exam-math-final", qid: "q-m-07", at: "2026-06-18 11:03", index: 1 },
        { studentId: "2023120207", examId: "exam-math-final", qid: "q-m-07", at: "2026-06-18 11:07", index: 2 },
        { studentId: "2023120104", examId: "exam-math-final", qid: "q-m-08", at: "2026-06-18 11:18", index: 0 },
        { studentId: "2023120105", examId: "exam-math-final", qid: "q-m-08", at: "2026-06-18 11:22", index: 1 },
        { studentId: "2023120208", examId: "exam-math-final", qid: "q-m-08", at: "2026-06-18 11:31", index: 2 },
        {
          studentId: "2023120101",
          examId: "exam-math-final",
          qid: "q-d-05",
          stepId: "s2",
          at: "2026-06-18 11:36",
          index: 0,
          text: "Node *reverse(Node *head) { Node *pre = NULL, *cur = head->next; while (cur) { Node *next = cur->next; cur->next = pre; pre = cur; cur = next; } head->next = pre; return head; }"
        },
        {
          studentId: "2023120109",
          examId: "exam-math-final",
          qid: "q-d-05",
          stepId: "s2",
          at: "2026-06-18 11:40",
          index: 1,
          text: "用递归：先保存 cur->next，再调用 reverse 翻转剩余部分，最后把当前结点的 next 指向已翻转的链表头。"
        },
        {
          studentId: "2023120210",
          examId: "exam-math-final",
          qid: "q-m-08",
          stepId: "s3",
          at: "2026-06-18 11:44",
          index: 2,
          text: "V = π∫[(x+2)² − x⁴]dx，形心横坐标由 ∫x[(x+2) − x²]dx 除以面积得到。"
        }
      ];

/**
 * 构造待阅卷队列。
 *
 * 原型的 buildReviewQueue 未写 attempt 字段（等价于第 1 次作答），
 * 本文件显式写为 1，与 ReviewItem.attempt 的必填口径一致。
 */
export function buildReviewQueue(): ReviewItem[] {
  return REVIEW_ENTRIES.map((entry, i) => {
    const pool = SHORT_ANSWER_POOL[entry.qid] ?? ["作答略"];
    return {
      id: `rv-${i + 1}`,
      examId: entry.examId,
      studentId: entry.studentId,
      qid: entry.qid,
      stepId: entry.stepId ?? null,
      attempt: 1,
      answerText: entry.text ?? pool[entry.index % pool.length] ?? "作答略",
      submittedAt: entry.at,
      status: "pending",
      teacherScore: null,
      comment: "",
    };
  });
}

/* ==========================================================================
   统一出口
   ========================================================================== */

/** 全部示例数据。 */
export const SEED = {
  TAG_GROUPS,
  MAX_TAGS,
  QUESTION_TYPES,
  TYPE_LABEL,
  TAGS,
  questions,
  banks,
  classes,
  students,
  exams,
  practices,
  records,
  mistakes,
  imports,
  generations,
  paperTemplates,
};

/* ==========================================================================
   查询辅助
   ========================================================================== */

/** 取题目。 */
export function getQuestion(id: string): Question | undefined {
  return questions.find((q) => q.id === id);
}

/** 取标签。 */
export function getTag(id: string): Tag | undefined {
  return TAGS.find((t) => t.id === id);
}

/** 取题库。 */
export function getBank(id: string): Bank | undefined {
  return banks.find((b) => b.id === id);
}

/** 取答题者。 */
export function getStudent(id: string): Student | undefined {
  return students.find((s) => s.id === id);
}

/** 取试卷。 */
export function getExam(id: string): ExamPaper | undefined {
  return exams.find((e) => e.id === id);
}

/** 取练习。 */
export function getPractice(id: string): Practice | undefined {
  return practices.find((p) => p.id === id);
}

/** 取题型中文名。 */
export function typeLabel(type: QuestionType): string {
  return TYPE_LABEL[type] ?? type;
}
