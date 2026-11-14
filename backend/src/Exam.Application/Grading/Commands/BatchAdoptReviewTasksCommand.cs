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
/// 批量采纳初判建议：一次性把待阅卷宗的系统建议分定成最终分。
/// <para>
/// 只动 <c>pending</c> 的任务；已经领走或阅完的照旧不动，逐条说清楚为什么跳过。
/// </para>
/// </summary>
public sealed record BatchAdoptReviewTasksCommand(
    IReadOnlyList<long>? TaskIds,
    long? ExamSessionId,
    long? QuestionId,
    int? MaxCount,
    string? Comment,
    bool Confirm)
    : IAppCommand<BatchAdoptResponse>, IAuthorizableRequest
{
    /// <summary>单次批量采纳的上限。</summary>
    public const int HardLimit = 500;

    /// <summary>不指定时的默认上限。</summary>
    public const int DefaultMaxCount = 200;

    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ReviewBatchAdopt];
}

public sealed class BatchAdoptReviewTasksCommandValidator : AbstractValidator<BatchAdoptReviewTasksCommand>
{
    public BatchAdoptReviewTasksCommandValidator()
    {
        // 批量定分不可逆：客户端先做二次确认，服务端也要看到确认的意思。
        RuleFor(x => x.Confirm)
            .Must(c => c)
            .WithMessage("批量采纳会一次性定分，确认无误后再提交。");

        RuleFor(x => x.TaskIds)
            .Must(ids => ids is null || (ids.Count > 0 && ids.Count <= BatchAdoptReviewTasksCommand.HardLimit))
            .WithMessage($"一次最多批量采纳 {BatchAdoptReviewTasksCommand.HardLimit} 份，超出的请分批处理。");

        RuleFor(x => x.TaskIds!)
            .Must(ids => ids is null || ids.All(id => id > 0))
            .WithMessage("阅卷任务 ID 不合法。")
            .When(x => x.TaskIds is not null);

        RuleFor(x => x.ExamSessionId)
            .Must(id => id is null || id > 0)
            .WithMessage("考试场次 ID 不合法。")
            .When(x => x.ExamSessionId is not null);

        RuleFor(x => x.QuestionId)
            .Must(id => id is null || id > 0)
            .WithMessage("题目 ID 不合法。")
            .When(x => x.QuestionId is not null);

        RuleFor(x => x.MaxCount)
            .InclusiveBetween(1, BatchAdoptReviewTasksCommand.HardLimit)
            .WithMessage($"单次批量上限必须在 1 到 {BatchAdoptReviewTasksCommand.HardLimit} 之间。")
            .When(x => x.MaxCount.HasValue);

        RuleFor(x => x.Comment).MaximumLength(2000).WithMessage("评语不能超过 2000 字。");

        // 总得有个范围：要么点名任务，要么点名场次。
        RuleFor(x => x)
            .Must(c => c.TaskIds is { Count: > 0 } || c.ExamSessionId is not null)
            .WithMessage("请指定要批量采纳的任务（taskIds）或考试场次（examSessionId）。");

        // 两个都给就得说清楚按哪个来，不许含糊。
        RuleFor(x => x)
            .Must(c => !(c.TaskIds is { Count: > 0 } && c.ExamSessionId is not null))
            .WithMessage("任务（taskIds）与考试场次（examSessionId）只能给一个。");
    }
}

