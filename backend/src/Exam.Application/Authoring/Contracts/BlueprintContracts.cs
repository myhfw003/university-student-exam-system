using Exam.Domain.Authoring;
using Exam.Application.Authoring.Services;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Application.Authoring.Contracts;

/// <summary>标签筛选条件。</summary>
public sealed record BlueprintTagSelectorDto(
    IReadOnlyList<long> TagIds,
    bool IncludeDescendants,
    string MatchMode);

/// <summary>组卷规则。</summary>
public sealed record BlueprintRulesDto(
    BlueprintTagSelectorDto TagSelector,
    IReadOnlyDictionary<string, int> DifficultyQuota,
    IReadOnlyDictionary<string, int> TypeQuota,
    decimal TargetTotalScore,
    string OrderRule,
    string ScoreAllocation);

/// <summary>方案中的一道题。</summary>
public sealed record BlueprintItemDto(
    long QuestionId,
    string QuestionCode,
    string Type,
    string TypeLabel,
    decimal Score,
    long DifficultyTagId,
    string Difficulty,
    IReadOnlyList<string> MatchReason,
    int SortOrder);

/// <summary>题池缺口。</summary>
public sealed record BlueprintShortfallDto(
    string? Type,
    long? DifficultyTagId,
    string Difficulty,
    int Required,
    int Available,
    string Reason);

/// <summary>差异条目。</summary>
public sealed record BlueprintDiffItemDto(
    long QuestionId,
    decimal? PlanScore,
    decimal? CurrentScore,
    string? Reason);

/// <summary>方案与试卷当前题位的差异。</summary>
public sealed record BlueprintDiffDto(
    IReadOnlyList<BlueprintDiffItemDto> Added,
    IReadOnlyList<BlueprintDiffItemDto> Removed,
    IReadOnlyList<BlueprintDiffItemDto> Changed)
{
    public static BlueprintDiffDto Empty { get; } = new([], [], []);
}

/// <summary>组卷方案。</summary>
public sealed record BlueprintDto(
    long Id,
    long PaperId,
    string Seed,
    string Status,
    bool ManualModified,
    BlueprintRulesDto Rules,
    IReadOnlyList<BlueprintItemDto> Items,
    int ItemCount,
    decimal TotalScore,
    IReadOnlyList<BlueprintShortfallDto> Shortfalls,
    DateTimeOffset? GeneratedAt,
    long? GeneratedBy);

/// <summary>抽题结果。</summary>
public sealed record GenerateBlueprintResponse(
    long BlueprintId,
    string Status,
    string Seed,
    int GeneratedItemCount,
    IReadOnlyList<BlueprintItemDto> Items,
    decimal TotalScore,
    BlueprintDiffDto Diff);

/// <summary>
/// 规则输入。题型配额用存储名（single/multi/...）表示，
/// 与前端和数据库的写法保持一致。
/// </summary>
public sealed record BlueprintRulesInput(
    IReadOnlyList<long> TagIds,
    bool IncludeDescendants,
    string MatchMode,
    IReadOnlyDictionary<long, int> DifficultyQuota,
    IReadOnlyDictionary<string, int> TypeQuota,
    decimal TargetTotalScore,
    string OrderRule,
    string ScoreAllocation)
{
    /// <summary>转成领域规则。取值不合法时直接报错，不做静默兜底。</summary>
    public BlueprintRules ToRules()
    {
        var matchMode = MatchMode?.Trim().ToLowerInvariant() switch
        {
            "any" => TagMatchMode.Any,
            "all" => TagMatchMode.All,
            _ => throw new BusinessRuleException("标签命中模式只能是 any 或 all。"),
        };

        var orderRule = OrderRule?.Trim().ToLowerInvariant() switch
        {
            "by_type" or "bytype" => Exam.Domain.Authoring.OrderRule.ByType,
            "manual" => Exam.Domain.Authoring.OrderRule.Manual,
            _ => throw new BusinessRuleException("题序规则只能是 by_type 或 manual。"),
        };

        var allocation = ScoreAllocation?.Trim().ToLowerInvariant() switch
        {
            "even" => Exam.Domain.Authoring.ScoreAllocation.Even,
            "by_difficulty" or "bydifficulty" => Exam.Domain.Authoring.ScoreAllocation.ByDifficulty,
            _ => throw new BusinessRuleException("分值分配模式只能是 even 或 by_difficulty。"),
        };

        var typeQuota = new Dictionary<QuestionType, int>();
        foreach (var (key, value) in TypeQuota ?? new Dictionary<string, int>())
        {
            var type = QuestionTypes.FromStorage(key?.Trim().ToLowerInvariant())
                ?? QuestionTypes.FromName(key?.Trim())
                ?? throw new BusinessRuleException($"题型「{key}」不合法。");
            typeQuota[type] = value;
        }

        var rules = new BlueprintRules
        {
            TagSelector = new TagSelector
            {
                TagIds = TagIds?.ToList() ?? [],
                IncludeDescendants = IncludeDescendants,
                MatchMode = matchMode,
            },
            DifficultyQuota = new Dictionary<long, int>(DifficultyQuota ?? new Dictionary<long, int>()),
            TypeQuota = typeQuota,
            TargetTotalScore = TargetTotalScore,
            OrderRule = orderRule,
            ScoreAllocation = allocation,
        };

        rules.EnsureValid();
        return rules;
    }
}

