using Exam.Domain.Catalog;
using Exam.Domain.Grading;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Grading;

/// <summary>
/// 人工评分与改分留痕的规则。
/// <para>
/// 分数必须落在 0..满分之间，且以 0.5 为步进；
/// 别人正在阅的卷子不能抢，已阅完的卷子可以改分——但每一笔都留痕。
/// </para>
/// </summary>
public sealed class GradeReviewTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    private static ReviewTask PendingTask(long? assigneeId = null)
    {
        var task = ReviewTask.Create(
            attemptId: 1,
            examSessionId: 1,
            questionId: 2,
            stepCode: null,
            answerText: "作答",
            suggestedScore: Score.Graded(5m, 10m),
            maxScore: Score.Paper(10m),
            now: Now);

        if (assigneeId is { } assignee)
        {
            task.Assign(assignee, actorId: 99, now: Now);
        }

        return task;
    }

    private static ScoreResult Result(decimal score = 5m, decimal max = 10m) =>
        ScoreResult.FromOutcome(
            attemptId: 1,
            questionId: 2,
            paperItemId: 3,
            outcome: new ScoringOutcome(
                score,
                max,
                ScoringMethod.AutoSuggested,
                ScoringStatus.Suggested,
                []),
            now: Now);

    [Fact]
    public void 人工评分后状态为已定分()
    {
        var result = Result();

        result.ApplyManualScore(7.5m, reviewerId: 7, now: Now);

        result.Score.Value.ShouldBe(7.5m);
        result.Status.ShouldBe(ScoringStatus.Final);
        result.Method.ShouldBe(ScoringMethod.ManualScored);
        result.ScoredBy.ShouldBe(7);
    }

    [Fact]
    public void 部分评分只更新总分不定分()
    {
        var result = Result();

        // 综合题按步骤拆开阅：一步评完还不算定分。
        result.ApplyPartialManualScore(6m, reviewerId: 7, now: Now);

        result.Score.Value.ShouldBe(6m);
        result.Status.ShouldBe(ScoringStatus.Suggested);
        result.Method.ShouldBe(ScoringMethod.ManualScored);
    }

    [Fact]
    public void 分数超过满分被拒绝()
    {
        var result = Result();

        var act = () => result.ApplyManualScore(10.5m, reviewerId: 7, now: Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 分数不为零点五步进被拒绝()
    {
        var result = Result();

        var act = () => result.ApplyManualScore(7.3m, reviewerId: 7, now: Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 负分被拒绝()
    {
        var result = Result();

        var act = () => result.ApplyManualScore(-1m, reviewerId: 7, now: Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 别人正在阅的卷子不能评分()
    {
        var task = PendingTask();
        task.Claim(reviewerId: 7, now: Now);

        var act = () => task.EnsureCanGrade(8);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 指派给别人的卷子不能评分()
    {
        var task = PendingTask(assigneeId: 7);

        var act = () => task.EnsureCanGrade(8);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 已阅完的卷子允许改分()
    {
        var task = PendingTask();
        task.Claim(reviewerId: 7, now: Now);
        task.Grade(Score.Graded(7.5m, 10m), "评语", reviewerId: 7, now: Now);

        // 改分是允许的——留痕的事由流水与审计日志负责。
        Should.NotThrow(() => task.EnsureCanGrade(8));

        task.Grade(Score.Graded(9m, 10m), "复核后调整", reviewerId: 8, now: Now);
        task.FinalScore!.Value.ShouldBe(9m);
        task.Comment.ShouldBe("复核后调整");
    }

    [Fact]
    public void 评分后任务状态为已阅完并记录评语()
    {
        var task = PendingTask();
        task.Claim(reviewerId: 7, now: Now);

        task.Grade(Score.Graded(7.5m, 10m), " 要点 1、2 覆盖到位 ", reviewerId: 7, now: Now);

        task.Status.ShouldBe(ReviewTaskStatus.Reviewed);
        task.FinalScore!.Value.ShouldBe(7.5m);
        task.Comment.ShouldBe("要点 1、2 覆盖到位");
        task.ReviewedAt.ShouldBe(Now);
    }

    [Fact]
    public void 采纳系统建议分后状态为已阅完()
    {
        var task = PendingTask();
        task.Claim(reviewerId: 7, now: Now);

        task.AdoptSuggestion(reviewerId: 7, comment: "系统初判，已批量采纳", now: Now);

        task.Status.ShouldBe(ReviewTaskStatus.Reviewed);
        task.FinalScore!.Value.ShouldBe(5m);
        task.Comment.ShouldBe("系统初判，已批量采纳");
    }

    [Fact]
    public void 没有建议分就没有东西可采纳()
    {
        var task = ReviewTask.Create(
            attemptId: 1,
            examSessionId: 1,
            questionId: 2,
            stepCode: null,
            answerText: "作答",
            suggestedScore: null,
            maxScore: Score.Paper(10m),
            now: Now);

        var act = () => task.AdoptSuggestion(reviewerId: 7, comment: null, now: Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 改分流水保留改前与改后的分数()
    {
        var revision = GradeRevision.Create(
            scoreResultId: 5,
            previousScore: 5m,
            newScore: 7.5m,
            comment: " 要点 3 覆盖到位 ",
            operatorId: 7,
            occurredAt: Now);

        revision.PreviousScore.ShouldBe(5m);
        revision.NewScore.ShouldBe(7.5m);
        revision.Comment.ShouldBe("要点 3 覆盖到位");
        revision.OperatorId.ShouldBe(7);
    }
}
