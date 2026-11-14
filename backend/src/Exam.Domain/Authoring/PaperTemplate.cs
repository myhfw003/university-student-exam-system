using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Authoring;

/// <summary>模板里的一道题。</summary>
public sealed class PaperTemplateItem : Entity<long>
{
    private PaperTemplateItem()
    {
    }

    private PaperTemplateItem(long questionId, Score score, int sortOrder)
    {
        QuestionId = questionId;
        Score = score;
        SortOrder = sortOrder;
    }

    public long TemplateId { get; private set; }

    public long QuestionId { get; private set; }

    public Score Score { get; private set; } = Score.Zero;

    public int SortOrder { get; private set; }

    internal static PaperTemplateItem Create(long questionId, Score score, int sortOrder) =>
        new(questionId, score, sortOrder);
}

/// <summary>套用模板时被跳过的题目。</summary>
public sealed record TemplateSkippedItem(long QuestionId, string Code, string Reason);

/// <summary>套用模板的结果。</summary>
public sealed record TemplateApplyResult(
    int AppliedCount,
    int SkippedCount,
    decimal TotalScore,
    IReadOnlyList<TemplateSkippedItem> Skipped);

/// <summary>
/// 候选题目在模板套用时的状态。
/// </summary>
public sealed record TemplateQuestionInfo(Question Question, bool Available, string? Reason);

/// <summary>
/// 卷型模板聚合根。结构类似试卷，但没有状态机——
/// 模板不是考卷，只是一份「可以照着摆」的骨架。
/// </summary>
public sealed class PaperTemplate : AuditableEntity, IAuditedEntity
{
    private readonly List<PaperTemplateItem> _items = [];

    private PaperTemplate()
    {
    }

    private PaperTemplate(
        string name,
        PaperKind kind,
        VariantRule variantRule,
        int durationMinutes,
        Score? passScore,
        DateTimeOffset now,
        long? actorId)
        : base(now, actorId)
    {
        Name = name;
        Kind = kind;
        VariantRule = variantRule;
        DurationMinutes = durationMinutes;
        PassScore = passScore;
    }

    public string Name { get; private set; } = string.Empty;

    public PaperKind Kind { get; private set; }

    public VariantRule VariantRule { get; private set; }

    public int DurationMinutes { get; private set; }

    public Score? PassScore { get; private set; }

    /// <summary>来源试卷（由试卷另存而来时才有）。</summary>
    public long? SourcePaperId { get; private set; }

    public IReadOnlyCollection<PaperTemplateItem> Items => _items.AsReadOnly();

    /// <summary>模板题目的总分。</summary>
    public decimal TotalScore => _items.Sum(i => i.Score.Value);

    /// <summary>由试卷另存为模板。</summary>
    public static PaperTemplate CreateFrom(
        Paper paper,
        string? name,
        DateTimeOffset now,
        long? actorId = null)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            name = paper.Name;
        }

        var template = new PaperTemplate(
            name.Trim(),
            paper.Kind,
            paper.VariantRule,
            paper.DurationMinutes,
            paper.PassScore,
            now,
            actorId)
        {
            SourcePaperId = paper.Id,
        };

        var order = 0;
        foreach (var item in paper.Items.OrderBy(i => i.SortOrder))
        {
            template._items.Add(PaperTemplateItem.Create(item.QuestionId, item.Score, order++));
        }

        return template;
    }

    /// <summary>
    /// 套用到目标试卷。已停用或已删除的题目会被跳过，并逐条报告跳过清单——
    /// 悄悄少一道题比报错更糟。
    /// </summary>
    public TemplateApplyResult ApplyTo(
        Paper paper,
        IReadOnlyList<TemplateQuestionInfo> pool,
        DateTimeOffset now,
        long? actorId = null)
    {
        if (paper.Kind != Kind)
        {
            throw new BusinessRuleException("模板与试卷的形态不一致，不能套用。");
        }

        var byId = pool.ToDictionary(p => p.Question.Id);
        var applied = new List<(Question Question, Score Score)>();
        var skipped = new List<TemplateSkippedItem>();

        foreach (var item in _items.OrderBy(i => i.SortOrder))
        {
            if (!byId.TryGetValue(item.QuestionId, out var info))
            {
                skipped.Add(new TemplateSkippedItem(item.QuestionId, string.Empty, "题目不存在"));
                continue;
            }

            if (!info.Available)
            {
                skipped.Add(new TemplateSkippedItem(
                    item.QuestionId,
                    info.Question.Code,
                    info.Reason ?? "题目不可用"));
                continue;
            }

            applied.Add((info.Question, item.Score));
        }

        var totalScore = applied.Sum(a => a.Score.Value);

        paper.ReplaceItems(applied, now, actorId);
        paper.UpdateMeta(
            paper.Name,
            paper.Batch,
            paper.Description,
            Score.Paper(totalScore),
            DurationMinutes,
            PassScore,
            paper.Note,
            now,
            actorId);
        paper.SetVariantRule(VariantRule, now, actorId);

        return new TemplateApplyResult(applied.Count, skipped.Count, totalScore, skipped);
    }
}
