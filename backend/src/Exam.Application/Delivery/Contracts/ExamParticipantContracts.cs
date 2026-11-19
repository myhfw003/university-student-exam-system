using Exam.Domain.Delivery;

namespace Exam.Application.Delivery.Contracts;

/// <summary>名单里的一名考生。</summary>
public sealed record ExamParticipantDto(
    long UserId,
    string Username,
    string DisplayName,
    string Status,
    string StatusLabel,
    int AttemptsUsed);

/// <summary>场次名单。</summary>
public sealed record ExamParticipantListResponse(
    long ExamSessionId,
    string ParticipantMode,
    string ParticipantModeLabel,
    IReadOnlyList<ExamParticipantDto> Items,
    int Total);

/// <summary>名单 DTO 组装。</summary>
public static class ExamParticipantDtoFactory
{
    public static ExamParticipantDto ToDto(ExamParticipant participant, string username, string displayName) => new(
        participant.UserId,
        username,
        displayName,
        participant.Status.ToStorage(),
        participant.Status.Label(),
        participant.AttemptsUsed);
}

/// <summary>名单导入时跳过的行。</summary>
public sealed record ExamParticipantImportFailure(int RowNumber, string Account, string Reason);

/// <summary>
/// 场次名单 CSV 导入的结果。
/// <para>
/// 导入的是**已有账号**：账号不存在的行被跳过并记下原因。
/// 导入后名单口径切到「指定考生」——名单就是这批账号。
/// </para>
/// </summary>
public sealed record ExamParticipantImportResult(
    long ExamSessionId,
    int Total,
    int Imported,
    IReadOnlyList<ExamParticipantImportFailure> Skipped,
    int ParticipantCount,
    string ParticipantMode,
    string ParticipantModeLabel);
