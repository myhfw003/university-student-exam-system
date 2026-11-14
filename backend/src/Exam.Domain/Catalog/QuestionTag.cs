using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Catalog;

/// <summary>题目与标签的关联。难度维度不存这里——它单独放在题目的冗余列上。</summary>
public sealed class QuestionTag : Entity<long>
{
    public QuestionTag()
    {
    }

    private QuestionTag(long questionId, long tagId, DateTimeOffset assignedAt)
    {
        QuestionId = questionId;
        TagId = tagId;
        AssignedAt = assignedAt;
    }

    public long QuestionId { get; private set; }

    public long TagId { get; private set; }

    public DateTimeOffset AssignedAt { get; private set; }

    public static QuestionTag Create(long tagId, DateTimeOffset assignedAt) =>
        new(0, tagId, assignedAt);
}
