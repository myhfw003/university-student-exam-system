using Exam.Application.Common.Interfaces;
using Exam.Application.Grading.Contracts;
using Exam.Domain.Catalog;
using Exam.Domain.Grading;

namespace Exam.Application.Grading.Services;

/// <summary>
/// 阅卷任务 DTO 组装。
/// <para>
/// 队列、领取、指派共用同一套装配逻辑，字段口径才不会漂。
/// </para>
/// </summary>
public static class ReviewTaskDtoMapper
{
    public static async Task<IReadOnlyList<ReviewTaskDto>> MapAsync(
        IReadOnlyList<ReviewTask> tasks,
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        IQuestionRepository questions,
        CancellationToken cancellationToken = default)
    {
        if (tasks.Count == 0)
        {
            return [];
        }

        var loadedAttempts = await attempts.GetByIdsAsync(
            tasks.Select(t => t.AttemptId).Distinct().ToList(),
            cancellationToken);
        var attemptById = loadedAttempts.ToDictionary(a => a.Id);

        var sessionIds = loadedAttempts
            .Select(a => a.ExamSessionId)
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();
        var loadedSessions = sessionIds.Count == 0
            ? []
            : await sessions.GetByIdsAsync(sessionIds, cancellationToken);
        var sessionNames = loadedSessions.ToDictionary(s => s.Id, s => s.Name);

        var loadedQuestions = await questions.GetByIdsAsync(
            tasks.Select(t => t.QuestionId).Distinct().ToList(),
            cancellationToken);
        var questionById = loadedQuestions.ToDictionary(q => q.Id);

        return tasks.Select(task =>
        {
            var attempt = attemptById.GetValueOrDefault(task.AttemptId);
            var question = questionById.GetValueOrDefault(task.QuestionId);

            return new ReviewTaskDto(
                task.Id,
                task.AttemptId,
                attempt?.AttemptNo ?? 1,
                attempt?.ExamSessionId is { } sessionId
                    ? sessionNames.GetValueOrDefault(sessionId, string.Empty)
                    : string.Empty,
                task.ExamSessionId,
                task.QuestionId,
                question?.Code ?? string.Empty,
                question?.Type.ToStorage() ?? string.Empty,
                task.StepCode,
                task.AnswerText,
                task.SuggestedScore?.Value,
                task.MaxScore.Value,
                task.Status.ToStorage(),
                task.Status.Label(),
                task.AssigneeId,
                task.ReviewerId,
                task.FinalScore?.Value,
                task.Comment,
                task.CreatedAt,
                task.ReviewedAt);
        }).ToList();
    }
}