/// <summary>方案条目需要的题目信息。</summary>
public sealed record BlueprintItemInfo(
    string Code,
    string Type,
    string TypeLabel,
    long DifficultyTagId,
    string Difficulty,
    IReadOnlyList<string> MatchReason);

/// <summary>组卷 DTO 组装。</summary>
public static class BlueprintDtoFactory
{
    public static BlueprintRulesDto ToDto(BlueprintRules rules) => new(
        new BlueprintTagSelectorDto(
            rules.TagSelector.TagIds,
            rules.TagSelector.IncludeDescendants,
            rules.TagSelector.MatchMode == TagMatchMode.All ? "all" : "any"),
        rules.DifficultyQuota.ToDictionary(kv => kv.Key.ToString(), kv => kv.Value),
        rules.TypeQuota.ToDictionary(kv => kv.Key.ToStorage(), kv => kv.Value),
        rules.TargetTotalScore,
        OrderRules.ToStorage(rules.OrderRule),
        rules.ScoreAllocation == ScoreAllocation.ByDifficulty ? "by_difficulty" : "even");

    public static BlueprintShortfallDto ToDto(Shortfall shortfall) => new(
        shortfall.Type is null ? null : QuestionTypes.ToStorage(shortfall.Type.Value),
        shortfall.DifficultyTagId,
        shortfall.DifficultyName,
        shortfall.Required,
        shortfall.Available,
        shortfall.Reason);

    /// <summary>抽题结果转条目。</summary>
    public static IReadOnlyList<BlueprintItemDto> ToItems(
        IReadOnlyList<SelectedQuestion> plan,
        IReadOnlyDictionary<long, BlueprintPoolEntry> entries)
    {
        return plan.Select(item =>
        {
            entries.TryGetValue(item.QuestionId, out var entry);
            return new BlueprintItemDto(
                item.QuestionId,
                entry?.Candidate.Code ?? string.Empty,
                QuestionTypes.ToStorage(item.Type),
                item.Type.Label(),
                item.Score,
                item.DifficultyTagId,
                item.DifficultyName,
                entry?.MatchReason ?? [],
                item.SortOrder);
        }).ToList();
    }

    /// <summary>已保存的方案转条目。</summary>
    public static IReadOnlyList<BlueprintItemDto> ToPlanItems(
        Blueprint blueprint,
        IReadOnlyDictionary<long, BlueprintItemInfo> infos)
    {
        return blueprint.Plan.Items
            .OrderBy(i => i.SortOrder)
            .Select(item =>
            {
                infos.TryGetValue(item.QuestionId, out var info);
                return new BlueprintItemDto(
                    item.QuestionId,
                    info?.Code ?? string.Empty,
                    info?.Type ?? string.Empty,
                    info?.TypeLabel ?? string.Empty,
                    item.Score,
                    info?.DifficultyTagId ?? 0,
                    info?.Difficulty ?? string.Empty,
                    info?.MatchReason ?? [],
                    item.SortOrder);
            })
            .ToList();
    }

    public static BlueprintDto ToDto(Blueprint blueprint, IReadOnlyList<BlueprintItemDto> items) => new(
        blueprint.Id,
        blueprint.PaperId,
        blueprint.Seed,
        blueprint.Status.ToStorage(),
        blueprint.ManualModified,
        ToDto(blueprint.Rules),
        items,
        items.Count,
        items.Sum(i => i.Score),
        blueprint.Shortfalls.Select(ToDto).ToList(),
        blueprint.GeneratedAt,
        blueprint.GeneratedBy);

    public static BlueprintDiffDto ToDto(BlueprintDiff diff) => new(
        diff.Added.Select(i => new BlueprintDiffItemDto(i.QuestionId, i.PlanScore, i.CurrentScore, i.Reason)).ToList(),
        diff.Removed.Select(i => new BlueprintDiffItemDto(i.QuestionId, i.PlanScore, i.CurrentScore, i.Reason)).ToList(),
        diff.Changed.Select(i => new BlueprintDiffItemDto(i.QuestionId, i.PlanScore, i.CurrentScore, i.Reason)).ToList());
}
