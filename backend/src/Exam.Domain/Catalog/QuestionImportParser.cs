using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Catalog;

/// <summary>导入解析出的选项。</summary>
public sealed record ParsedOption(string Key, string Text, bool IsCorrect);

/// <summary>导入解析出的评分要点。</summary>
public sealed record ParsedKeypoint(string Text, IReadOnlyList<string> Keywords);

/// <summary>导入解析出的评分步骤。</summary>
public sealed record ParsedStep(string Code, string Prompt, decimal Score);

/// <summary>导入解析出的一道题（尚未落库）。</summary>
public sealed record ParsedQuestion(
    string? Code,
    QuestionType Type,
    string Stem,
    decimal Score,
    string? Analysis,
    string? ReferenceAnswer,
    IReadOnlyList<ParsedOption> Options,
    IReadOnlyList<ParsedKeypoint> Keypoints,
    IReadOnlyList<ParsedStep> Steps,
    IReadOnlyList<string> TagNames,
    string? DifficultyName);

/// <summary>
/// 导入行的解析器。
/// <para>
/// 纯领域逻辑：不碰数据库、不碰文件格式，只把「一行单元格」翻译成「一道题」，
/// 并给出字段级错误。文件格式（CSV / XLSX）与列映射在基础设施与应用层。
/// </para>
/// </summary>
public static class QuestionImportParser
{
    /// <summary>导入支持的列（目标字段名）。</summary>
    public static IReadOnlyList<string> SupportedFields { get; } =
    [
        "code",
        "type",
        "stem",
        "options",
        "answer",
        "steps",
        "analysis",
        "referenceAnswer",
        "score",
        "difficulty",
        "tags",
    ];

    /// <summary>列名别名 → 标准字段名。</summary>
    public static IReadOnlyDictionary<string, string> FieldAliases { get; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["题号"] = "code",
            ["编号"] = "code",
            ["code"] = "code",
            ["题型"] = "type",
            ["类型"] = "type",
            ["type"] = "type",
            ["题干"] = "stem",
            ["题目"] = "stem",
            ["stem"] = "stem",
            ["选项"] = "options",
            ["options"] = "options",
            ["答案"] = "answer",
            ["正确答案"] = "answer",
            ["answer"] = "answer",
            ["步骤"] = "steps",
            ["steps"] = "steps",
            ["解析"] = "analysis",
            ["答案解析"] = "analysis",
            ["analysis"] = "analysis",
            ["参考答案"] = "referenceAnswer",
            ["referenceAnswer"] = "referenceAnswer",
            ["分值"] = "score",
            ["分数"] = "score",
            ["score"] = "score",
            ["难度"] = "difficulty",
            ["difficulty"] = "difficulty",
            ["知识点"] = "tags",
            ["标签"] = "tags",
            ["tags"] = "tags",
        };

