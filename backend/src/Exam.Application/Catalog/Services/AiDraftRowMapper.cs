using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Services;

/// <summary>
/// 把模型给的草稿翻译成**导入行**。
/// <para>
/// 关键在于：翻译完就走文件导入那条路（<see cref="QuestionImportParser"/>），
/// 于是模型产的题和老师上传的题受同一套规则管——多选题只有一个正确答案、
            /// 答案键不在选项里、步骤分值对不上，这些都会被同一条规则拦下来。
/// </para>
/// </summary>
public static class AiDraftRowMapper
{
    /// <summary>草稿 → 导入行（字段名与文件导入一致）。</summary>
    public static IReadOnlyDictionary<string, string?> ToRow(AiQuestionDraft draft)
    {
        var type = QuestionTypes.FromName(draft.Type) ?? QuestionTypes.FromStorage(draft.Type)
            ?? QuestionType.Single;

        var options = type == QuestionType.Judge
            ? "A. 正确|B. 错误"
            : NormalizeOptions(draft.Options);

        // 判断题的答案键已由解析层归一化成 A / B；其余题型保持原样。
        var answer = type == QuestionType.Judge
            ? string.Join(",", draft.Answer.Where(a => a is "A" or "B"))
            : string.Join(",", draft.Answer);

        return new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["type"] = type.ToStorage(),
            ["stem"] = draft.Stem,
            ["options"] = options,
            ["answer"] = answer,
            ["analysis"] = draft.Analysis,
            ["referenceAnswer"] = draft.ReferenceAnswer,
            // 综合题的分值由步骤之和决定（导入解析器会核这一步），
            // 模型给的数字与步骤对不上时以步骤为准。
            ["score"] = type == QuestionType.Comprehensive
                ? null
                : draft.Score?.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["steps"] = NormalizeSteps(draft),
        };
    }

    /// <summary>
    /// 选项统一成「A. 甲|B. 乙」。
    /// <para>模型有时带键（A. 甲），有时只给正文（甲）；只给正文的按顺序补键。</para>
    /// </summary>
    private static string NormalizeOptions(IReadOnlyList<string> options)
    {
        var parts = new List<string>();
        var index = 0;

        foreach (var option in options)
        {
            var text = option.Trim();
            if (text.Length == 0)
            {
                continue;
            }

            if (HasKey(text))
            {
                parts.Add(text);
            }
            else
            {
                parts.Add($"{KeyOf(index)}. {text}");
            }

            index++;
        }

        return string.Join("|", parts);
    }

    private static bool HasKey(string text)
    {
        var separator = text.IndexOfAny(['.', '．', '、']);
        if (separator != 1)
        {
            return false;
        }

        return char.IsLetter(text[0]);
    }

    private static string KeyOf(int index) =>
        ((char)('A' + Math.Min(index, 25))).ToString();

    /// <summary>评分步骤统一成「编码|提示|分值|参考答案」，多步用换行分隔。</summary>
    private static string NormalizeSteps(AiQuestionDraft draft)
    {
        if (draft.Steps.Count == 0)
        {
            return string.Empty;
        }

        var lines = new List<string>();
        var index = 0;

        foreach (var step in draft.Steps)
        {
            index++;
            var code = string.IsNullOrWhiteSpace(step.Code) ? $"s{index}" : step.Code.Trim();
            var score = step.Score?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "5";
            lines.Add($"{code}|{step.Prompt}|{score}|{step.ReferenceAnswer ?? string.Empty}");
        }

        return string.Join("\n", lines);
    }
}