public sealed class BatchAdoptReviewTasksHandler
    : IRequestHandler<BatchAdoptReviewTasksCommand, BatchAdoptResponse>
{
    private readonly IReviewTaskRepository _tasks;
    private readonly IScoreResultRepository _scoreResults;
    private readonly IGradeRevisionRepository _revisions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public BatchAdoptReviewTasksHandler(
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

    public async Task<BatchAdoptResponse> Handle(
        BatchAdoptReviewTasksCommand request,
        CancellationToken cancellationToken)
    {
        var operatorId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var now = _clock.UtcNow;
        var limit = Math.Clamp(
            request.MaxCount ?? BatchAdoptReviewTasksCommand.DefaultMaxCount,
            1,
            BatchAdoptReviewTasksCommand.HardLimit);
        var comment = string.IsNullOrWhiteSpace(request.Comment)
            ? "系统初判，已批量采纳"
            : request.Comment.Trim();

        var items = new List<BatchAdoptItemDto>();
        var selected = new List<ReviewTask>();

        if (request.TaskIds is { Count: > 0 })
        {
            var found = await _tasks.GetByIdsAsync(request.TaskIds, cancellationToken);
            var foundIds = found.Select(t => t.Id).ToHashSet();

            // 点名的任务里如果有找不着的，也要在逐条结果里说清楚。
            foreach (var id in request.TaskIds.Where(id => !foundIds.Contains(id)))
            {
                items.Add(Skipped(id, "阅卷任务不存在。"));
            }

            selected = found.OrderBy(t => t.Id).ToList();

            if (selected.Count > limit)
            {
                throw new BusinessRuleException($"一次最多批量采纳 {limit} 份，超出的请分批处理。");
            }
        }
        else
        {
            var sessionId = request.ExamSessionId!.Value;
            var criteria = new ReviewTaskSearchCriteria
            {
                Status = ReviewTaskStatus.Pending,
                ExamSessionId = sessionId,
                QuestionId = request.QuestionId,
            };

            // 多取一条用来判断有没有超量。
            var found = await _tasks.SearchAsync(criteria, 0, limit + 1, cancellationToken);
            if (found.Count > limit)
            {
                throw new BusinessRuleException($"一次最多批量采纳 {limit} 份，超出的请分批处理。");
            }

            selected = found.ToList();
        }

        var adopted = new List<ReviewTask>();

        foreach (var task in selected)
        {
            // 只影响待领取的任务：已经领走或阅完的照旧不动。
            if (task.Status != ReviewTaskStatus.Pending)
            {
                items.Add(Skipped(task.Id, "任务已不在待领取状态。"));
                continue;
            }

            if (task.AssigneeId is { } assignee && assignee != operatorId)
            {
                items.Add(Skipped(task.Id, "任务已指派给其他阅卷人。"));
                continue;
            }

            if (task.SuggestedScore is null)
            {
                items.Add(Skipped(task.Id, "这份作答没有系统建议分，无法采纳。"));
                continue;
            }

            // 批量采纳也是阅卷：先领再定分。
            task.Claim(operatorId, now);
            task.AdoptSuggestion(operatorId, comment, now);
            _tasks.Update(task);

            adopted.Add(task);
            items.Add(new BatchAdoptItemDto(
                task.Id,
                "adopted",
                "已采纳",
                task.FinalScore!.Value,
                null));
        }

        await UpdateScoreResultsAsync(adopted, comment, operatorId, now, cancellationToken);

        var adoptedCount = adopted.Count;
        var skippedCount = items.Count - adoptedCount;

        await _audit.RecordAsync(
            "review_task.batch_adopt",
            "review_task",
            request.ExamSessionId?.ToString(),
            new Dictionary<string, object?>
            {
                ["examSessionId"] = request.ExamSessionId,
                ["questionId"] = request.QuestionId,
                ["requestedCount"] = request.TaskIds?.Count ?? selected.Count,
                ["total"] = items.Count,
                ["adopted"] = adoptedCount,
                ["skipped"] = skippedCount,
                ["operatorId"] = operatorId,
            },
            cancellationToken);

        return new BatchAdoptResponse(items.Count, adoptedCount, skippedCount, items);
    }

    /// <summary>
    /// 把采纳的分数写回评分结果，并给每道题留一条改分流水。
    /// <para>
    /// 综合题按步骤拆分：一步采纳只更新整题总分，全部步骤采纳完才定分。
    /// </para>
    /// </summary>
    private async Task UpdateScoreResultsAsync(
        IReadOnlyList<ReviewTask> adopted,
        string comment,
        long operatorId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (adopted.Count == 0)
        {
            return;
        }

        var attemptIds = adopted.Select(t => t.AttemptId).Distinct().ToList();
        var questionIds = adopted.Select(t => t.QuestionId).Distinct().ToList();

        var siblings = await _tasks.ListByAttemptQuestionsAsync(attemptIds, questionIds, cancellationToken);
        var adoptedById = adopted.ToDictionary(t => t.Id);

        // 同一道题只写一次评分结果、只留一条流水。
        foreach (var group in adopted.GroupBy(t => (t.AttemptId, t.QuestionId)))
        {
            var result = await _scoreResults.GetAsync(group.Key.AttemptId, group.Key.QuestionId, cancellationToken)
                ?? throw new BusinessRuleException("找不到对应的评分结果，无法记录改分流水。");

            var previousScore = result.Score.Value;

            var effective = siblings
                .Select(t => adoptedById.TryGetValue(t.Id, out var updated) ? updated : t)
                .Where(t => t.AttemptId == group.Key.AttemptId && t.QuestionId == group.Key.QuestionId)
                .ToList();

            var total = effective.Sum(t => (t.FinalScore ?? t.SuggestedScore ?? Score.Zero).Value);
            var allReviewed = effective.All(t => t.Status == ReviewTaskStatus.Reviewed);

            if (allReviewed)
            {
                result.ApplyManualScore(total, operatorId, now);
            }
            else
            {
                result.ApplyPartialManualScore(total, operatorId, now);
            }

            _scoreResults.Update(result);

            await _revisions.AddAsync(
                GradeRevision.Create(result.Id, previousScore, total, comment, operatorId, now),
                cancellationToken);
        }
    }

    private static BatchAdoptItemDto Skipped(long taskId, string message) =>
        new(taskId, "skipped", "已跳过", null, message);
}