    /// <summary>难度名称 → 等级。</summary>
    private static readonly Dictionary<string, int> DifficultyNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["基础"] = 1,
        ["简单"] = 1,
        ["容易"] = 1,
        ["中等"] = 2,
        ["一般"] = 2,
        ["较难"] = 3,
        ["困难"] = 4,
        ["难"] = 3,
        ["极难"] = 5,
    };

    /// <summary>解析一行。返回解析结果与字段级错误。</summary>
    public static (ParsedQuestion? Question, IReadOnlyList<ImportRowError> Errors) Parse(
        IReadOnlyDictionary<string, string?> row)
    {
        var errors = new List<ImportRowError>();

        var code = Trim(row.GetValueOrDefault("code"));
        var stem = Trim(row.GetValueOrDefault("stem"));
        var typeText = Trim(row.GetValueOrDefault("type"));
        var optionsText = Trim(row.GetValueOrDefault("options"));
        var answerText = Trim(row.GetValueOrDefault("answer"));
        var analysis = Trim(row.GetValueOrDefault("analysis"));
        var referenceAnswer = Trim(row.GetValueOrDefault("referenceAnswer"));
        var stepsText = Trim(row.GetValueOrDefault("steps"));
        var scoreText = Trim(row.GetValueOrDefault("score"));
        var difficultyText = Trim(row.GetValueOrDefault("difficulty"));
        var tagsText = Trim(row.GetValueOrDefault("tags"));

        if (string.IsNullOrEmpty(stem))
        {
            errors.Add(new ImportRowError("stem", "题干不能为空。"));
        }

        var type = QuestionTypes.FromName(typeText) ?? QuestionTypes.FromStorage(typeText);
        if (type is null)
        {
            errors.Add(new ImportRowError("type", $"无法识别的题型「{typeText}」。"));
        }

        var score = 5m;
        if (!string.IsNullOrEmpty(scoreText))
        {
            if (!decimal.TryParse(scoreText, out var parsedScore) || parsedScore <= 0 || parsedScore > Score.MaxQuestionScore)
            {
                errors.Add(new ImportRowError("score", $"分值「{scoreText}」不合法。"));
            }
            else
            {
                score = parsedScore;
            }
        }

        var options = ParseOptions(optionsText).ToList();
        var keypoints = new List<ParsedKeypoint>();
        var steps = new List<ParsedStep>();

        switch (type)
        {
            case QuestionType.Single:
            case QuestionType.Multi:
            case QuestionType.Judge:
                if (options.Count == 0)
                {
                    errors.Add(new ImportRowError("options", "客观题必须填写选项。"));
                }
                else
                {
                    options = ApplyAnswer(options, answerText, errors);
                }

                break;

            case QuestionType.Short:
                if (string.IsNullOrEmpty(answerText))
                {
                    errors.Add(new ImportRowError("answer", "简答题必须填写参考答案。"));
                }
                else
                {
                    keypoints.Add(new ParsedKeypoint(answerText, []));
                }

                break;

            case QuestionType.Comprehensive:
                steps = ParseSteps(stepsText, errors).ToList();
                if (steps.Count == 0)
                {
                    errors.Add(new ImportRowError("steps", "综合题必须填写评分步骤。"));
                }

                break;
        }

        var tagNames = (tagsText ?? string.Empty)
            .Split(['，', ',', '、', '；', ';', '|'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(t => t.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (tagNames.Count > Question.MaxTagCount)
        {
            errors.Add(new ImportRowError("tags", $"标签数量不能超过 {Question.MaxTagCount} 个。"));
        }

        string? difficultyName = null;
        if (!string.IsNullOrEmpty(difficultyText))
        {
            if (!DifficultyNames.ContainsKey(difficultyText) && !int.TryParse(difficultyText, out _))
            {
                errors.Add(new ImportRowError("difficulty", $"无法识别的难度「{difficultyText}」。"));
            }
            else
            {
                difficultyName = difficultyText;
            }
        }

        if (errors.Count > 0)
        {
            return (null, errors);
        }

        return (
            new ParsedQuestion(
                code,
                type!.Value,
                stem!,
                score,
                analysis,
                referenceAnswer,
                options,
                keypoints,
                steps,
                tagNames,
                difficultyName),
            errors);
    }

    /// <summary>
    /// 解析选项。两种写法都支持：
    /// <c>A. 甲|B. 乙</c> 与多行每行一个。
    /// </summary>
    public static IReadOnlyList<ParsedOption> ParseOptions(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        var options = new List<ParsedOption>();

        foreach (var line in text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var part in line.Split('|', StringSplitOptions.RemoveEmptyEntries))
            {
                var trimmed = part.Trim();
                if (trimmed.Length == 0)
                {
                    continue;
                }

                var separator = trimmed.IndexOfAny(['.', '．', '、']);
                if (separator <= 0)
                {
                    options.Add(new ParsedOption(string.Empty, trimmed, false));
                    continue;
                }

                var key = trimmed[..separator].Trim().TrimEnd('.', '．').Trim();
                var content = trimmed[(separator + 1)..].Trim();
                options.Add(new ParsedOption(key.ToUpperInvariant(), content, false));
            }
        }

        return options;
    }

    /// <summary>
    /// 解析评分步骤。格式：<c>s1|提示|分值</c>，多步用换行分隔。
    /// </summary>
    public static IReadOnlyList<ParsedStep> ParseSteps(
        string? text,
        ICollection<ImportRowError> errors)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        var steps = new List<ParsedStep>();
        var index = 1;

        foreach (var line in text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = line.Split('|', StringSplitOptions.TrimEntries);
            if (parts.Length < 3)
            {
                errors.Add(new ImportRowError("steps", $"第 {index} 个步骤格式不正确，应为「编码|提示|分值」。"));
                index++;
                continue;
            }

            if (!decimal.TryParse(parts[2], out var score) || score <= 0 || score > Score.MaxQuestionScore)
            {
                errors.Add(new ImportRowError("steps", $"第 {index} 个步骤的分值「{parts[2]}」不合法。"));
                index++;
                continue;
            }

            steps.Add(new ParsedStep(parts[0], parts[1], score));
            index++;
        }

        return steps;
    }

    /// <summary>把答案列应用到选项上。答案引用了不存在的选项时报错。</summary>
    private static List<ParsedOption> ApplyAnswer(
        List<ParsedOption> options,
        string? answerText,
        ICollection<ImportRowError> errors)
    {
        if (string.IsNullOrWhiteSpace(answerText))
        {
            errors.Add(new ImportRowError("answer", "客观题必须填写答案。"));
            return options;
        }

        var keys = answerText
            .Split(['，', ',', '；', ';', ' ', '|'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(k => k.ToUpperInvariant())
            .Where(k => k.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (keys.Count == 0)
        {
            errors.Add(new ImportRowError("answer", "答案不能为空。"));
            return options;
        }

        var existing = options.Select(o => o.Key).ToHashSet(StringComparer.Ordinal);
        foreach (var key in keys)
        {
            if (!existing.Contains(key))
            {
                errors.Add(new ImportRowError("answer", $"答案 {key} 不在选项范围内。"));
                return options;
            }
        }

        return options
            .Select(o => o with { IsCorrect = keys.Contains(o.Key) })
            .ToList();
    }

    private static string? Trim(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
