namespace Exam.Domain.Catalog;

/// <summary>
/// 导入模板里的一列。
/// <para>
/// 列口径的**权威来源**：服务端解析只认这些表头，
/// 模板、说明与守卫脚本都以这里为准。
/// </para>
/// </summary>
public sealed record QuestionImportTemplateColumn(
    string Field,
    string Header,
    bool Required,
    string Description,
    string Example);

/// <summary>
/// 试题导入模板。
/// <para>
/// 老师的题库大多在 Excel / Word 里，系统得先说清「要长什么样」，
/// 否则就是拿一张表格去猜服务器的解析规则。
/// 这里给出**表头、是否必填、格式说明与示例值**，
/// 再给出两行示例数据——模板与解析规则同源，不会各说各话。
/// </para>
/// </summary>
public static class QuestionImportTemplate
{
    /// <summary>列定义（顺序即模板里的列顺序）。</summary>
    public static IReadOnlyList<QuestionImportTemplateColumn> Columns { get; } =
    [
        new("code", "题号", false,
            "选填。留空由系统按批次自动生成（形如 IMP-12-3）。自己填时同一题库内不能重复。",
            "Q-001"),
        new("type", "题型", true,
            "必填。取值：单选题 / 多选题 / 判断题 / 简答题 / 综合题（英文 single / multi / judge / short / comprehensive 也认）。",
            "单选题"),
        new("stem", "题干", true,
            "必填。题干正文，可含 Markdown。",
            "下列关于 TCP 三次握手的说法，正确的是？"),
        new("options", "选项", false,
            "客观题（单选 / 多选 / 判断）必填。每行一个或用竖线分隔，形如「A. 甲|B. 乙」。判断题写「A. 正确|B. 错误」。",
            "A. 甲|B. 乙|C. 丙|D. 丁"),
        new("answer", "答案", true,
            "必填（综合题除外）：客观题填正确选项的键（多选写 A,C）；简答题填参考答案正文；判断题填 A（正确）或 B（错误）。综合题的参考答案写在「评分步骤」里。",
            "A"),
        new("steps", "评分步骤", false,
            "综合题必填。每行一步，形如「步骤编码|作答提示|分值|参考答案」，多行即多步。第四段参考答案可省，但省了发布校验过不去。",
            "s1|说明三次握手的每一步|5|客户端先发 SYN"),
        new("analysis", "解析", false,
            "选填。答案解析，展示给做题的人看。",
            "第三次握手确认了客户端的接收能力……"),
        new("referenceAnswer", "参考答案", false,
            "选填。参考答案正文（简答题建议同时填在「答案」列）。",
            "客户端 SYN → 服务端 SYN+ACK → 客户端 ACK"),
        new("score", "分值", false,
            "选填。1–40 之间的数字，留空按 5 分计。",
            "5"),
        new("difficulty", "难度", true,
            "必填。填系统里已存在的难度标签名（基础 / 中等 / 较难），或 1–5 的难度等级。标签不存在时该行会被跳过。",
            "中等"),
        new("tags", "知识点", false,
            "选填。知识点标签名，多个用逗号分隔。标签必须已存在，否则该行会被跳过。",
            "计算机网络,TCP"),
    ];

    /// <summary>模板的表头行（按 <see cref="Columns"/> 顺序）。</summary>
    public static IReadOnlyList<string> Headers { get; } =
        Columns.Select(c => c.Header).ToList();

    /// <summary>
    /// 示例数据：两行，一行单选、一行简答。
    /// <para>留着是给人看格式的——真导入前记得删掉。</para>
    /// </summary>
    public static IReadOnlyList<IReadOnlyDictionary<string, string>> SampleRows { get; } =
    [
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["code"] = "Q-001",
            ["type"] = "单选题",
            ["stem"] = "下列关于 TCP 三次握手的说法，正确的是？",
            ["options"] = "A. 第一次握手就能传输数据|B. 第三次握手才确认客户端接收能力|C. 三次握手是为了加密|D. 两次握手即可建立连接",
            ["answer"] = "B",
            ["steps"] = "",
            ["analysis"] = "三次握手依次确认双方的发送与接收能力，第三次握手确认客户端的接收能力。",
            ["referenceAnswer"] = "",
            ["score"] = "5",
            ["difficulty"] = "中等",
            ["tags"] = "计算机网络,TCP",
        },
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["code"] = "Q-002",
            ["type"] = "简答题",
            ["stem"] = "简述 TCP 三次握手的过程及其必要性。",
            ["options"] = "",
            ["answer"] = "客户端发送 SYN，服务端回复 SYN+ACK，客户端再回 ACK。三次握手用于确认双方的收发能力，避免历史连接请求造成错误建立。",
            ["steps"] = "",
            ["analysis"] = "按「谁先发起、双方各确认什么」两点作答。",
            ["referenceAnswer"] = "SYN → SYN+ACK → ACK",
            ["score"] = "10",
            ["difficulty"] = "较难",
            ["tags"] = "计算机网络",
        },
    ];

    /// <summary>模板顶部的说明（下载的模板里逐行列出）。</summary>
    public static IReadOnlyList<string> Notes { get; } =
    [
        "本模板的列名与系统的解析规则一致：按表头自动映射，可导入 CSV（UTF-8）或 XLSX（首个工作表）。",
        "必填列：题型、题干、答案、难度（综合题的答案写在评分步骤里）。客观题还必须有选项；综合题必须有评分步骤，且分值等于各步骤分值之和。",
        "难度与知识点填的是**系统里已存在的标签名**，不是随便写的词——标签不存在时该行会被跳过并给出原因。",
        "一行出错只影响那一行，其余行照常导入；导入后先进候选题队列，审核发布后才生效。",
        "模板里的两行示例数据仅供对照格式，真导入前请删掉。",
    ];

    /// <summary>把模板渲染成 CSV 文本（含表头与示例行）。</summary>
    public static string ToCsv()
    {
        var lines = new List<string> { string.Join(",", Headers.Select(Escape)) };

        foreach (var row in SampleRows)
        {
            lines.Add(string.Join(",", Columns.Select(c => Escape(row.GetValueOrDefault(c.Field, string.Empty)))));
        }

        return string.Join("\r\n", lines) + "\r\n";
    }

    private static string Escape(string? value)
    {
        var text = value ?? string.Empty;

        // 含分隔符、引号或换行时用双引号包起来，内部引号翻倍。
        if (text.Contains(',') || text.Contains('"') || text.Contains('\r') || text.Contains('\n'))
        {
            return $"\"{text.Replace("\"", "\"\"")}\"";
        }

        return text;
    }
}
