namespace Exam.Domain.Catalog;

/// <summary>题型。</summary>
public enum QuestionType
{
    /// <summary>单选：恰好一个正确项。</summary>
    Single,

    /// <summary>多选：至少两个正确项。</summary>
    Multi,

    /// <summary>判断：固定两个选项。</summary>
    Judge,

    /// <summary>简答：按评分要点给分。</summary>
    Short,

    /// <summary>综合：按步骤给分。</summary>
    Comprehensive,
}

/// <summary>题型的元数据。</summary>
public static class QuestionTypes
{
    public static string ToStorage(this QuestionType type) => type switch
    {
        QuestionType.Single => "single",
        QuestionType.Multi => "multi",
        QuestionType.Judge => "judge",
        QuestionType.Short => "short",
        QuestionType.Comprehensive => "comprehensive",
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "未知题型。"),
    };

    public static QuestionType? FromStorage(string? storage) => storage switch
    {
        "single" => QuestionType.Single,
        "multi" => QuestionType.Multi,
        "judge" => QuestionType.Judge,
        "short" => QuestionType.Short,
        "comprehensive" => QuestionType.Comprehensive,
        _ => null,
    };

    public static string Label(this QuestionType type) => type switch
    {
        QuestionType.Single => "单选题",
        QuestionType.Multi => "多选题",
        QuestionType.Judge => "判断题",
        QuestionType.Short => "简答题",
        QuestionType.Comprehensive => "综合题",
        _ => "未知",
    };

    /// <summary>是否为客观题（可自动判分）。</summary>
    public static bool IsObjective(this QuestionType type) =>
        type is QuestionType.Single or QuestionType.Multi or QuestionType.Judge;

    /// <summary>全部题型。</summary>
    public static IReadOnlyList<QuestionType> All { get; } =
    [
        QuestionType.Single,
        QuestionType.Multi,
        QuestionType.Judge,
        QuestionType.Short,
        QuestionType.Comprehensive,
    ];

    /// <summary>中英文题型名 → 题型。用于导入解析。</summary>
    public static QuestionType? FromName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var normalized = name.Trim().ToLowerInvariant();
        return normalized switch
        {
            "single" or "单选题" or "选择" or "单选" => QuestionType.Single,
            "multi" or "多选题" or "多选" => QuestionType.Multi,
            "judge" or "判断题" or "判断" or "判断题(正确/错误)" => QuestionType.Judge,
            "short" or "简答题" or "简答" => QuestionType.Short,
            "comprehensive" or "综合题" or "综合" => QuestionType.Comprehensive,
            _ => null,
        };
    }
}
