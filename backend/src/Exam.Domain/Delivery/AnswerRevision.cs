using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Delivery;

/// <summary>
/// 答案修订流水。**追加式**：只追加，不修改、不删除。
/// <para>
/// 每次保存都留下一份当时的答案快照，事后能完整还原「考生什么时候改成了什么」。
/// 应用账号对该表没有 UPDATE / DELETE 权限——流水只能往前写。
/// </para>
/// </summary>
public sealed class AnswerRevision : Entity<long>
{
    private AnswerRevision()
    {
    }

    private AnswerRevision(
        long attemptId,
        long questionId,
        int clientSeq,
        AnswerPayload payload,
        int revision,
        DateTimeOffset? clientSentAt,
        DateTimeOffset serverReceivedAt)
    {
        AttemptId = attemptId;
        QuestionId = questionId;
        ClientSeq = clientSeq;
        Payload = payload;
        Revision = revision;
        ClientSentAt = clientSentAt;
        ServerReceivedAt = serverReceivedAt;
    }

    public long AttemptId { get; private set; }

    public long QuestionId { get; private set; }

    /// <summary>对应的客户端序列号。</summary>
    public int ClientSeq { get; private set; }

    /// <summary>当时的答案载荷。</summary>
    public AnswerPayload Payload { get; private set; } = new();

    /// <summary>修订序号。</summary>
    public int Revision { get; private set; }

    /// <summary>客户端声称的发送时间（仅供参考，不作为判定依据）。</summary>
    public DateTimeOffset? ClientSentAt { get; private set; }

    /// <summary>服务端收到的时间。</summary>
    public DateTimeOffset ServerReceivedAt { get; private set; }

    public static AnswerRevision Create(
        long attemptId,
        long questionId,
        int clientSeq,
        AnswerPayload payload,
        int revision,
        DateTimeOffset? clientSentAt,
        DateTimeOffset serverReceivedAt) =>
        new(attemptId, questionId, clientSeq, payload, revision, clientSentAt, serverReceivedAt);
}
