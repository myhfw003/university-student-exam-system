using System.Text.Json.Serialization;

namespace Exam.Domain.Delivery;

/// <summary>综合题的分步作答。</summary>
public sealed record AnswerStep(string Code, string Text);

/// <summary>
/// 答案载荷（值对象）。
/// <para>
/// 五种题型共用一个结构：客观题用 <see cref="SelectedOptionKeys"/>，简答用
/// <see cref="Text"/>，综合题用 <see cref="Steps"/>。同一份答案里只会用到其中一种。
/// </para>
/// </summary>
public sealed record AnswerPayload
{
    /// <summary>选中的选项键。单选与判断只有一个，多选按字典序排好。</summary>
    public IReadOnlyList<string> SelectedOptionKeys { get; init; } = [];

    /// <summary>主观题作答文本。</summary>
    public string? Text { get; init; }

    /// <summary>综合题的分步作答。</summary>
    public IReadOnlyList<AnswerStep> Steps { get; init; } = [];

    /// <summary>是否等于未作答。</summary>
    [JsonIgnore]
    public bool IsEmpty =>
        SelectedOptionKeys.Count == 0
        && string.IsNullOrWhiteSpace(Text)
        && Steps.Count == 0;

    /// <summary>空答案。</summary>
    public static AnswerPayload Empty() => new();

    /// <summary>客观题载荷。选项键去重并排序，保证同一份答案只有一种写法。</summary>
    public static AnswerPayload Options(params string[] keys) => new()
    {
        SelectedOptionKeys = keys
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .Select(k => k.Trim().ToUpperInvariant())
            .Distinct(StringComparer.Ordinal)
            .OrderBy(k => k, StringComparer.Ordinal)
            .ToList(),
    };

    /// <summary>主观题载荷。</summary>
    public static AnswerPayload Written(string? text) => new()
    {
        Text = string.IsNullOrWhiteSpace(text) ? null : text.Trim(),
    };

    /// <summary>综合题载荷。</summary>
    public static AnswerPayload StepAnswers(IEnumerable<AnswerStep> steps) => new()
    {
        Steps = steps
            .Where(s => !string.IsNullOrWhiteSpace(s.Code))
            .ToList(),
    };
}
