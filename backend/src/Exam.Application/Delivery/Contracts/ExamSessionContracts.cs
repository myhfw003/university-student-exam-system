using Exam.Application.Authoring.Contracts;
using Exam.Domain.Authoring;
using Exam.Domain.Delivery;

namespace Exam.Application.Delivery.Contracts;

/// <summary>场次摘要。</summary>
public sealed record ExamSessionSummaryDto(
    long Id,
    string Name,
    long PaperId,
    string PaperName,
    string Status,
    string StatusLabel,
    DateTimeOffset OpenAt,
    DateTimeOffset CloseAt,
    int DurationMinutes,
    string ParticipantMode,
    string ParticipantModeLabel,
    string VariantRule,
    string VariantRuleLabel,
    DateTimeOffset? PublishedAt,
    DateTimeOffset CreatedAt);

/// <summary>场次详情。</summary>
public sealed record ExamSessionDetailDto(
    ExamSessionSummaryDto Session,
    long? SnapshotId,
    ExamRulesDto Rules,
    string? Note,
    IReadOnlyList<long> ParticipantTagIds,
    IReadOnlyList<long> ParticipantUserIds);

/// <summary>分页的场次列表。</summary>
public sealed record ExamSessionListResponse(
    IReadOnlyList<ExamSessionSummaryDto> Items,
    int Total,
    int Page,
    int Size);

/// <summary>场次 DTO 组装。</summary>
public static class ExamSessionDtoFactory
{
    public static ExamSessionSummaryDto ToSummary(ExamSession session, string paperName) => new(
        session.Id,
        session.Name,
        session.PaperId,
        paperName,
        session.Status.ToStorage(),
        session.Status.Label(),
        session.OpenAt,
        session.CloseAt,
        session.DurationMinutes,
        session.ParticipantMode.ToStorage(),
        session.ParticipantMode.Label(),
        session.VariantRule.ToStorage(),
        session.VariantRule.Label(),
        session.PublishedAt,
        session.CreatedAt);

    public static ExamSessionDetailDto ToDetail(ExamSession session, string paperName) => new(
        ToSummary(session, paperName),
        session.SnapshotId,
        ExamRulesDto.From(session.Rules),
        session.Note,
        session.ParticipantTagIds.ToList(),
        session.ParticipantUserIds.ToList());
}
