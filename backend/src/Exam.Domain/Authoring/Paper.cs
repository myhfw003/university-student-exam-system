using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Authoring;

/// <summary>
/// 试卷聚合根。考试卷与练习卷共用一套结构，靠 <see cref="Kind"/> 区分规则。
/// <para>
/// 已发布试卷的题位不可改——已经生成的快照必须保持稳定。
/// </para>
/// </summary>
public sealed class Paper : AuditableEntity, IAuditedEntity
{
    public const int MaxTagCount = 5;

    public const int MinDurationMinutes = 1;

    public const int MaxDurationMinutes = 300;

    private readonly List<PaperItem> _items = [];

    private readonly List<PaperSection> _sections = [];

    private readonly List<PaperTag> _tags = [];

    private Paper()
    {
    }

    private Paper(PaperKind kind, string name, DateTimeOffset now, long? actorId)
        : base(now, actorId)
    {
        Kind = kind;
        Name = name;
        Status = PaperStatus.Draft;
        TargetTotalScore = Score.Zero;
        DurationMinutes = 60;
        OrderRule = OrderRule.ByType;
        VariantRule = VariantRule.Standard;
        AnswerPolicy = AnswerPolicy.AfterClose;
        RetakeKeepsBest = true;
        ExamRules = kind == PaperKind.Exam ? ExamRules.Default : null;
        PracticeRules = kind == PaperKind.Practice ? PracticeRules.Default : null;
    }

    public PaperKind Kind { get; private set; }

    public string Name { get; private set; } = string.Empty;

    /// <summary>考试批次描述。</summary>
    public string? Batch { get; private set; }

    public string? Description { get; private set; }

    /// <summary>挂载的标签（不含组织维度）。</summary>
    public IReadOnlyCollection<long> TagIds => _tags.Select(t => t.TagId).ToList();

    /// <summary>标签关联实体。</summary>
    public IReadOnlyCollection<PaperTag> Tags => _tags.AsReadOnly();

    /// <summary>目标总分。实际总分以题位之和为准。</summary>
    public Score TargetTotalScore { get; private set; } = Score.Zero;

    /// <summary>题位分值之和。</summary>
    public decimal TotalItemScore => _items.Sum(i => i.Score.Value);

    public int DurationMinutes { get; private set; }

    public Score? PassScore { get; private set; }

    public PaperStatus Status { get; private set; }

    public OrderRule OrderRule { get; private set; }

    public VariantRule VariantRule { get; private set; }

    public AnswerPolicy AnswerPolicy { get; private set; }

    public bool AllowRetake { get; private set; }

    public bool RetakeKeepsBest { get; private set; }

    /// <summary>考生须知。</summary>
    public string? Note { get; private set; }

    public IReadOnlyCollection<PaperItem> Items => _items.AsReadOnly();

    public IReadOnlyCollection<PaperSection> Sections => _sections.AsReadOnly();

    /// <summary>考试卷规则。仅 kind=Exam 时有值。</summary>
    public ExamRules? ExamRules { get; private set; }

    /// <summary>练习卷规则。仅 kind=Practice 时有值。</summary>
    public PracticeRules? PracticeRules { get; private set; }

    /// <summary>当前绑定的快照。</summary>
    public long? PublishedSnapshotId { get; private set; }

