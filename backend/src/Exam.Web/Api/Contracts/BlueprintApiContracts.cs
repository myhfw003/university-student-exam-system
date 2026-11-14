namespace Exam.Web.Api.Contracts;

/// <summary>保存组卷规则。</summary>
public sealed record SaveBlueprintRequest(string Seed, BlueprintRulesRequest Rules);

/// <summary>组卷规则输入。</summary>
public sealed record BlueprintRulesRequest(
    IReadOnlyList<long>? TagIds,
    bool IncludeDescendants,
    string MatchMode,
    IReadOnlyDictionary<long, int>? DifficultyQuota,
    IReadOnlyDictionary<string, int>? TypeQuota,
    decimal TargetTotalScore,
    string OrderRule,
    string ScoreAllocation);
