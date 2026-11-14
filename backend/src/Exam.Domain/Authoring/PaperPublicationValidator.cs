namespace Exam.Domain.Authoring;

/// <summary>发布校验的一项结果。</summary>
/// <param name="Key">校验项标识。</param>
/// <param name="Label">中文名称。</param>
/// <param name="Passed">是否通过。</param>
/// <param name="Severity">严重级别。</param>
/// <param name="Detail">具体原因。</param>
/// <param name="Targets">相关题目 ID，便于前端定位。</param>
public sealed record ValidationItem(
    string Key,
    string Label,
    bool Passed,
    ValidationSeverity Severity,
    string? Detail,
    IReadOnlyList<long> Targets);

/// <summary>
/// 发布校验器。
/// <para>
/// 八项校验里六项阻断、两项警告。警告项允许填写理由后覆盖，
/// 阻断项不通过就不能发布。
/// </para>
/// </summary>
public sealed class PaperPublicationValidator
{
    /// <summary>主观题分值占比上限（超过只警告）。</summary>
    public const decimal SubjectiveRatioLimit = 0.4m;

    /// <summary>题均时长下限（分钟）。</summary>
    public const decimal MinutesPerItemMin = 0.5m;

    /// <summary>题均时长上限（分钟）。</summary>
    public const decimal MinutesPerItemMax = 20m;

    /// <summary>每分耗时下限（分钟）。</summary>
    public const decimal MinutesPerPointMin = 0.3m;

    /// <summary>每分耗时上限（分钟）。</summary>
    public const decimal MinutesPerPointMax = 3m;

    /// <summary>
    /// 执行校验。
    /// </summary>
    /// <param name="paper">试卷。</param>
    /// <param name="questionStatuses">题位对应题目的状态，键为题目 ID。</param>
    /// <param name="subjectiveQuestionIds">主观题（简答与综合）的题目 ID 集合。</param>
    /// <param name="rosterConfigured">考试名单是否已配置。练习卷豁免此项。</param>
    public IReadOnlyList<ValidationItem> Validate(
        Paper paper,
        IReadOnlyDictionary<long, string> questionStatuses,
        IReadOnlySet<long> subjectiveQuestionIds,
        bool rosterConfigured)
    {
        var items = new List<ValidationItem>(8);

        items.Add(ValidateCount(paper));
        items.Add(ValidatePublished(paper, questionStatuses));
        items.Add(ValidateScore(paper));
        items.Add(ValidateDuplicate(paper));
        items.Add(ValidateSubjectiveRatio(paper, subjectiveQuestionIds));
        items.Add(ValidateDurationFit(paper));
        items.Add(ValidateTagCount(paper));
        items.Add(ValidateRoster(paper, rosterConfigured));

        return items;
    }

    private static ValidationItem ValidateCount(Paper paper)
    {
        var passed = paper.Items.Count > 0;
        return new ValidationItem(
            "count",
            "题目数量",
            passed,
            ValidationSeverity.Blocking,
            passed ? null : "试卷里至少要有一道题。",
            []);
    }

    private static ValidationItem ValidatePublished(
        Paper paper,
        IReadOnlyDictionary<long, string> questionStatuses)
    {
        var unpublished = paper.Items
            .Where(i => !questionStatuses.TryGetValue(i.QuestionId, out var status)
                || !string.Equals(status, "published", StringComparison.OrdinalIgnoreCase))
            .Select(i => i.QuestionId)
            .ToList();

        return new ValidationItem(
            "published",
            "题目状态",
            unpublished.Count == 0,
            ValidationSeverity.Blocking,
            unpublished.Count == 0 ? null : $"有 {unpublished.Count} 道题不是已发布状态。",
            unpublished);
    }

    private static ValidationItem ValidateScore(Paper paper)
    {
        var total = paper.TotalItemScore;
        var target = paper.TargetTotalScore.Value;
        var passed = total == target;

        return new ValidationItem(
            "score",
            "总分一致",
            passed,
            ValidationSeverity.Blocking,
            passed
                ? null
                : $"题位分值之和 {total} 与目标总分 {target} 不一致。",
            []);
    }

    private static ValidationItem ValidateDuplicate(Paper paper)
    {
        var duplicated = paper.Items
            .GroupBy(i => i.QuestionId)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();

        return new ValidationItem(
            "duplicate",
            "无重复题",
            duplicated.Count == 0,
            ValidationSeverity.Blocking,
            duplicated.Count == 0 ? null : "试卷里有重复的题目。",
            duplicated);
    }

    private static ValidationItem ValidateSubjectiveRatio(
        Paper paper,
        IReadOnlySet<long> subjectiveQuestionIds)
    {
        var total = paper.TotalItemScore;
        if (total <= 0m)
        {
            return new ValidationItem(
                "subjectiveRatio",
                "主观题占比",
                true,
                ValidationSeverity.Warning,
                null,
                []);
        }

        var subjective = paper.Items
            .Where(i => subjectiveQuestionIds.Contains(i.QuestionId))
            .Sum(i => i.Score.Value);

        var ratio = subjective / total;
        var passed = ratio <= SubjectiveRatioLimit;

        return new ValidationItem(
            "subjectiveRatio",
            "主观题占比",
            passed,
            ValidationSeverity.Warning,
            passed
                ? null
                : $"主观题分值占比 {ratio:P1}，超过 {SubjectiveRatioLimit:P0} 的建议上限，可填写理由后继续发布。",
            paper.Items.Where(i => subjectiveQuestionIds.Contains(i.QuestionId)).Select(i => i.QuestionId).ToList());
    }

    private static ValidationItem ValidateDurationFit(Paper paper)
    {
        var count = paper.Items.Count;
        if (count == 0)
        {
            return new ValidationItem("durationFit", "时长匹配", true, ValidationSeverity.Warning, null, []);
        }

        var minutesPerItem = (decimal)paper.DurationMinutes / count;
        var total = paper.TotalItemScore;
        var minutesPerPoint = total <= 0m ? 0m : (decimal)paper.DurationMinutes / total;

        var itemFits = minutesPerItem >= MinutesPerItemMin && minutesPerItem <= MinutesPerItemMax;
        var pointFits = minutesPerPoint >= MinutesPerPointMin && minutesPerPoint <= MinutesPerPointMax;
        var passed = itemFits && pointFits;

        var detail = passed
            ? null
            : $"题均 {minutesPerItem:F1} 分钟、每分 {minutesPerPoint:F2} 分钟，超出建议区间"
                + $"（题均 {MinutesPerItemMin}-{MinutesPerItemMax} 分钟，每分 {MinutesPerPointMin}-{MinutesPerPointMax} 分钟）。";

        return new ValidationItem("durationFit", "时长匹配", passed, ValidationSeverity.Warning, detail, []);
    }

    private static ValidationItem ValidateTagCount(Paper paper)
    {
        var count = paper.TagIds.Count;
        var passed = count <= Paper.MaxTagCount;

        return new ValidationItem(
            "tagCount",
            "标签数量",
            passed,
            ValidationSeverity.Blocking,
            passed ? null : $"标签数量 {count} 超过上限 {Paper.MaxTagCount}。",
            []);
    }

    private static ValidationItem ValidateRoster(Paper paper, bool rosterConfigured)
    {
        if (paper.Kind == PaperKind.Practice)
        {
            return new ValidationItem("roster", "名单", true, ValidationSeverity.Blocking, null, []);
        }

        return new ValidationItem(
            "roster",
            "名单",
            rosterConfigured,
            ValidationSeverity.Blocking,
            rosterConfigured ? null : "考试卷尚未配置名单。",
            []);
    }
}
