using Exam.Domain.Grading;

namespace Exam.Application.Common.Interfaces;

/// <summary>成绩发布记录。</summary>
public interface IGradePublicationRepository
{
    Task AddAsync(GradePublication publication, CancellationToken cancellationToken = default);

    /// <summary>取回场次的全部发布记录，按发布时间正序。</summary>
    Task<IReadOnlyList<GradePublication>> ListBySessionAsync(
        long examSessionId,
        CancellationToken cancellationToken = default);

    /// <summary>取回覆盖某份作答的最新一条发布记录。没有则返回空。</summary>
    Task<GradePublication?> GetCoveringAsync(
        long examSessionId,
        long attemptId,
        CancellationToken cancellationToken = default);
}
