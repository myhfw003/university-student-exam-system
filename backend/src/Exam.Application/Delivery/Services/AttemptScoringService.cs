using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Grading;

namespace Exam.Application.Delivery.Services;

/// <summary>一道题的判分结果（不落库）。</summary>
public sealed record ScoredQuestion(long QuestionId, ScoringOutcome Outcome);

/// <summary>
/// 交卷判分（应用层服务）。
/// <para>
/// 判分只认「已发布的快照」：卷面上是什么，就按什么判。
/// 客观题直接定分，主观题给建议分，等人工确认。
/// </para>
/// </summary>
public sealed class AttemptScoringService
{
    private readonly IPaperSnapshotRepository _snapshots;
    private readonly IAnswerRepository _answers;

    public AttemptScoringService(IPaperSnapshotRepository snapshots, IAnswerRepository answers)
    {
        _snapshots = snapshots;
        _answers = answers;
    }

    /// <summary>对一次作答判分，返回每道题的评分结果。</summary>
    public async Task<IReadOnlyList<ScoreResult>> ScoreAsync(
        Attempt attempt,
        PaperSnapshot snapshot,
        IReadOnlyList<PaperItem>? paperItems,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var scored = await PreviewAsync(attempt, snapshot, paperItems, cancellationToken);
        var paperItemByQuestion = paperItems?.ToDictionary(i => i.QuestionId) ?? [];

        var results = new List<ScoreResult>();

        foreach (var item in scored)
        {
            paperItemByQuestion.TryGetValue(item.QuestionId, out var sourceItem);

            results.Add(ScoreResult.FromOutcome(
                attempt.Id,
                item.QuestionId,
                sourceItem?.Id,
                item.Outcome,
                now));
        }

        return results;
    }

    /// <summary>
    /// 判分预览：**不落库**，只返回判分结果。
    /// <para>练习的即时反馈用它——看一眼对错，不产生任何评分记录。</para>
    /// </summary>
    public async Task<IReadOnlyList<ScoredQuestion>> PreviewAsync(
        Attempt attempt,
        PaperSnapshot snapshot,
        IReadOnlyList<PaperItem>? paperItems,
        CancellationToken cancellationToken = default)
    {
        var answers = await _answers.ListByAttemptAsync(attempt.Id, cancellationToken);
        var answerByQuestion = answers.ToDictionary(a => a.QuestionId);
        var paperItemByQuestion = paperItems?.ToDictionary(i => i.QuestionId) ?? [];

        var results = new List<ScoredQuestion>();

        foreach (var item in snapshot.Items)
        {
            var type = QuestionTypes.FromStorage(item.QuestionType) ?? QuestionType.Single;
            var strategy = ScoringStrategies.For(type);

            var payload = answerByQuestion.TryGetValue(item.QuestionId, out var answer)
                ? answer.Payload
                : AnswerPayload.Empty();

            // 题位分值以快照为准，构造一个只在判分中使用的题位视图。
            var paperItem = PaperItem.Create(item.QuestionId, item.Score, item.SortOrder);
            var outcome = strategy.Score(payload, paperItem, item);

            results.Add(new ScoredQuestion(item.QuestionId, outcome));
        }

        return results;
    }
}
