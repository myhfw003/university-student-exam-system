using Exam.Domain.Delivery;

namespace Exam.Application.Common.Interfaces;

/// <summary>一次 upsert 的答案值。</summary>
public sealed record AnswerUpsertValue(
    long QuestionId,
    long? PaperItemId,
    AnswerPayload Payload,
    bool IsBlank,
    int ClientSeq,
    DateTimeOffset SavedAt);

public interface IAnswerRepository
{
    Task<IReadOnlyList<Answer>> ListByAttemptAsync(long attemptId, CancellationToken cancellationToken = default);

    Task<Answer?> GetAsync(long attemptId, long questionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 批量写入当前答案。同一 (attempt, question) 覆盖写并把修订序号 +1。
    /// </summary>
    Task UpsertRangeAsync(
        long attemptId,
        IReadOnlyList<AnswerUpsertValue> values,
        CancellationToken cancellationToken = default);
}
