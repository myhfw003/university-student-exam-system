using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Authoring;

/// <summary>试卷与标签的关联。</summary>
public sealed class PaperTag : Entity<long>
{
    public PaperTag()
    {
    }

    private PaperTag(long paperId, long tagId, DateTimeOffset assignedAt)
    {
        PaperId = paperId;
        TagId = tagId;
        AssignedAt = assignedAt;
    }

    public long PaperId { get; private set; }

    public long TagId { get; private set; }

    public DateTimeOffset AssignedAt { get; private set; }

    public static PaperTag Create(long paperId, long tagId, DateTimeOffset assignedAt) =>
        new(paperId, tagId, assignedAt);
}
