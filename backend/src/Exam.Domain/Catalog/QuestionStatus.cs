namespace Exam.Domain.Catalog;

/// <summary>题目状态。</summary>
public enum QuestionStatus
{
    /// <summary>草稿。只有草稿可删。</summary>
    Draft,

    /// <summary>已发布。</summary>
    Published,

    /// <summary>已停用。可恢复到已发布。</summary>
    Disabled,
}

/// <summary>题目来源。</summary>
public enum QuestionSource
{
    /// <summary>手工录入。</summary>
    Manual,

    /// <summary>导入。</summary>
    Import,

    /// <summary>生成（本期只保留 Provider 抽象）。</summary>
    Generated,
}

public static class QuestionStatuses
{
    public static string ToStorage(this QuestionStatus status) => status switch
    {
        QuestionStatus.Draft => "draft",
        QuestionStatus.Published => "published",
        QuestionStatus.Disabled => "disabled",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "未知题目状态。"),
    };

    public static QuestionStatus? FromStorage(string? storage) => storage switch
    {
        "draft" => QuestionStatus.Draft,
        "published" => QuestionStatus.Published,
        "disabled" => QuestionStatus.Disabled,
        _ => null,
    };

    public static string Label(this QuestionStatus status) => status switch
    {
        QuestionStatus.Draft => "草稿",
        QuestionStatus.Published => "已发布",
        QuestionStatus.Disabled => "已停用",
        _ => "未知",
    };
}

public static class QuestionSources
{
    public static string ToStorage(this QuestionSource source) => source switch
    {
        QuestionSource.Manual => "manual",
        QuestionSource.Import => "import",
        QuestionSource.Generated => "generated",
        _ => throw new ArgumentOutOfRangeException(nameof(source), source, "未知题目来源。"),
    };

    public static QuestionSource? FromStorage(string? storage) => storage switch
    {
        "manual" => QuestionSource.Manual,
        "import" => QuestionSource.Import,
        "generated" => QuestionSource.Generated,
        _ => null,
    };
}