    public static Paper CreateDraft(
        PaperKind kind,
        string name,
        DateTimeOffset now,
        long? actorId = null)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new BusinessRuleException("试卷名称不能为空。");
        }

        return new Paper(kind, name.Trim(), now, actorId);
    }

    /// <summary>修改元信息。已发布试卷改元信息不影响已生成的快照。</summary>
    public void UpdateMeta(
        string name,
        string? batch,
        string? description,
        Score targetTotalScore,
        int durationMinutes,
        Score? passScore,
        string? note,
        DateTimeOffset now,
        long? actorId = null)
    {
        EnsureName(name);
        EnsureDuration(durationMinutes);

        Name = name.Trim();
        Batch = string.IsNullOrWhiteSpace(batch) ? null : batch.Trim();
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        TargetTotalScore = targetTotalScore;
        DurationMinutes = durationMinutes;
        PassScore = passScore;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        Touch(now, actorId);
    }

    /// <summary>调整目标总分。组卷生成后同步试卷的目标总分，保证发布校验能对上。</summary>
    public void SetTargetTotalScore(Score targetTotalScore, DateTimeOffset now, long? actorId = null)
    {
        EnsureEditable();
        TargetTotalScore = targetTotalScore;
        Touch(now, actorId);
    }

    /// <summary>加入题目。题目须为已发布，同题不可重复入卷。</summary>
    public void AddItem(Question question, Score score, int sortOrder, DateTimeOffset now, long? actorId = null)
    {
        EnsureEditable();

        if (question.Status != QuestionStatus.Published)
        {
            throw new BusinessRuleException($"题目「{question.Code}」不是已发布状态，不能入卷。");
        }

        if (_items.Any(i => i.QuestionId == question.Id))
        {
            throw new BusinessRuleException("同一道题不能重复出现在试卷中。");
        }

        if (score.Value > Score.MaxQuestionScore)
        {
            throw new BusinessRuleException($"题位分值不能超过 {Score.MaxQuestionScore}。");
        }

        var item = PaperItem.Create(question.Id, score, sortOrder);
        item.AssignSection(null);
        _items.Add(item);
        Touch(now, actorId);
    }

    public void RemoveItem(long questionId, DateTimeOffset now, long? actorId = null)
    {
        EnsureEditable();

        var item = _items.FirstOrDefault(i => i.QuestionId == questionId)
            ?? throw new BusinessRuleException("题位不存在。");
        _items.Remove(item);
        Touch(now, actorId);
    }

    public void SetItemScore(long questionId, Score score, DateTimeOffset now, long? actorId = null)
    {
        EnsureEditable();

        var item = _items.FirstOrDefault(i => i.QuestionId == questionId)
            ?? throw new BusinessRuleException("题位不存在。");
        item.ChangeScore(score);
        Touch(now, actorId);
    }

    public void SetItemSortOrder(long questionId, int sortOrder, DateTimeOffset now, long? actorId = null)
    {
        EnsureEditable();

        var item = _items.FirstOrDefault(i => i.QuestionId == questionId)
            ?? throw new BusinessRuleException("题位不存在。");
        item.ChangeSortOrder(sortOrder);
        Touch(now, actorId);
    }

    /// <summary>整体替换题位集合。</summary>
    public void ReplaceItems(
        IReadOnlyCollection<(Question Question, Score Score)> items,
        DateTimeOffset now,
        long? actorId = null)
    {
        EnsureEditable();

        var seen = new HashSet<long>();
        foreach (var (question, _) in items)
        {
            if (!seen.Add(question.Id))
            {
                throw new BusinessRuleException("同一道题不能重复出现在试卷中。");
            }
        }

        _items.Clear();
        var sortOrder = 0;
        foreach (var (question, score) in items)
        {
            _items.Add(PaperItem.Create(question.Id, score, sortOrder++));
        }

        Touch(now, actorId);
    }

    /// <summary>新增大题分组。</summary>
    public PaperSection AddSection(string title, string? instructions, int sortOrder, DateTimeOffset now, long? actorId = null)
    {
        EnsureEditable();

        if (string.IsNullOrWhiteSpace(title))
        {
            throw new BusinessRuleException("大题标题不能为空。");
        }

        var section = PaperSection.Create(title.Trim(), instructions, sortOrder);
        _sections.Add(section);
        Touch(now, actorId);
        return section;
    }

    public void RemoveSection(long sectionId, DateTimeOffset now, long? actorId = null)
    {
        EnsureEditable();

        var section = _sections.FirstOrDefault(s => s.Id == sectionId)
            ?? throw new BusinessRuleException("大题分组不存在。");
        _sections.Remove(section);

        foreach (var item in _items.Where(i => i.SectionId == sectionId))
        {
            item.AssignSection(null);
        }

        Touch(now, actorId);
    }

    /// <summary>挂载标签。数量上限 5。</summary>
    public void AttachTag(long tagId, DateTimeOffset now, long? actorId = null)
    {
        if (_tags.Any(t => t.TagId == tagId))
        {
            return;
        }

        if (_tags.Count >= MaxTagCount)
        {
            throw new BusinessRuleException($"每份试卷最多挂 {MaxTagCount} 个标签。");
        }

        _tags.Add(PaperTag.Create(Id, tagId, now));
        Touch(now, actorId);
    }

    public void DetachTag(long tagId, DateTimeOffset now, long? actorId = null)
    {
        var link = _tags.FirstOrDefault(t => t.TagId == tagId);
        if (link is not null)
        {
            _tags.Remove(link);
        }

        Touch(now, actorId);
    }

    public void SetOrderRule(OrderRule rule, DateTimeOffset now, long? actorId = null)
    {
        OrderRule = rule;
        Touch(now, actorId);
    }

    public void SetVariantRule(VariantRule rule, DateTimeOffset now, long? actorId = null)
    {
        VariantRule = rule;
        Touch(now, actorId);
    }

    public void SetAnswerPolicy(AnswerPolicy policy, DateTimeOffset now, long? actorId = null)
    {
        AnswerPolicy = policy;
        Touch(now, actorId);
    }

    public void SetRetake(bool allow, bool keepsBest, DateTimeOffset now, long? actorId = null)
    {
        AllowRetake = allow;
        RetakeKeepsBest = keepsBest;
        Touch(now, actorId);
    }

    /// <summary>设置考试卷规则。只有考试卷能设置。</summary>
    public void SetExamRules(ExamRules rules, DateTimeOffset now, long? actorId = null)
    {
        EnsureKind(PaperKind.Exam);
        ExamRules = rules;
        PracticeRules = null;
        Touch(now, actorId);
    }

    /// <summary>设置练习卷规则。只有练习卷能设置。</summary>
    public void SetPracticeRules(PracticeRules rules, DateTimeOffset now, long? actorId = null)
    {
        EnsureKind(PaperKind.Practice);
        PracticeRules = rules;
        ExamRules = null;
        Touch(now, actorId);
    }

    /// <summary>发布。校验通过后绑定快照。</summary>
    public void Publish(long? snapshotId, DateTimeOffset now, long? actorId = null)
    {
        if (Status == PaperStatus.Published)
        {
            return;
        }

        PublishedSnapshotId = snapshotId;
        Status = PaperStatus.Published;
        Touch(now, actorId);
    }

    /// <summary>撤回发布。回到草稿，但保留快照。</summary>
    public void Unpublish(DateTimeOffset now, long? actorId = null)
    {
        if (Status != PaperStatus.Published)
        {
            throw new BusinessRuleException("只有已发布的试卷才能撤回。");
        }

        Status = PaperStatus.Draft;
        Touch(now, actorId);
    }

    /// <summary>归档 / 下架。</summary>
    public void Archive(DateTimeOffset now, long? actorId = null)
    {
        if (Status == PaperStatus.Archived)
        {
            return;
        }

        Status = PaperStatus.Archived;
        Touch(now, actorId);
    }

    /// <summary>已发布的试卷题位不可改——快照必须保持稳定。</summary>
    public void EnsureEditable()
    {
        if (Status == PaperStatus.Published)
        {
            throw new PaperImmutableException("已发布的试卷不能修改题位，请先撤回发布。");
        }
    }

    private void EnsureKind(PaperKind expected)
    {
        if (Kind != expected)
        {
            throw new BusinessRuleException(
                expected == PaperKind.Exam
                    ? "只有考试卷能设置考试规则。"
                    : "只有练习卷能设置练习规则。");
        }
    }

    private static void EnsureName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new BusinessRuleException("试卷名称不能为空。");
        }
    }

    private static void EnsureDuration(int minutes)
    {
        if (minutes is < MinDurationMinutes or > MaxDurationMinutes)
        {
            throw new BusinessRuleException($"考试时长必须在 {MinDurationMinutes} 到 {MaxDurationMinutes} 分钟之间。");
        }
    }
}

/// <summary>试卷已发布，不可修改题位。</summary>
public sealed class PaperImmutableException : DomainException
{
    public PaperImmutableException(string message)
        : base(message, ErrorCodes.PaperImmutable) { }
}

/// <summary>校验项在错误响应里的载荷。</summary>
public sealed record ValidationDetail(
    string Key,
    string Label,
    bool Passed,
    string Severity,
    string? Detail,
    IReadOnlyList<long> Targets);

/// <summary>发布校验未通过。</summary>
public sealed class PaperPublicationException : DomainException
{
    public PaperPublicationException(string message, IReadOnlyList<ValidationItem> items)
        : base(
            message,
            ErrorCodes.PaperPublicationRejected,
            new Dictionary<string, object?>
            {
                ["items"] = items
                    .Select(i => new ValidationDetail(
                        i.Key,
                        i.Label,
                        i.Passed,
                        i.Severity == ValidationSeverity.Blocking ? "blocking" : "warning",
                        i.Detail,
                        i.Targets))
                    .ToList(),
            })
    {
        Items = items;
    }

    public IReadOnlyList<ValidationItem> Items { get; } = [];
}
