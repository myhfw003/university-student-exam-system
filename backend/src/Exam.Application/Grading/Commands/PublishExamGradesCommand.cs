using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Grading.Contracts;
using Exam.Domain.Delivery;
using Exam.Domain.Grading;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Grading.Commands;

/// <summary>
/// 发布成绩。
/// <para>
/// 范围两种：<c>all</c>（全部成绩）与 <c>objective_only</c>（只发布客观题）。
/// </para>
/// </summary>
public sealed record PublishExamGradesCommand(
    long ExamSessionId,
    string Scope,
    IReadOnlyList<long>? IncludeAttemptIds)
    : IAppCommand<GradePublicationDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.GradePublish];
}

public sealed class PublishExamGradesCommandValidator : AbstractValidator<PublishExamGradesCommand>
{
    public PublishExamGradesCommandValidator()
    {
        RuleFor(x => x.ExamSessionId).GreaterThan(0).WithMessage("考试场次 ID 不合法。");

        RuleFor(x => x.Scope)
            .Must(scope => scope is "all" or "objective_only")
            .WithMessage("发布范围只能是 all（全部成绩）或 objective_only（仅客观题）。");

        RuleFor(x => x.IncludeAttemptIds)
            .Must(ids => ids is null || ids.All(id => id > 0))
            .WithMessage("作答会话 ID 不合法。")
            .When(x => x.IncludeAttemptIds is not null);
    }
}

public sealed class PublishExamGradesHandler : IRequestHandler<PublishExamGradesCommand, GradePublicationDto>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IAttemptRepository _attempts;
    private readonly IGradePublicationRepository _publications;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public PublishExamGradesHandler(
        IExamSessionRepository sessions,
        IAttemptRepository attempts,
        IGradePublicationRepository publications,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _attempts = attempts;
        _publications = publications;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<GradePublicationDto> Handle(
        PublishExamGradesCommand request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        if (session.Status == ExamSessionStatus.Scheduled)
        {
            throw new BusinessRuleException("场次还没发布，没有成绩可发布。");
        }

        var publisherId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var scope = request.Scope == "objective_only"
            ? GradePublicationScope.ObjectiveOnly
            : GradePublicationScope.All;

        var submitted = (await _attempts.ListBySessionAsync(session.Id, cancellationToken))
            // 强制交卷与超时自动交卷也要能被发布成绩。
            .Where(a => a.IsSubmitted)
            .ToList();

        IReadOnlyList<long> covered;

        if (request.IncludeAttemptIds is { Count: > 0 })
        {
            var sessionAttemptIds = submitted.Select(a => a.Id).ToHashSet();
            var foreign = request.IncludeAttemptIds.Where(id => !sessionAttemptIds.Contains(id)).ToList();

            if (foreign.Count > 0)
            {
                throw new BusinessRuleException("有作答会话不属于这场考试，不能发布。");
            }

            covered = request.IncludeAttemptIds.Distinct().OrderBy(id => id).ToList();
        }
        else
        {
            // 没点名就按发布那一刻已经交卷的作答来——之后才交卷的人不会被顺带放出去。
            covered = submitted.Select(a => a.Id).OrderBy(id => id).ToList();
        }

        if (covered.Count == 0)
        {
            throw new BusinessRuleException("这场考试还没有交卷的作答，没有成绩可发布。");
        }

        var now = _clock.UtcNow;
        var publication = GradePublication.Create(session.Id, scope, covered, now, publisherId);
        await _publications.AddAsync(publication, cancellationToken);

        await _audit.RecordAsync(
            "exam_session.publish_grades",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["scope"] = scope.ToStorage(),
                ["publishedBy"] = publisherId,
                ["affectedAttempts"] = covered.Count,
                ["attemptIds"] = string.Join(',', covered),
            },
            cancellationToken);

        return new GradePublicationDto(
            publication.Id,
            publication.ExamSessionId,
            publication.Scope.ToStorage(),
            publication.Scope.Label(),
            publication.PublishedAt,
            publication.PublishedBy,
            publication.IncludedAttemptIds,
            publication.IncludedAttemptIds.Count);
    }
}
