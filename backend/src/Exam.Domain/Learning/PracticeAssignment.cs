using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Learning;

/// <summary>练习开放单状态。</summary>
public enum PracticeAssignmentStatus
{
    /// <summary>草稿：还没上架。</summary>
    Draft,

    /// <summary>已上架。</summary>
    Published,

    /// <summary>已下架。</summary>
    Archived,
}

/// <summary>
/// 练习开放单。一张单子挂一份试卷——单题重做就是「只有一道题的试卷」。
/// <para>
/// 开放范围是组织标签：空表示全员可见。
/// </para>
/// </summary>
public sealed class PracticeAssignment : AuditableEntity, IAuditedEntity
{
    private PracticeAssignment()
    {
    }

    private PracticeAssignment(
        long paperId,
        string title,
        IReadOnlyList<long> scopeTagIds,
        DateTimeOffset? openAt,
        DateTimeOffset? closeAt,
        DateTimeOffset now,
        long? actorId)
        : base(now, actorId)
    {
        PaperId = paperId;
        Title = title;
        ScopeTagIds = scopeTagIds;
        OpenAt = openAt;
        CloseAt = closeAt;
    }

    /// <summary>练习挂的试卷。</summary>
    public long PaperId { get; private set; }

    /// <summary>练习标题。</summary>
    public string Title { get; private set; } = string.Empty;

    public PracticeAssignmentStatus Status { get; private set; }

    /// <summary>开放范围（组织标签 ID）。空 = 全员可见。</summary>
    public IReadOnlyList<long> ScopeTagIds { get; private set; } = [];

    /// <summary>开放时间。</summary>
    public DateTimeOffset? OpenAt { get; private set; }

    /// <summary>关闭时间。</summary>
    public DateTimeOffset? CloseAt { get; private set; }

    /// <summary>上架时间。</summary>
    public DateTimeOffset? PublishedAt { get; private set; }

    /// <summary>练习规则（JSON）。真正的规则在练习规则里落地，这里先留位。</summary>
    public string Rules { get; private set; } = "{}";

    public static PracticeAssignment Create(
        long paperId,
        string title,
        IReadOnlyCollection<long>? scopeTagIds,
        DateTimeOffset? openAt,
        DateTimeOffset? closeAt,
        DateTimeOffset now,
        long? actorId = null)
    {
        if (paperId <= 0)
        {
            throw new BusinessRuleException("练习试卷不合法。");
        }

        if (string.IsNullOrWhiteSpace(title))
        {
            throw new BusinessRuleException("练习标题不能为空。");
        }

        if (scopeTagIds?.Any(id => id <= 0) == true)
        {
            throw new BusinessRuleException("开放范围里的标签不合法。");
        }

        return new PracticeAssignment(
            paperId,
            title.Trim(),
            scopeTagIds?.Distinct().OrderBy(id => id).ToList() ?? [],
            openAt,
            closeAt,
            now,
            actorId);
    }

    /// <summary>
    /// 改设置：标题、开放范围与开放期。
    /// <para>改的是「接下来谁能看到、什么时候能练」，已上架的练习改了立即生效。</para>
    /// </summary>
    public void UpdateSettings(
        string title,
        IReadOnlyCollection<long>? scopeTagIds,
        DateTimeOffset? openAt,
        DateTimeOffset? closeAt,
        DateTimeOffset now,
        long? actorId = null)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            throw new BusinessRuleException("练习标题不能为空。");
        }

        if (scopeTagIds?.Any(id => id <= 0) == true)
        {
            throw new BusinessRuleException("开放范围里的标签不合法。");
        }

        if (openAt is not null && closeAt is not null && closeAt <= openAt)
        {
            throw new BusinessRuleException("关闭时间必须晚于开放时间。");
        }

        Title = title.Trim();
        ScopeTagIds = scopeTagIds?.Distinct().OrderBy(id => id).ToList() ?? [];
        OpenAt = openAt;
        CloseAt = closeAt;
        Touch(now, actorId);
    }

    /// <summary>上架。草稿与已下架的练习都能重新上架。</summary>
    public void Publish(DateTimeOffset now, long? actorId = null)
    {
        if (Status == PracticeAssignmentStatus.Published)
        {
            throw new InvalidStateTransitionException("练习已经上架了。");
        }

        Status = PracticeAssignmentStatus.Published;
        PublishedAt = now;
        Touch(now, actorId);
    }

    /// <summary>下架。下架之后学生就看不到这个练习了。</summary>
    public void Archive(DateTimeOffset now, long? actorId = null)
    {
        if (Status != PracticeAssignmentStatus.Published)
        {
            throw new InvalidStateTransitionException("只有已上架的练习才能下架。");
        }

        Status = PracticeAssignmentStatus.Archived;
        Touch(now, actorId);
    }

    /// <summary>现在能练吗？</summary>
    public bool IsOpen(DateTimeOffset now) =>
        Status == PracticeAssignmentStatus.Published
        && (OpenAt is null || OpenAt <= now)
        && (CloseAt is null || now <= CloseAt);
}

public static class PracticeAssignmentStatuses
{
    public static string ToStorage(this PracticeAssignmentStatus status) => status switch
    {
        PracticeAssignmentStatus.Published => "published",
        PracticeAssignmentStatus.Archived => "archived",
        _ => "draft",
    };

    public static PracticeAssignmentStatus? FromStorage(string? storage) => storage switch
    {
        "draft" => PracticeAssignmentStatus.Draft,
        "published" => PracticeAssignmentStatus.Published,
        "archived" => PracticeAssignmentStatus.Archived,
        _ => null,
    };

    public static string Label(this PracticeAssignmentStatus status) => status switch
    {
        PracticeAssignmentStatus.Published => "已上架",
        PracticeAssignmentStatus.Archived => "已下架",
        _ => "草稿",
    };
}
