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
