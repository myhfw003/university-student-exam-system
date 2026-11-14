using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Grading;

namespace Exam.Application.Grading.Services;

/// <summary>
/// 阅卷任务生成（应用层服务）。
/// <para>
/// 主观题交卷后生成待阅任务：综合题按步骤拆开，一步一条；
/// 简答题整题一条。客观题不生成任务——它们已经自动定分。
/// </para>
/// </summary>
public sealed class ReviewTaskGenerator
{
    private readonly IAnswerRepository _answers;

    public ReviewTaskGenerator(IAnswerRepository answers)
    {
        _answers = answers;
    }

    public async Task<IReadOnlyList<ReviewTask>> GenerateAsync(
        Attempt attempt,
        long? examSessionId,
        PaperSnapshot snapshot,
        IReadOnlyList<ScoreResult> scoreResults,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        // 只有主观题（建议分 / 待阅）需要人工处理。
        var subjective = scoreResults
            .Where(r => r.Method == ScoringMethod.AutoSuggested || r.Status == ScoringStatus.Pending)
            .ToList();

        if (subjective.Count == 0)
        {
            return [];
        }

        var answers = await _answers.ListByAttemptAsync(attempt.Id, cancellationToken);
        var answerByQuestion = answers.ToDictionary(a => a.QuestionId);
        var tasks = new List<ReviewTask>();

        foreach (var result in subjective)
        {
            var item = snapshot.Items.FirstOrDefault(i => i.QuestionId == result.QuestionId);
            if (item is null)
            {
                continue;
            }

            var type = QuestionTypes.FromStorage(item.QuestionType) ?? QuestionType.Short;
            var payload = answerByQuestion.TryGetValue(result.QuestionId, out var answer)
                ? answer.Payload
                : AnswerPayload.Empty();

            // 完全没作答的题不用人工看：得分就是 0，没有可阅的内容。
            if (payload.IsEmpty)
            {
                continue;
            }

            if (type == QuestionType.Comprehensive && item.Steps.Count > 0)
            {
                tasks.AddRange(SplitByStep(attempt, examSessionId, result, item, payload, now));
                continue;
            }

            var text = string.IsNullOrWhiteSpace(payload.Text)
                ? string.Join("\n", payload.Steps.Select(s => s.Text))
                : payload.Text!;

            tasks.Add(ReviewTask.Create(
                attempt.Id,
                examSessionId,
                result.QuestionId,
                null,
                text,
                result.Score,
                result.MaxScore,
                now));
        }

        return tasks;
    }

    /// <summary>综合题按步骤拆成多条任务。</summary>
    private static IEnumerable<ReviewTask> SplitByStep(
        Attempt attempt,
        long? examSessionId,
        ScoreResult result,
        SnapshotItem item,
        AnswerPayload payload,
        DateTimeOffset now)
    {
        var totalStepScore = item.Steps.Sum(s => s.Score);

        foreach (var step in item.Steps)
        {
            var text = payload.Steps
                .FirstOrDefault(s => string.Equals(s.Code, step.Code, StringComparison.Ordinal))?.Text
                ?? payload.Text
                ?? string.Empty;

            // 建议分按步骤分占比拆分。
            var proportion = totalStepScore <= 0m ? 0m : step.Score / totalStepScore;
            var suggested = RoundToStep(result.Score.Value * proportion);
            var maxScore = Score.Paper(step.Score);

            yield return ReviewTask.Create(
                attempt.Id,
                examSessionId,
                result.QuestionId,
                step.Code,
                text,
                Score.Graded(Math.Min(suggested, maxScore.Value), maxScore.Value),
                maxScore,
                now);
        }
    }

    private static decimal RoundToStep(decimal value) =>
        Math.Round(value / Score.GradingStep, MidpointRounding.AwayFromZero) * Score.GradingStep;
}
