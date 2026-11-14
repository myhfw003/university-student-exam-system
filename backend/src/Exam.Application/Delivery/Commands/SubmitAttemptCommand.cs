using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>
/// 交卷。幂等：重复交卷返回同一个结果。
/// <para>交卷原因由服务端判定：客户端只能表达「主动交卷」。</para>
/// </summary>
public sealed record SubmitAttemptCommand(long AttemptId, string? Reason)
    : IAppCommand<SubmitAttemptResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptTake];
}

public sealed class SubmitAttemptHandler : IRequestHandler<SubmitAttemptCommand, SubmitAttemptResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IAnswerRepository _answers;
    private readonly IScoreResultRepository _scoreResults;
    private readonly IReviewTaskRepository _reviewTaskRepository;
    private readonly IExamParticipantRepository _participants;
    private readonly AttemptPaperResolver _resolver;
    private readonly AttemptScoringService _scoring;
    private readonly Exam.Application.Grading.Services.ReviewTaskGenerator _reviewTasks;
    private readonly Exam.Application.Grading.Services.GradeVisibilityResolver _visibility;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public SubmitAttemptHandler(
        IAttemptRepository attempts,
        IAnswerRepository answers,
        IScoreResultRepository scoreResults,
        IReviewTaskRepository reviewTaskRepository,
        IExamParticipantRepository participants,
        AttemptPaperResolver resolver,
        AttemptScoringService scoring,
        Exam.Application.Grading.Services.ReviewTaskGenerator reviewTasks,
        Exam.Application.Grading.Services.GradeVisibilityResolver visibility,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _answers = answers;
        _scoreResults = scoreResults;
        _reviewTaskRepository = reviewTaskRepository;
        _participants = participants;
        _resolver = resolver;
        _scoring = scoring;
        _reviewTasks = reviewTasks;
        _visibility = visibility;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<SubmitAttemptResponse> Handle(
        SubmitAttemptCommand request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var userId = _currentUser.UserId;
        if (userId != attempt.UserId && !_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new ForbiddenException("只能提交自己的作答。");
        }

        // 考试走场次快照；练习走练习开放单挂的试卷。
        var paper = await _resolver.ResolveAsync(attempt, cancellationToken);

        var now = _clock.UtcNow;

        // 幂等：已交卷直接返回同一个结果，不再推进状态。
        if (attempt.IsSubmitted)
        {
            return await BuildResponseAsync(attempt, cancellationToken);
        }

        // 交卷原因由服务端判定：超时就是 time_up，客户端说什么不算数。
        var reason = now > attempt.DeadlineAt ? SubmitReason.TimeUp : SubmitReason.Manual;

        attempt.Submit(reason, now);
        _attempts.Update(attempt);

        // 交卷事务内完成判分：客观题直接定分，主观题给建议分。
        var scoreResults = await _scoring.ScoreAsync(
            attempt,
            paper.Snapshot,
            paper.PaperItems,
            now,
            cancellationToken);

        await _scoreResults.AddRangeAsync(scoreResults, cancellationToken);

        // 主观题生成待阅任务：综合题按步骤拆开。
        var reviewTasks = await _reviewTasks.GenerateAsync(
            attempt,
            attempt.ExamSessionId,
            paper.Snapshot,
            scoreResults,
            now,
            cancellationToken);
        await _reviewTaskRepository.AddRangeAsync(reviewTasks, cancellationToken);

        if (attempt.ExamSessionId is { } sessionId)
        {
            var participant = await _participants.GetAsync(sessionId, attempt.UserId, cancellationToken);
            if (participant is not null)
            {
                participant.MarkSubmitted(now);
                _participants.Update(participant);
            }
        }

        await _audit.RecordAsync(
            "attempt.submit",
            "attempt",
            attempt.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["sessionId"] = attempt.ExamSessionId,
                ["submitReason"] = reason.ToStorage(),
                ["durationSpentSeconds"] = attempt.DurationSpentSeconds,
            },
            cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 成绩没发布之前，主观题的部分不露出去。
        var pending = AttemptScoreSummaryFactory.IsSubjectivePending(scoreResults);
        var visibility = await _visibility.ResolveAsync(
            attempt.ExamSessionId,
            attempt.Id,
            pending,
            cancellationToken);

        return BuildResponse(attempt, scoreResults, visibility);
    }

    private async Task<SubmitAttemptResponse> BuildResponseAsync(
        Attempt attempt,
        CancellationToken cancellationToken)
    {
        var results = await _scoreResults.ListByAttemptAsync(attempt.Id, cancellationToken);

        // 成绩没发布之前，主观题的部分不露出去。
        var pending = AttemptScoreSummaryFactory.IsSubjectivePending(results);
        var visibility = await _visibility.ResolveAsync(
            attempt.ExamSessionId,
            attempt.Id,
            pending,
            cancellationToken);

        return BuildResponse(attempt, results, visibility);
    }

    private static SubmitAttemptResponse BuildResponse(
        Attempt attempt,
        IReadOnlyList<Domain.Grading.ScoreResult> results,
        string visibility)
    {
        var summary = AttemptScoreSummaryFactory.Build(results, visibility);

        return new SubmitAttemptResponse(
            attempt.Id,
            attempt.Status.ToStorage(),
            attempt.Status.Label(),
            attempt.SubmittedAt,
            attempt.SubmitReason?.ToStorage() ?? "manual",
            attempt.SubmitReason?.Label() ?? "主动交卷",
            summary.ObjectiveScore,
            summary.ObjectiveMax,
            summary.SubjectivePending,
            summary.TotalScore,
            summary.TotalMax,
            summary.GradeVisibility);
    }
}
