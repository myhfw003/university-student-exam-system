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
    private readonly IPaperSnapshotRepository _snapshots;
    private readonly IPracticeAssignmentRepository _practiceAssignments;
    private readonly Exam.Application.Learning.Services.PracticeVisibilityResolver _practiceVisibility;
    private readonly Exam.Application.Learning.Services.PracticeRulesResolver _practiceRules;
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
        IPaperSnapshotRepository snapshots,
        IPracticeAssignmentRepository practiceAssignments,
        Exam.Application.Learning.Services.PracticeVisibilityResolver practiceVisibility,
        Exam.Application.Learning.Services.PracticeRulesResolver practiceRules,
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
        _snapshots = snapshots;
        _practiceAssignments = practiceAssignments;
        _practiceVisibility = practiceVisibility;
        _practiceRules = practiceRules;
        _surfaceBuilder = surfaceBuilder;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<AttemptResponse> Handle(StartAttemptCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录后再参加考试。");

        if (request.ExamSessionId is null && request.PracticeAssignmentId is null)
        {
            throw new BusinessRuleException("请指定考试场次或练习。");
        }

        if (request.ExamSessionId is not null && request.PracticeAssignmentId is not null)
        {
            throw new BusinessRuleException("考试场次与练习只能二选一。");
        }

        return request.ExamSessionId is { } sessionId
            ? await StartExamAsync(sessionId, userId, cancellationToken)
            : await StartPracticeAsync(request.PracticeAssignmentId!.Value, userId, cancellationToken);
    }

    /// <summary>开始考试。</summary>
    private async Task<AttemptResponse> StartExamAsync(
        long sessionId,
        long userId,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(sessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var now = _clock.UtcNow;
        session.EnsureCanEnter(now);
        await EnsureOnRosterAsync(session, userId, cancellationToken);

        // 幂等：已有进行中的会话就返回同一个，不新建。
        var active = await _attempts.GetActiveAsync(userId, session.Id, cancellationToken);
        if (active is not null)
        {
            return await BuildResponseAsync(active, cancellationToken);
        }

        var used = await _attempts.CountByUserAsync(userId, session.Id, cancellationToken);
        var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        if (used > 0 && !paper.AllowRetake)
        {
            throw new BusinessRuleException("本场考试不允许重考。");
        }

        var surface = await _surfaceBuilder.BuildForSessionAsync(session, userId, cancellationToken);

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

    /// <summary>
    /// 开始练习。
    /// <para>练习不计时、不强制交卷、不限制切屏；次数用尽就不再给开新的会话。</para>
    /// </summary>
    private async Task<AttemptResponse> StartPracticeAsync(
        long assignmentId,
        long userId,
        CancellationToken cancellationToken)
    {
        var now = _clock.UtcNow;

        // 可见性：不在范围内的练习，就当没有这个练习。
        var visible = await _practiceVisibility.ListVisibleAsync(userId, now, cancellationToken);
        var assignment = visible.FirstOrDefault(a => a.Id == assignmentId)
            ?? throw new NotFoundException("练习不存在或不在可见范围内。");

        var paper = await _papers.GetByIdAsync(assignment.PaperId, cancellationToken)
            ?? throw new NotFoundException("练习试卷不存在。");

        if (paper.Kind != PaperKind.Practice)
        {
            throw new BusinessRuleException("练习只能挂练习类型的试卷。");
        }

        // 幂等：已有进行中的会话就返回同一个，不新建。
        var active = await _attempts.GetActivePracticeAsync(userId, assignment.Id, cancellationToken);
        if (active is not null)
        {
            return await BuildResponseAsync(active, cancellationToken);
        }

        var rules = paper.PracticeRules ?? PracticeRules.Default;
        var used = await _attempts.CountByPracticeAsync(userId, assignment.Id, cancellationToken);

        if (rules.MaxAttempts > 0 && used >= rules.MaxAttempts)
        {
            throw new BusinessRuleException($"练习次数已用完（最多 {rules.MaxAttempts} 次）。");
        }

        var snapshot = await _snapshots.GetLatestAsync(paper.Id, cancellationToken)
            ?? throw new BusinessRuleException("练习试卷还没有发布快照。");

        // 练习不置换卷面：重做就是要看清原题。
        var surface = await _surfaceBuilder.BuildAsync(
            snapshot,
            VariantRule.Standard,
            userId,
            assignment.Id.ToString(),
            cancellationToken);

        var attempt = Attempt.CreatePractice(
            assignment.Id,
            userId,
            used + 1,
            surface.VariantKey,
            surface.VariantSeed,
            now,
            userId);

        attempt.StartPractice(now);

        await _attempts.AddAsync(attempt, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return AttemptResponseFactory.Build(attempt, null, surface, [], now, rules);
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
        CancellationToken cancellationToken)
    {
        var surface = await _surfaceBuilder.BuildForAttemptAsync(attempt, attempt.UserId, cancellationToken);
        var answers = await _answers.ListByAttemptAsync(attempt.Id, cancellationToken);
        var now = _clock.UtcNow;

        var session = attempt.ExamSessionId is { } sessionId
            ? await _sessions.GetByIdAsync(sessionId, cancellationToken)
            : null;

        var practiceRules = attempt.PracticeAssignmentId is { } assignmentId
            ? await _practiceRules.ResolveAsync(assignmentId, cancellationToken)
            : (PracticeRules?)null;

        return AttemptResponseFactory.Build(attempt, session, surface, answers, now, practiceRules);
    }
}
