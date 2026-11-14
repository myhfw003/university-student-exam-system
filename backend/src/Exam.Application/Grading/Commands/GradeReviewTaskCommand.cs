using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Grading.Contracts;
using Exam.Domain.Catalog;
using Exam.Domain.Grading;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Grading.Commands;

/// <summary>
/// 人工评分。分数 0..满分、0.5 为步进；每次评分都留一条改分流水。
/// <para>
/// 重复提交同一条任务是幂等更新：分数照旧写，流水照旧追加一条。
/// </para>
/// </summary>
public sealed record GradeReviewTaskCommand(long TaskId, decimal Score, string? Comment)
    : IAppCommand<GradeReviewTaskResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ReviewGrade];
}

public sealed class GradeReviewTaskCommandValidator : AbstractValidator<GradeReviewTaskCommand>
{
    public GradeReviewTaskCommandValidator()
    {
        RuleFor(x => x.TaskId).GreaterThan(0).WithMessage("阅卷任务 ID 不合法。");
        RuleFor(x => x.Comment).MaximumLength(2000).WithMessage("评语不能超过 2000 字。");

        // 分数本身不在这里判：满分是任务上的数，只有领域层知道。
        // 分数的问题一律由领域规则拒绝（422），前端只需要认一种错误。
    }
}

public sealed class GradeReviewTaskHandler : IRequestHandler<GradeReviewTaskCommand, GradeReviewTaskResponse>
{
    private readonly IReviewTaskRepository _tasks;
    private readonly IScoreResultRepository _scoreResults;
    private readonly IGradeRevisionRepository _revisions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public GradeReviewTaskHandler(
        IReviewTaskRepository tasks,
        IScoreResultRepository scoreResults,
        IGradeRevisionRepository revisions,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _tasks = tasks;
        _scoreResults = scoreResults;
        _revisions = revisions;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<GradeReviewTaskResponse> Handle(
        GradeReviewTaskCommand request,
        CancellationToken cancellationToken)
    {
        var task = await _tasks.GetByIdAsync(request.TaskId, cancellationToken)
            ?? throw new NotFoundException("阅卷任务不存在。");

        var reviewerId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        // 别人正在阅的卷子不能抢；已阅完的允许改分——改分留痕，学生看得见。
        task.EnsureCanGrade(reviewerId);

        var now = _clock.UtcNow;

        // 直接给待领取的卷子评分，等于先领再评。
        if (task.Status == ReviewTaskStatus.Pending)
        {
            task.Claim(reviewerId, now);
        }

        // 0..满分、0.5 步进：交给值对象一次性守住。
        var score = Score.Graded(request.Score, task.MaxScore.Value);

        task.Grade(score, request.Comment, reviewerId, now);
        _tasks.Update(task);

        var result = await _scoreResults.GetAsync(task.AttemptId, task.QuestionId, cancellationToken)
            ?? throw new BusinessRuleException("找不到对应的评分结果，无法记录改分流水。");

        var previousScore = result.Score.Value;

        // 综合题按步骤拆开阅：这一步的得分要并进整题总分。
        var siblings = await _tasks.ListByAttemptQuestionAsync(
            task.AttemptId,
            task.QuestionId,
            cancellationToken);

        var effective = siblings
            .Select(t => t.Id == task.Id ? task : t)
            .ToList();

        var total = effective.Sum(t => (t.FinalScore ?? t.SuggestedScore ?? Score.Zero).Value);
        var allReviewed = effective.All(t => t.Status == ReviewTaskStatus.Reviewed);

        if (allReviewed)
        {
            result.ApplyManualScore(total, reviewerId, now);
        }
        else
        {
            // 还有步骤没评完：只更新当前总分，不定分。
            result.ApplyPartialManualScore(total, reviewerId, now);
        }

        _scoreResults.Update(result);

        // 改分流水：只追加。每一次评分 / 改分都留痕。
        // 流水是这一笔的第几条：已落库的条数 + 眼下这一条。
        var revision = await _revisions.CountByScoreResultAsync(result.Id, cancellationToken) + 1;

        await _revisions.AddAsync(
            GradeRevision.Create(result.Id, previousScore, total, request.Comment, reviewerId, now),
            cancellationToken);

        await _audit.RecordAsync(
            "review_task.grade",
            "review_task",
            task.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["attemptId"] = task.AttemptId,
                ["questionId"] = task.QuestionId,
                ["stepCode"] = task.StepCode,
                ["reviewerId"] = reviewerId,
                ["score"] = score.Value,
                ["maxScore"] = task.MaxScore.Value,
                ["previousScore"] = previousScore,
                ["newScore"] = total,
                ["scoreResultStatus"] = result.Status.ToStorage(),
                ["revision"] = revision,
            },
            cancellationToken);

        return new GradeReviewTaskResponse(
            task.Id,
            task.Status.ToStorage(),
            task.Status.Label(),
            task.FinalScore!.Value,
            task.MaxScore.Value,
            task.Comment,
            result.Status.ToStorage(),
            result.Status.Label(),
            revision);
    }
}
