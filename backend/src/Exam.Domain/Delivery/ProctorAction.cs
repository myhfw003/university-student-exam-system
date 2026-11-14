using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Delivery;

/// <summary>监考处置类型。</summary>
public enum ProctorActionType
{
    /// <summary>警告：学生端实时收到提醒。</summary>
    Warn,

    /// <summary>备注：只记录，不打扰考生。</summary>
    Note,

    /// <summary>强制交卷：必须填写原因。</summary>
    ForceSubmit,
}

/// <summary>
/// 监考处置记录。处置写审计，事后能查清「谁在什么时候对谁做了什么」。
/// </summary>
public sealed class ProctorAction : Entity<long>, IAuditedEntity
{
    private ProctorAction()
    {
    }

    private ProctorAction(
        long attemptId,
        long examSessionId,
        ProctorActionType actionType,
        string? message,
        string? reason,
        long operatorId,
        DateTimeOffset now)
    {
        AttemptId = attemptId;
        ExamSessionId = examSessionId;
        ActionType = actionType;
        Message = message;
        Reason = reason;
        OperatorId = operatorId;
        CreatedAt = now;
    }

    public long AttemptId { get; private set; }

    public long ExamSessionId { get; private set; }

    public ProctorActionType ActionType { get; private set; }

    /// <summary>给考生看的消息。</summary>
    public string? Message { get; private set; }

    /// <summary>处置原因。强制交卷必填。</summary>
    public string? Reason { get; private set; }

    /// <summary>处置人。</summary>
    public long OperatorId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? UpdatedAt { get; private set; }

    public static ProctorAction Create(
        long attemptId,
        long examSessionId,
        ProctorActionType actionType,
        string? message,
        string? reason,
        long operatorId,
        DateTimeOffset now)
    {
        if (actionType == ProctorActionType.ForceSubmit && string.IsNullOrWhiteSpace(reason))
        {
            throw new BusinessRuleException("强制交卷必须填写原因。");
        }

        return new ProctorAction(
            attemptId,
            examSessionId,
            actionType,
            string.IsNullOrWhiteSpace(message) ? null : message.Trim(),
            string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
            operatorId,
            now);
    }
}

public static class ProctorActionTypes
{
    public static string ToStorage(this ProctorActionType type) => type switch
    {
        ProctorActionType.Note => "note",
        ProctorActionType.ForceSubmit => "force_submit",
        _ => "warn",
    };

    public static ProctorActionType? FromStorage(string? storage) => storage switch
    {
        "warn" => ProctorActionType.Warn,
        "note" => ProctorActionType.Note,
        "force_submit" => ProctorActionType.ForceSubmit,
        _ => null,
    };

    public static string Label(this ProctorActionType type) => type switch
    {
        ProctorActionType.Note => "备注",
        ProctorActionType.ForceSubmit => "强制交卷",
        _ => "警告",
    };
}
