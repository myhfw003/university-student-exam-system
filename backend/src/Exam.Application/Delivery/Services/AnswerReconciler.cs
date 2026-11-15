using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Domain.SharedKernel.Abstractions;

namespace Exam.Application.Delivery.Services;

/// <summary>一处对不上的地方。</summary>
public sealed record ReconciliationFinding(
    long AttemptId,
    long? ExamSessionId,
    string Kind,
    string Detail);

/// <summary>一次对账的结果。</summary>
public sealed record ReconciliationReport(
    int CheckedAttempts,
    IReadOnlyList<ReconciliationFinding> Findings,
    DateTimeOffset StartedAt,
    DateTimeOffset FinishedAt)
{
    /// <summary>发现的问题数。</summary>
    public int FindingCount => Findings.Count;

    /// <summary>对账是否通过。</summary>
    public bool IsClean => Findings.Count == 0;
}

/// <summary>
/// 答卷对账。
/// <para>
/// 压测不能只看 HTTP 成功率，必须**端到端核对**：客户端每批保存都带一个递增的
/// <c>clientSeq</c>，服务端收到就推进会话上的最大序列号。
/// 如果会话上的最大序列号比库里落库的最大序列号还大，就说明**有一批答案没落库**。
/// </para>
/// <para>同一套逻辑既在压测后跑，也在生产里当每日作业跑。</para>
/// </summary>
public sealed class AnswerReconciler
{
    /// <summary>序列号缺口：会话记下了这一批，库里却没有。</summary>
    public const string KindSequenceGap = "sequence_gap";

    /// <summary>交卷后缺少评分结果。</summary>
    public const string KindMissingScore = "missing_score";

    private readonly IAttemptRepository _attempts;
    private readonly IAnswerRepository _answers;
    private readonly IScoreResultRepository _scoreResults;
    private readonly AttemptPaperResolver _resolver;
    private readonly IClock _clock;

    public AnswerReconciler(
        IAttemptRepository attempts,
        IAnswerRepository answers,
        IScoreResultRepository scoreResults,
        AttemptPaperResolver resolver,
        IClock clock)
    {
        _attempts = attempts;
        _answers = answers;
        _scoreResults = scoreResults;
        _resolver = resolver;
        _clock = clock;
    }

    /// <summary>对账某个时间窗内已交卷的作答。</summary>
    public async Task<ReconciliationReport> ReconcileAsync(
        DateTimeOffset since,
        int take = 5000,
        CancellationToken cancellationToken = default)
    {
        var startedAt = _clock.UtcNow;

        var attempts = await _attempts.ListSubmittedSinceAsync(since, take, cancellationToken);
        if (attempts.Count == 0)
        {
            return new ReconciliationReport(0, [], startedAt, _clock.UtcNow);
        }

        var attemptIds = attempts.Select(a => a.Id).ToList();

        var answers = await _answers.ListSeqByAttemptsAsync(attemptIds, cancellationToken);
        var maxSeqByAttempt = answers
            .GroupBy(a => a.AttemptId)
            .ToDictionary(g => g.Key, g => g.Max(a => a.ClientSeq));

        var results = await _scoreResults.ListByAttemptsAsync(attemptIds, cancellationToken);
        var resultCountByAttempt = results
            .GroupBy(r => r.AttemptId)
            .ToDictionary(g => g.Key, g => g.Count());

        // 同一场考试共用一份卷面：卷面题目数只解析一次。
        var expectedQuestionCounts = new Dictionary<long, int>();
        var findings = new List<ReconciliationFinding>();

        foreach (var attempt in attempts)
        {
            // 序列号缺口：会话说收到了，库里却没有。
            var maxStored = maxSeqByAttempt.GetValueOrDefault(attempt.Id);
            if (attempt.LastClientSeq > 0 && maxStored < attempt.LastClientSeq)
            {
                findings.Add(new ReconciliationFinding(
                    attempt.Id,
                    attempt.ExamSessionId,
                    KindSequenceGap,
                    $"会话已收序列号 {attempt.LastClientSeq}，库里最大只到 {maxStored}：有一批答案没落库。"));
            }

            // 交卷后每道题都该有评分结果。
            var expected = await GetExpectedQuestionCountAsync(attempt, expectedQuestionCounts, cancellationToken);
            if (expected is null)
            {
                continue;
            }

            var actual = resultCountByAttempt.GetValueOrDefault(attempt.Id);
            if (actual < expected.Value)
            {
                findings.Add(new ReconciliationFinding(
                    attempt.Id,
                    attempt.ExamSessionId,
                    KindMissingScore,
                    $"卷面 {expected.Value} 道题，只落库 {actual} 条评分结果。"));
            }
        }

        return new ReconciliationReport(attempts.Count, findings, startedAt, _clock.UtcNow);
    }

    /// <summary>这场作答对应的卷面题目数。</summary>
    private async Task<int?> GetExpectedQuestionCountAsync(
        Attempt attempt,
        IDictionary<long, int> cache,
        CancellationToken cancellationToken)
    {
        // 练习按开放单分组，考试按场次分组：同一份卷面只解析一次。
        var key = attempt.ExamSessionId ?? attempt.PracticeAssignmentId ?? 0L;
        if (key == 0L)
        {
            return null;
        }

        if (cache.TryGetValue(key, out var cached))
        {
            return cached;
        }

        try
        {
            var paper = await _resolver.ResolveAsync(attempt, cancellationToken);
            var count = paper.Snapshot.Items.Count;
            cache[key] = count;
            return count;
        }
        catch (Exception)
        {
            // 卷面解析不出来（比如练习试卷被删了）不算丢答，跳过。
            return null;
        }
    }
}
