using Exam.Domain.Catalog;
using Exam.Domain.Learning;

namespace Exam.Application.Common.Interfaces;

/// <summary>错题本查询条件。</summary>
public sealed record MistakeSearchCriteria
{
    /// <summary>错题归属的学生。</summary>
    public long UserId { get; init; }

    /// <summary>按标签过滤（含标签子树）。</summary>
    public IReadOnlyCollection<long>? TagIds { get; init; }

    /// <summary>按题型过滤。</summary>
    public QuestionType? QuestionType { get; init; }

    /// <summary>最近做错的时间从哪天起。</summary>
    public DateTimeOffset? From { get; init; }

    /// <summary>最近做错的时间到哪天止。</summary>
    public DateTimeOffset? To { get; init; }

    /// <summary>已掌握的也算进来。</summary>
    public bool IncludeResolved { get; init; }
}

/// <summary>错题本。</summary>
public interface IMistakeRepository
{
    /// <summary>取回某人某题的错误记录。没有则返回空。</summary>
    Task<Mistake?> GetAsync(
        long userId,
        long questionId,
        CancellationToken cancellationToken = default);

    /// <summary>分页查询错题本。</summary>
    Task<IReadOnlyList<Mistake>> SearchAsync(
        MistakeSearchCriteria criteria,
        int skip,
        int take,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(
        MistakeSearchCriteria criteria,
        CancellationToken cancellationToken = default);

    Task AddAsync(Mistake mistake, CancellationToken cancellationToken = default);

    void Update(Mistake mistake);
}
