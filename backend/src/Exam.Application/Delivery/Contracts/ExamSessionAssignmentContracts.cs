using Exam.Domain.Delivery;

namespace Exam.Application.Delivery.Contracts;

/// <summary>场次的一名负责人。</summary>
public sealed record ExamSessionAssignmentDto(
    long UserId,
    string Username,
    string DisplayName,
    DateTimeOffset AssignedAt);

/// <summary>场次负责人列表。</summary>
public sealed record ExamSessionAssignmentListResponse(
    long ExamSessionId,
    IReadOnlyList<ExamSessionAssignmentDto> Items,
    int Total);

/// <summary>负责人 DTO 组装。</summary>
public static class ExamSessionAssignmentDtoFactory
{
    public static ExamSessionAssignmentDto ToDto(
        ExamSessionAssignment assignment,
        string username,
        string displayName) => new(
        assignment.UserId,
        username,
        displayName,
        assignment.CreatedAt);
}
