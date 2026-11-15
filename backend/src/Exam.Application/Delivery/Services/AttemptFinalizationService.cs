using Exam.Application.Common.Interfaces;
using Exam.Application.Grading.Services;
using Exam.Domain.Delivery;
using Exam.Domain.Grading;

namespace Exam.Application.Delivery.Services;

/// <summary>
/// 交卷收尾：判分、生成阅卷任务、标记考生已交卷、留审计。
/// <para>
/// 一共有四条交卷路径：主动交卷、切屏超限强制交卷、心跳超时代交、监考强制交卷。
/// 四条路径都必须走这里——漏掉任何一条，被强制交卷的考生就永远没有成绩：
/// 答案明明已经存下来了，却既没有分数，也没有待阅任务，
/// 事后谁也说不清这场考试到底考了多分。
/// </para>
/// </summary>
public sealed class AttemptFinalizationService
{
    private readonly IScoreResultRepository _scoreResults;
    private readonly IReviewTaskRepository _reviewTaskRepository;
    private readonly IExamParticipantRepository _participants;
    private readonly AttemptScoringService _scoring;
    private readonly ReviewTaskGenerator _reviewTasks;
    private readonly IAuditRecorder _audit;

    public AttemptFinalizationService(
        IScoreResultRepository scoreResults,
        IReviewTaskRepository reviewTaskRepository,
        IExamParticipantRepository participants,
        AttemptScoringService scoring,
        ReviewTaskGenerator reviewTasks,
        IAuditRecorder audit)
    {
        _scoreResults = scoreResults;
        _reviewTaskRepository = reviewTaskRepository;
        _participants = participants;
        _scoring = scoring;
        _reviewTasks = reviewTasks;
        _audit = audit;
    }

    /// <summary>
    /// 交卷收尾。调用方负责先把会话推进到已交卷状态，再调这里。
    /// </summary>
    /// <param name="paper">本次作答的卷面（快照 + 题位）。</param>
    /// <param name="auditAction">
    /// 审计动作名。四条路径写不同的动作，事后能一眼看出这次交卷是被谁、因为什么触发的。
    /// </param>
    public async Task<IReadOnlyList<ScoreResult>> FinalizeAsync(
        Attempt attempt,
        AttemptPaperContext paper,
        DateTimeOffset now,
        string auditAction,
        CancellationToken cancellationToken)
    {
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
            auditAction,
            "attempt",
            attempt.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["sessionId"] = attempt.ExamSessionId,
                ["submitReason"] = attempt.SubmitReason?.ToStorage(),
                ["durationSpentSeconds"] = attempt.DurationSpentSeconds,
            },
            cancellationToken);

        return scoreResults;
    }
}
