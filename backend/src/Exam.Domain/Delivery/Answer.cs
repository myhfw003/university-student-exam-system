using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Delivery;

/// <summary>
/// 一道题的当前答案。
/// <para>
/// 这里存的是**当前值**：每次保存覆盖同一行，修订历史走 <c>answer_revision</c> 流水。
/// </para>
/// </summary>
public sealed class Answer : Entity<long>
{
    private Answer()
    {
    }

    private Answer(
        long attemptId,
        long questionId,
        long? paperItemId,
        AnswerPayload payload,
        int clientSeq,
        DateTimeOffset now)
    {
        AttemptId = attemptId;
        QuestionId = questionId;
        PaperItemId = paperItemId;
        Payload = payload;
        ClientSeq = clientSeq;
        Revision = 1;
        IsBlank = payload.IsEmpty;
        SavedAt = now;
        CreatedAt = now;
    }

    public long AttemptId { get; private set; }

    public long QuestionId { get; private set; }

    /// <summary>卷面题位。</summary>
    public long? PaperItemId { get; private set; }

    /// <summary>答案载荷。</summary>
    public AnswerPayload Payload { get; private set; } = new();

    /// <summary>是否未作答。</summary>
    public bool IsBlank { get; private set; }

    /// <summary>修订序号，从 1 开始。</summary>
    public int Revision { get; private set; }

    /// <summary>对应的客户端序列号。</summary>
    public int ClientSeq { get; private set; }

    /// <summary>服务端保存时间。</summary>
    public DateTimeOffset SavedAt { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public static Answer Create(
        long attemptId,
        long questionId,
        long? paperItemId,
        AnswerPayload payload,
        int clientSeq,
        DateTimeOffset now) =>
        new(attemptId, questionId, paperItemId, payload, clientSeq, now);

    /// <summary>覆盖答案，修订序号 +1。</summary>
    public void Update(AnswerPayload payload, int clientSeq, DateTimeOffset now)
    {
        Payload = payload;
        ClientSeq = clientSeq;
        Revision++;
        IsBlank = payload.IsEmpty;
        SavedAt = now;
    }
}
