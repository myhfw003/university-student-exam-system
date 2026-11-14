using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Authoring;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>
/// 开始作答。已有进行中的会话时返回**同一个**会话（幂等），不新建。
/// </summary>
public sealed record StartAttemptCommand(long? ExamSessionId, long? PracticeAssignmentId)
    : IAppCommand<AttemptResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptTake];
}

public sealed class StartAttemptHandler : IRequestHandler<StartAttemptCommand, AttemptResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IAnswerRepository _answers;
    private readonly IExamSessionRepository _sessions;
    private readonly IExamParticipantRepository _participants;
    private readonly IPaperRepository _papers;
    private readonly AttemptPaperSurfaceBuilder _surfaceBuilder;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public StartAttemptHandler(
        IAttemptRepository attempts,
        IAnswerRepository answers,
        IExamSessionRepository sessions,
        IExamParticipantRepository participants,
        IPaperRepository papers,
        AttemptPaperSurfaceBuilder surfaceBuilder,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _answers = answers;
        _sessions = sessions;
        _participants = participants;
        _papers = papers;
        _surfaceBuilder = surfaceBuilder;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<AttemptResponse> Handle(StartAttemptCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录后再参加考试。");

        if (request.ExamSessionId is null)
        {
            throw new BusinessRuleException("练习场次尚未开放，当前仅支持考试场次。");
        }

        var session = await _sessions.GetByIdAsync(request.ExamSessionId.Value, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var now = _clock.UtcNow;
        session.EnsureCanEnter(now);
        await EnsureOnRosterAsync(session, userId, cancellationToken);

        // 幂等：已有进行中的会话就返回同一个，不新建。
        var active = await _attempts.GetActiveAsync(userId, session.Id, cancellationToken);
        if (active is not null)
        {
            return await BuildResponseAsync(active, session, cancellationToken);
        }

        var used = await _attempts.CountByUserAsync(userId, session.Id, cancellationToken);
        var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        if (used > 0 && !paper.AllowRetake)
        {
            throw new BusinessRuleException("本场考试不允许重考。");
        }

        var surface = await _surfaceBuilder.BuildAsync(session, userId, cancellationToken);

        var attempt = Attempt.CreateExam(
            session.Id,
            userId,
            used + 1,
            surface.VariantKey,
            surface.VariantSeed,
            now,
            userId);

        attempt.Start(now, session.DurationMinutes, session.CloseAt);

        await _attempts.AddAsync(attempt, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return AttemptResponseFactory.Build(attempt, session, surface, [], now);
    }

    private async Task EnsureOnRosterAsync(
        ExamSession session,
        long userId,
        CancellationToken cancellationToken)
    {
        // 全员开放：登录即可见。
        if (session.ParticipantMode == ParticipantMode.OpenToAll)
        {
            return;
        }

        var participant = await _participants.GetAsync(session.Id, userId, cancellationToken);
        if (participant is null)
        {
            throw new ForbiddenException("不在本场考试的名单内。");
        }

        if (participant.Status == ParticipantStatus.Disqualified)
        {
            throw new ForbiddenException("已被取消本场考试的资格。");
        }
    }

    private async Task<AttemptResponse> BuildResponseAsync(
        Attempt attempt,
        ExamSession session,
        CancellationToken cancellationToken)
    {
        var surface = await _surfaceBuilder.BuildAsync(session, attempt.UserId, cancellationToken);
        var answers = await _answers.ListByAttemptAsync(attempt.Id, cancellationToken);
        var now = _clock.UtcNow;

        return AttemptResponseFactory.Build(attempt, session, surface, answers, now);
    }
}
