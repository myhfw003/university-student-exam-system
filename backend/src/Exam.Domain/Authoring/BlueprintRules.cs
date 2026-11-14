using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Authoring;

/// <summary>组卷方案状态。</summary>
public enum BlueprintStatus
{
    /// <summary>草稿：只保存了规则，还没抽题。</summary>
    Draft,

    /// <summary>已生成：按规则抽过题。</summary>
    Generated,

    /// <summary>已手工修改：教师在生成结果上做过微调。</summary>
    Modified,
}

public static class BlueprintStatuses
{
    public static string ToStorage(this BlueprintStatus status) => status switch
    {
        BlueprintStatus.Generated => "generated",
        BlueprintStatus.Modified => "modified",
        _ => "draft",
    };

    public static BlueprintStatus? FromStorage(string? storage) => storage switch
    {
        "draft" => BlueprintStatus.Draft,
        "generated" => BlueprintStatus.Generated,
        "modified" => BlueprintStatus.Modified,
        _ => null,
    };

    public static string Label(this BlueprintStatus status) => status switch
    {
        BlueprintStatus.Generated => "已生成",
        BlueprintStatus.Modified => "已手工修改",
        _ => "草稿",
    };
}

/// <summary>
/// 组卷规则。描述「抽什么题、抽多少、怎么分值、怎么排序」。
/// </summary>
public sealed record BlueprintRules
{
    /// <summary>标签筛选条件。为空表示不限标签。</summary>
    public TagSelector TagSelector { get; init; } = TagSelector.Empty;

    /// <summary>各难度题数配额（键为难度标签 ID）。</summary>
    public IReadOnlyDictionary<long, int> DifficultyQuota { get; init; } =
        new Dictionary<long, int>();

    /// <summary>各题型题数配额。</summary>
    public IReadOnlyDictionary<QuestionType, int> TypeQuota { get; init; } =
        new Dictionary<QuestionType, int>();

    /// <summary>目标总分。分配结果之和必须精确等于它。</summary>
    public decimal TargetTotalScore { get; init; }

    /// <summary>生成后的题序规则。</summary>
    public OrderRule OrderRule { get; init; } = OrderRule.ByType;

    /// <summary>分值分配模式。</summary>
    public ScoreAllocation ScoreAllocation { get; init; } = ScoreAllocation.Even;

    /// <summary>配额总数。</summary>
    public int TotalQuota =>
        DifficultyQuota.Count > 0
            ? DifficultyQuota.Values.Sum()
            : TypeQuota.Values.Sum();

    /// <summary>难度配额之和。</summary>
    public int DifficultyTotal => DifficultyQuota.Values.Sum();

    /// <summary>题型配额之和。</summary>
    public int TypeTotal => TypeQuota.Values.Sum();

    /// <summary>校验规则是否自洽。</summary>
    public void EnsureValid()
    {
        if (DifficultyQuota.Count == 0 && TypeQuota.Count == 0)
        {
            throw new BusinessRuleException("必须至少设置一项题型配额或难度配额。");
        }

        if (DifficultyQuota.Any(kv => kv.Key <= 0))
        {
            throw new BusinessRuleException("难度配额包含无效的难度标签。");
        }

        if (DifficultyQuota.Any(kv => kv.Value <= 0))
        {
            throw new BusinessRuleException("难度配额必须为正数。");
        }

        if (TypeQuota.Any(kv => kv.Value <= 0))
        {
            throw new BusinessRuleException("题型配额必须为正数。");
        }

        if (DifficultyQuota.Count > 0 && TypeQuota.Count > 0
            && DifficultyTotal != TypeTotal)
        {
            throw new BusinessRuleException(
                $"题型配额之和（{TypeTotal}）必须等于难度配额之和（{DifficultyTotal}）。");
        }

        if (TargetTotalScore <= 0m)
        {
            throw new BusinessRuleException("目标总分必须大于 0。");
        }

        if (TargetTotalScore > Score.MaxPaperScore)
        {
            throw new BusinessRuleException($"目标总分不能超过 {Score.MaxPaperScore}。");
        }

        if (TargetTotalScore % ScoreAllocator.Step != 0m)
        {
            throw new BusinessRuleException($"目标总分必须以 {ScoreAllocator.Step} 为步进。");
        }
    }
}

/// <summary>
/// 题池缺口记录。池量不足时逐条列出缺什么、缺多少。
/// </summary>
public sealed record Shortfall
{
    /// <summary>题型。未限定题型时为空。</summary>
    public QuestionType? Type { get; init; }

    /// <summary>难度标签 ID。未限定难度时为空。</summary>
    public long? DifficultyTagId { get; init; }

    /// <summary>难度名称，用于给教师看。</summary>
    public string DifficultyName { get; init; } = string.Empty;

    /// <summary>需要多少题。</summary>
    public int Required { get; init; }

    /// <summary>实际可用多少题。</summary>
    public int Available { get; init; }

    /// <summary>缺口原因说明。</summary>
    public string Reason { get; init; } = string.Empty;
}

/// <summary>缺口在错误响应里的载荷。</summary>
public sealed record ShortfallDetail(
    string? Type,
    long? DifficultyTagId,
    string Difficulty,
    int Required,
    int Available,
    string Reason);

/// <summary>组卷题池不足。携带逐条缺口明细，绝不降级补题。</summary>
public sealed class InsufficientQuestionPoolException : DomainException
{
    public InsufficientQuestionPoolException(string message, IReadOnlyList<Shortfall> shortfalls)
        : base(
            message,
            ErrorCodes.InsufficientQuestionPool,
            new Dictionary<string, object?>
            {
                ["shortfalls"] = shortfalls
                    .Select(s => new ShortfallDetail(
                        s.Type is null ? null : QuestionTypes.ToStorage(s.Type.Value),
                        s.DifficultyTagId,
                        s.DifficultyName,
                        s.Required,
                        s.Available,
                        s.Reason))
                    .ToList(),
            })
    {
        Shortfalls = shortfalls;
    }

    public IReadOnlyList<Shortfall> Shortfalls { get; } = [];
}
