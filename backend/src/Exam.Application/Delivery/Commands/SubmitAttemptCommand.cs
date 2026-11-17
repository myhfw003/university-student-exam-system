using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
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
    private readonly AttemptPaperResolver _resolver;
    private readonly AttemptFinalizationService _finalization;
    private readonly Exam.Application.Grading.Services.GradeVisibilityResolver _visibility;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ExamAccessScope _scope;
    private readonly ICurrentUser _currentUser;
    private readonly Exam.Application.Learning.Services.PracticeRulesResolver _practiceRules;

    public SubmitAttemptHandler(
        IAttemptRepository attempts,
        IAnswerRepository answers,
        IScoreResultRepository scoreResults,
        AttemptPaperResolver resolver,
        AttemptFinalizationService finalization,
        Exam.Application.Grading.Services.GradeVisibilityResolver visibility,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser,
        Exam.Application.Learning.Services.PracticeRulesResolver practiceRules,
        ExamAccessScope scope)
    {
        _scope = scope;
        _attempts = attempts;
        _answers = answers;
        _scoreResults = scoreResults;
        _resolver = resolver;
        _finalization = finalization;
        _visibility = visibility;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
        _practiceRules = practiceRules;
    }

    public async Task<SubmitAttemptResponse> Handle(
        SubmitAttemptCommand request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        await _scope.EnsureAttemptVisibleAsync(attempt, cancellationToken);

        // 考试走场次快照；练习走练习开放单挂的试卷。
        var paper = await _resolver.ResolveAsync(attempt, cancellationToken);

        var now = _clock.UtcNow;

        // 幂等：已交卷直接返回同一个结果，不再推进状态。
        if (attempt.IsSubmitted)
        {
            return await BuildResponseAsync(attempt, cancellationToken);
        }

        // 练习次数用尽：这次提交不算数。
        if (attempt.TargetType == AttemptTargetType.Practice)
        {
            var rules = await _practiceRules.ResolveAsync(attempt.PracticeAssignmentId!.Value, cancellationToken);
            if (rules.MaxAttempts > 0 && attempt.AttemptNo > rules.MaxAttempts)
            {
                throw new BusinessRuleException($"练习次数已用完（最多 {rules.MaxAttempts} 次），本次提交不计。");
            }
        }

        // 交卷原因由服务端判定：超时就是 time_up，客户端说什么不算数。
        // 练习不计时，不会因为超时被当成 time_up。
        var reason = attempt.IsTimed && now > attempt.DeadlineAt ? SubmitReason.TimeUp : SubmitReason.Manual;

        attempt.Submit(reason, now);
        _attempts.Update(attempt);

        // 交卷收尾：判分、待阅任务、考生已交卷标记、审计。
        // 强制交卷的三条路径也走同一个服务——漏一条，被强制交卷的考生就没有成绩。
        var scoreResults = await _finalization.FinalizeAsync(
            attempt,
            paper,
            now,
            "attempt.submit",
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
