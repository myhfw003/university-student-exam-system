using Exam.Domain.Learning;

namespace Exam.Application.Common.Interfaces;

/// <summary>错题本。</summary>
public interface IMistakeRepository
{
    /// <summary>取回某人某题的错误记录。没有则返回空。</summary>
    Task<Mistake?> GetAsync(
        long userId,
        long questionId,
        CancellationToken cancellationToken = default);

    Task AddAsync(Mistake mistake, CancellationToken cancellationToken = default);

    void Update(Mistake mistake);
}
