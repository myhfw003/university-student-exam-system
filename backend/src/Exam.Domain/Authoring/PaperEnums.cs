namespace Exam.Domain.Authoring;

/// <summary>试卷形态。</summary>
public enum PaperKind
{
    /// <summary>考试卷。</summary>
    Exam,

    /// <summary>练习卷。</summary>
    Practice,
}

/// <summary>试卷状态。</summary>
public enum PaperStatus
{
    Draft,
    Published,
    Archived,
}

/// <summary>题序规则。</summary>
public enum OrderRule
{
    /// <summary>按题型分组排序。</summary>
    ByType,

    /// <summary>按题位顺序排列。</summary>
    Manual,
}

/// <summary>卷面派生规则（梅花卷）。</summary>
public enum VariantRule
{
    /// <summary>标准卷：不置换。</summary>
    Standard,

    /// <summary>小梅花：题序不变，选项置换。</summary>
    SmallPlum,

    /// <summary>大梅花：题型块顺序保留，块内题序与选项都置换。</summary>
    LargePlum,
}

/// <summary>答案公布策略。</summary>
public enum AnswerPolicy
{
    /// <summary>立即公布。</summary>
    Immediately,

    /// <summary>交卷后公布。</summary>
    AfterSubmit,

    /// <summary>考试关闭后公布。</summary>
    AfterClose,
}

/// <summary>校验项的严重级别。</summary>
public enum ValidationSeverity
{
    /// <summary>阻断项：不通过就不能发布。</summary>
    Blocking,

    /// <summary>警告项：可填写理由后覆盖。</summary>
    Warning,
}

public static class PaperKinds
{
    public static string ToStorage(this PaperKind kind) => kind == PaperKind.Practice ? "practice" : "exam";

    public static PaperKind? FromStorage(string? storage) => storage switch
    {
        "exam" => PaperKind.Exam,
        "practice" => PaperKind.Practice,
        _ => null,
    };

    public static string Label(this PaperKind kind) => kind == PaperKind.Practice ? "练习卷" : "考试卷";
}

public static class PaperStatuses
{
    public static string ToStorage(this PaperStatus status) => status switch
    {
        PaperStatus.Draft => "draft",
        PaperStatus.Published => "published",
        PaperStatus.Archived => "archived",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "未知试卷状态。"),
    };

    public static PaperStatus? FromStorage(string? storage) => storage switch
    {
        "draft" => PaperStatus.Draft,
        "published" => PaperStatus.Published,
        "archived" => PaperStatus.Archived,
        _ => null,
    };

    public static string Label(this PaperStatus status) => status switch
    {
        PaperStatus.Draft => "草稿",
        PaperStatus.Published => "已发布",
        PaperStatus.Archived => "已归档",
        _ => "未知",
    };
}

public static class OrderRules
{
    public static string ToStorage(this OrderRule rule) => rule == OrderRule.Manual ? "manual" : "by_type";

    public static OrderRule? FromStorage(string? storage) => storage switch
    {
        "by_type" => OrderRule.ByType,
        "manual" => OrderRule.Manual,
        _ => null,
    };
}

public static class VariantRules
{
    public static string ToStorage(this VariantRule rule) => rule switch
    {
        VariantRule.Standard => "standard",
        VariantRule.SmallPlum => "small_plum",
        VariantRule.LargePlum => "large_plum",
        _ => throw new ArgumentOutOfRangeException(nameof(rule), rule, "未知卷型规则。"),
    };

    public static VariantRule? FromStorage(string? storage) => storage switch
    {
        "standard" => VariantRule.Standard,
        "small_plum" => VariantRule.SmallPlum,
        "large_plum" => VariantRule.LargePlum,
        _ => null,
    };

    public static string Label(this VariantRule rule) => rule switch
    {
        VariantRule.Standard => "标准卷",
        VariantRule.SmallPlum => "小梅花",
        VariantRule.LargePlum => "大梅花",
        _ => "未知",
    };
}

public static class AnswerPolicies
{
    public static string ToStorage(this AnswerPolicy policy) => policy switch
    {
        AnswerPolicy.Immediately => "immediately",
        AnswerPolicy.AfterSubmit => "after_submit",
        AnswerPolicy.AfterClose => "after_close",
        _ => throw new ArgumentOutOfRangeException(nameof(policy), policy, "未知答案公布策略。"),
    };

    public static AnswerPolicy? FromStorage(string? storage) => storage switch
    {
        "immediately" => AnswerPolicy.Immediately,
        "after_submit" => AnswerPolicy.AfterSubmit,
        "after_close" => AnswerPolicy.AfterClose,
        _ => null,
    };
}
