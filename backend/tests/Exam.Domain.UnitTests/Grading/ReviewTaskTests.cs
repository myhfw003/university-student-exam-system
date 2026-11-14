using Exam.Domain.Catalog;
using Exam.Domain.Grading;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Grading;

/// <summary>
/// 阅卷任务的领取与指派规则。
/// <para>
/// 领取是「先到先得」：这是阅卷分发的核心不变量，
/// 领域层守住它，数据库层的并发令牌兜住同时领取的情况。
/// </para>
/// </summary>
public sealed class ReviewTaskTests
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

    [Fact]
    public void 领取后状态变为阅卷中并记录阅卷人()
    {
        var task = PendingTask();

        task.Claim(reviewerId: 7, now: Now);

        task.Status.ShouldBe(ReviewTaskStatus.InReview);
        task.ReviewerId.ShouldBe(7);
        task.AssigneeId.ShouldBe(7);
    }

    [Fact]
    public void 已被领取的任务他人不能再领()
    {
        var task = PendingTask();
        task.Claim(reviewerId: 7, now: Now);

        var act = () => task.Claim(reviewerId: 8, now: Now);

        act.ShouldThrow<BusinessRuleException>();
        task.ReviewerId.ShouldBe(7);
    }

    [Fact]
    public void 已阅完的任务不能再领()
    {
        var task = PendingTask();
        task.Claim(reviewerId: 7, now: Now);
        task.Grade(Score.Graded(8m, 10m), "评语", reviewerId: 7, now: Now);

        var act = () => task.Claim(reviewerId: 8, now: Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 指派给某人后只有本人能领()
    {
        var task = PendingTask();
        task.Assign(assigneeId: 7, actorId: 99, now: Now);

        var act = () => task.Claim(reviewerId: 8, now: Now);

        act.ShouldThrow<BusinessRuleException>();

        task.Claim(reviewerId: 7, now: Now);
        task.ReviewerId.ShouldBe(7);
    }

    [Fact]
    public void 指派不改变任务状态仍在待领取队列()
    {
        var task = PendingTask();

        task.Assign(assigneeId: 7, actorId: 99, now: Now);

        task.Status.ShouldBe(ReviewTaskStatus.Pending);
        task.AssigneeId.ShouldBe(7);
    }

    [Fact]
    public void 阅卷中的任务不能改派()
    {
        var task = PendingTask();
        task.Claim(reviewerId: 7, now: Now);

        var act = () => task.Assign(assigneeId: 8, actorId: 99, now: Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 已阅完的任务不能再指派()
    {
        var task = PendingTask();
        task.Claim(reviewerId: 7, now: Now);
        task.Grade(Score.Graded(8m, 10m), "评语", reviewerId: 7, now: Now);

        var act = () => task.Assign(assigneeId: 8, actorId: 99, now: Now);

        act.ShouldThrow<BusinessRuleException>();
    }
}
