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

/// <summary>一条答案的落库序列号。对账作业只看序列号，不看答案内容。</summary>
public sealed record AnswerSeqFact(long AttemptId, long QuestionId, int ClientSeq);

public interface IAnswerRepository
{
    Task<IReadOnlyList<Answer>> ListByAttemptAsync(long attemptId, CancellationToken cancellationToken = default);

    Task<Answer?> GetAsync(long attemptId, long questionId, CancellationToken cancellationToken = default);

    /// <summary>取回某次作答中指定题目的当前答案。</summary>
    Task<IReadOnlyList<Answer>> ListByQuestionsAsync(
        long attemptId,
        IReadOnlyCollection<long> questionIds,
        CancellationToken cancellationToken = default);

    /// <summary>批量取回作答的落库序列号。</summary>
    Task<IReadOnlyList<AnswerSeqFact>> ListSeqByAttemptsAsync(
        IReadOnlyCollection<long> attemptIds,
        CancellationToken cancellationToken = default);

    /// <summary>统计各会话已作答题数（不含未作答）。</summary>
    Task<IReadOnlyDictionary<long, int>> CountAnsweredAsync(
        IReadOnlyCollection<long> attemptIds,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 批量写入当前答案。同一 (attempt, question) 覆盖写并把修订序号 +1。
    /// </summary>
    Task UpsertRangeAsync(
        long attemptId,
        IReadOnlyList<AnswerUpsertValue> values,
        CancellationToken cancellationToken = default);
}
