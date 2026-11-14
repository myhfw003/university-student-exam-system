using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Catalog;

/// <summary>
/// 题库聚合根。
/// <para>
/// 题库只是一份题目清单。把题目移出题库**不会**删除题目本身——
/// 题目可能被多份试卷引用，删除的判断权在题目那一侧。
/// </para>
/// </summary>
public sealed class QuestionBank : AuditableEntity, IAuditedEntity
{
    public const int MaxNameLength = 100;

    private readonly List<QuestionBankItem> _items = [];

    private QuestionBank()
    {
    }

    private QuestionBank(string name, string? description, DateTimeOffset now, long? actorId)
        : base(now, actorId)
    {
        Name = name;
        Description = description;
    }

    public string Name { get; private set; } = string.Empty;

    public string? Description { get; private set; }

    /// <summary>题库中的题目。</summary>
    public IReadOnlyCollection<QuestionBankItem> Items => _items.AsReadOnly();

    /// <summary>题库中的题目 ID。</summary>
    public IReadOnlyCollection<long> QuestionIds => _items.Select(i => i.QuestionId).ToList();

    public static QuestionBank Create(
        string name,
        string? description,
        DateTimeOffset now,
        long? actorId = null)
    {
        EnsureName(name);

        return new QuestionBank(name.Trim(), string.IsNullOrWhiteSpace(description) ? null : description.Trim(), now, actorId);
    }

    public void Rename(string name, DateTimeOffset now, long? actorId = null)
    {
        EnsureName(name);
        Name = name.Trim();
        Touch(now, actorId);
    }

    public void ChangeDescription(string? description, DateTimeOffset now, long? actorId = null)
    {
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        Touch(now, actorId);
    }

    /// <summary>加入题目。重复加入是幂等的。</summary>
    public void AddQuestion(long questionId, DateTimeOffset now, long? actorId = null)
    {
        if (_items.Any(i => i.QuestionId == questionId))
        {
            return;
        }

        _items.Add(QuestionBankItem.Create(questionId, now));
        Touch(now, actorId);
    }

    /// <summary>移除题目。只移出题库，不删除题目本身。</summary>
    public void RemoveQuestion(long questionId, DateTimeOffset now, long? actorId = null)
    {
        var item = _items.FirstOrDefault(i => i.QuestionId == questionId)
            ?? throw new BusinessRuleException("题库中没有这道题。");
        _items.Remove(item);
        Touch(now, actorId);
    }

    private static void EnsureName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new BusinessRuleException("题库名称不能为空。");
        }

        if (name.Trim().Length > MaxNameLength)
        {
            throw new BusinessRuleException($"题库名称长度不能超过 {MaxNameLength} 位。");
        }
    }
}

/// <summary>题库与题目的关联。</summary>
public sealed class QuestionBankItem : Entity<long>
{
    public QuestionBankItem()
    {
    }

    private QuestionBankItem(long questionId, DateTimeOffset addedAt)
    {
        QuestionId = questionId;
        AddedAt = addedAt;
    }

    public long BankId { get; private set; }

    public long QuestionId { get; private set; }

    public DateTimeOffset AddedAt { get; private set; }

    public static QuestionBankItem Create(long questionId, DateTimeOffset addedAt) =>
        new(questionId, addedAt);
}
