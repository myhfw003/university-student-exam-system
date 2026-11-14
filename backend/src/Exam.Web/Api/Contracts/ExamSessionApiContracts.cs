using Exam.Application.Authoring.Commands;

namespace Exam.Web.Api.Contracts;

/// <summary>新建考试场次。</summary>
public sealed record CreateExamSessionRequest(
    long PaperId,
    string Name,
    DateTimeOffset OpenAt,
    DateTimeOffset CloseAt,
    int DurationMinutes,
    string ParticipantMode,
    IReadOnlyList<long>? ParticipantTagIds,
    IReadOnlyList<long>? ParticipantUserIds,
    string? VariantRule,
    ExamRulesDtoInput? Rules,
    string? Note);

/// <summary>修改考试场次。</summary>
public sealed record UpdateExamSessionRequest(
    string Name,
    DateTimeOffset OpenAt,
    DateTimeOffset CloseAt,
    int DurationMinutes,
    string ParticipantMode,
    IReadOnlyList<long>? ParticipantTagIds,
    IReadOnlyList<long>? ParticipantUserIds,
    string? VariantRule,
    ExamRulesDtoInput? Rules,
    string? Note);

/// <summary>设置场次名单（按组织标签）。</summary>
public sealed record SetExamParticipantsRequest(IReadOnlyList<long>? ParticipantTagIds);

/// <summary>
/// 发布成绩。
/// <para>
/// <c>scope</c>：<c>all</c>（全部成绩）或 <c>objective_only</c>（只发布客观题）。
/// <c>includeAttemptIds</c> 不给就按发布那一刻已经交卷的作答来。
/// </para>
/// </summary>
public sealed record PublishGradesRequest(
    string Scope,
    IReadOnlyList<long>? IncludeAttemptIds);
