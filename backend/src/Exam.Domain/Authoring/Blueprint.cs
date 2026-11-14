using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Authoring;

/// <summary>方案里的一道题（抽题结果）。</summary>
public sealed record BlueprintPlanItem(long QuestionId, decimal Score, int SortOrder, long? PaperItemId);

/// <summary>抽题结果整体。</summary>
public sealed record BlueprintPlan(IReadOnlyList<BlueprintPlanItem> Items)
{
    public static BlueprintPlan Empty { get; } = new([]);
}

/// <summary>差异条目。</summary>
public sealed record BlueprintDiffItem(long QuestionId, decimal? PlanScore, decimal? CurrentScore, string? Reason);

/// <summary>
/// 方案与试卷当前题位的差异。
/// </summary>
public sealed record BlueprintDiff(
    IReadOnlyList<BlueprintDiffItem> Added,
    IReadOnlyList<BlueprintDiffItem> Removed,
    IReadOnlyList<BlueprintDiffItem> Changed)
{
    public static BlueprintDiff Empty { get; } = new([], [], []);
}

/// <summary>
/// 组卷方案聚合根。一份试卷至多一份方案。
/// <para>
/// 方案只保存规则与抽题结果，真正的题位仍然落在试卷上——
/// 方案是「打算这么组」，试卷是「实际这么排」。
/// </para>
/// </summary>
public sealed class Blueprint : AuditableEntity, IAuditedEntity
{
    private Blueprint()
    {
    }

    private Blueprint(long paperId, BlueprintRules rules, string seed, DateTimeOffset now, long? actorId)
        : base(now, actorId)
    {
        PaperId = paperId;
        Rules = rules;
        Seed = seed;
        Status = BlueprintStatus.Draft;
        Plan = BlueprintPlan.Empty;
    }

    /// <summary>所属试卷。</summary>
    public long PaperId { get; private set; }

    /// <summary>组卷规则。</summary>
    public BlueprintRules Rules { get; private set; } = new();

    /// <summary>确定性随机种子。同种子 + 同题池 → 同结果。</summary>
    public string Seed { get; private set; } = string.Empty;

    /// <summary>方案状态。</summary>
    public BlueprintStatus Status { get; private set; }

    /// <summary>教师是否手工改过。</summary>
    public bool ManualModified { get; private set; }

    /// <summary>最近一次抽题结果。</summary>
    public BlueprintPlan Plan { get; private set; } = BlueprintPlan.Empty;

    /// <summary>最近一次抽题的题池缺口。</summary>
    public IReadOnlyList<Shortfall> Shortfalls { get; private set; } = [];

    /// <summary>最近一次抽题时间。</summary>
    public DateTimeOffset? GeneratedAt { get; private set; }

    /// <summary>最近一次抽题的操作人。</summary>
    public long? GeneratedBy { get; private set; }

    public static Blueprint Create(
        long paperId,
        BlueprintRules rules,
        string seed,
        DateTimeOffset now,
        long? actorId = null)
    {
        rules.EnsureValid();
        EnsureSeed(seed);

        return new Blueprint(paperId, rules, seed.Trim(), now, actorId);
    }

    /// <summary>修改规则。改了规则后需要重新抽题。</summary>
    public void ChangeRules(BlueprintRules rules, string seed, DateTimeOffset now, long? actorId = null)
    {
        rules.EnsureValid();
        EnsureSeed(seed);

        Rules = rules;
        Seed = seed.Trim();
        Touch(now, actorId);
    }

    /// <summary>
    /// 按规则抽题。题池不足时抛 <see cref="InsufficientQuestionPoolException"/>，
    /// 并逐条给出缺口。
    /// </summary>
    public SelectionPlan Generate(
        IReadOnlyList<QuestionCandidate> pool,
        DateTimeOffset now,
        long? actorId = null)
    {
        var plan = QuestionSelectionEngine.Generate(Rules, pool, Seed);

        Plan = new BlueprintPlan(plan.Items
            .Select(i => new BlueprintPlanItem(i.QuestionId, i.Score, i.SortOrder, null))
            .ToList());
        Shortfalls = [];
        Status = BlueprintStatus.Generated;
        ManualModified = false;
        GeneratedAt = now;
        GeneratedBy = actorId;
        Touch(now, actorId);

        return plan;
    }

    /// <summary>记录题池缺口。一次抽题失败的诊断信息。</summary>
    public void RecordShortfalls(
        IReadOnlyList<Shortfall> shortfalls,
        DateTimeOffset now,
        long? actorId = null)
    {
        Shortfalls = shortfalls;
        Touch(now, actorId);
    }

    /// <summary>教师手工微调了题位。</summary>
    public void MarkManualModified(DateTimeOffset now, long? actorId = null)
    {
        ManualModified = true;
        Status = BlueprintStatus.Modified;
        Touch(now, actorId);
    }

    /// <summary>把生成结果落到试卷后，回填题位主键。</summary>
    public void BindPaperItems(IReadOnlyList<long> paperItemIds, DateTimeOffset now, long? actorId = null)
    {
        var items = Plan.Items.ToList();
        for (var i = 0; i < items.Count && i < paperItemIds.Count; i++)
        {
            items[i] = items[i] with { PaperItemId = paperItemIds[i] };
        }

        Plan = new BlueprintPlan(items);
        Touch(now, actorId);
    }

    /// <summary>
    /// 与试卷当前题位对比：新增（试卷有方案没有）、移除（方案有试卷没有）、分值变化。
    /// </summary>
    public BlueprintDiff Diff(IReadOnlyList<(long QuestionId, decimal Score)> currentItems)
    {
        var plan = Plan.Items.ToDictionary(i => i.QuestionId);
        var current = currentItems.ToDictionary(i => i.QuestionId, i => i.Score);

        var added = current
            .Where(kv => !plan.ContainsKey(kv.Key))
            .OrderBy(kv => kv.Key)
            .Select(kv => new BlueprintDiffItem(kv.Key, null, kv.Value, "试卷中有、方案中没有"))
            .ToList();

        var removed = plan
            .Where(kv => !current.ContainsKey(kv.Key))
            .OrderBy(kv => kv.Key)
            .Select(kv => new BlueprintDiffItem(kv.Key, kv.Value.Score, null, "方案中有、试卷中没有"))
            .ToList();

        var changed = plan
            .Where(kv => current.ContainsKey(kv.Key) && current[kv.Key] != kv.Value.Score)
            .OrderBy(kv => kv.Key)
            .Select(kv => new BlueprintDiffItem(kv.Key, kv.Value.Score, current[kv.Key], "分值变化"))
            .ToList();

        return new BlueprintDiff(added, removed, changed);
    }

    private static void EnsureSeed(string seed)
    {
        if (string.IsNullOrWhiteSpace(seed))
        {
            throw new BusinessRuleException("随机种子不能为空。");
        }
    }
}
