using Exam.Domain.Catalog;
using Exam.Domain.Grading;
using Exam.Infrastructure.IntegrationTests.Persistence;
using Exam.Infrastructure.Persistence;
using Exam.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Grading;

/// <summary>
/// 阅卷任务的并发领取。
/// <para>
/// 「先到先得」靠数据库的 xmin 令牌守住：两个阅卷人同时点领取，
/// 只有一个能成功，另一个拿到并发冲突。
/// </para>
/// </summary>
public sealed class ReviewTaskConcurrencyTests : IClassFixture<AppDbContextFixture>
{
    private readonly AppDbContextFixture _fixture;

    public ReviewTaskConcurrencyTests(AppDbContextFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task 同时领取同一份任务时后者冲突()
    {
        await _fixture.ResetAsync();

        var taskId = await SeedReviewTaskAsync();

        // 两个独立上下文各自加载同一行。
        await using var ctx1 = new AppDbContext(_fixture.Options);
        await using var ctx2 = new AppDbContext(_fixture.Options);

        var t1 = await ctx1.Set<ReviewTask>().FirstAsync(t => t.Id == taskId);
        var t2 = await ctx2.Set<ReviewTask>().FirstAsync(t => t.Id == taskId);

        t1.Claim(reviewerId: 1, now: DateTimeOffset.UtcNow);
        await ctx1.SaveChangesAsync();

        t2.Claim(reviewerId: 2, now: DateTimeOffset.UtcNow);
        var act = async () => await ctx2.SaveChangesAsync();

        // 后者拿不到：乐观并发令牌不匹配。
        await act.ShouldThrowAsync<DbUpdateConcurrencyException>();

        // 数据库里只有一个阅卷人。
        var stored = await _fixture.DbContext.Set<ReviewTask>()
            .AsNoTracking()
            .FirstAsync(t => t.Id == taskId);
        stored.ReviewerId.ShouldBe(1);
        stored.Status.ShouldBe(ReviewTaskStatus.InReview);

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 领取后状态与阅卷人写入正确()
    {
        await _fixture.ResetAsync();

        var taskId = await SeedReviewTaskAsync();

        await using var ctx = new AppDbContext(_fixture.Options);
        var task = await ctx.Set<ReviewTask>().FirstAsync(t => t.Id == taskId);

        task.Claim(reviewerId: 7, now: DateTimeOffset.UtcNow);
        await ctx.SaveChangesAsync();

        var stored = await _fixture.DbContext.Set<ReviewTask>()
            .AsNoTracking()
            .FirstAsync(t => t.Id == taskId);

        stored.Status.ShouldBe(ReviewTaskStatus.InReview);
        stored.ReviewerId.ShouldBe(7);
        stored.AssigneeId.ShouldBe(7);

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 走仓储更新路径时并发领取同样只有一人成功()
    {
        await _fixture.ResetAsync();

        var taskId = await SeedReviewTaskAsync();

        // 生产路径走仓储的 Update()，这里照走一遍：
        // 两个人同时领同一份，先提交的那个成功，后提交的那个拿到并发冲突。
        await using var ctx1 = new AppDbContext(_fixture.Options);
        await using var ctx2 = new AppDbContext(_fixture.Options);

        var repo1 = new ReviewTaskRepository(ctx1);
        var repo2 = new ReviewTaskRepository(ctx2);

        var t1 = await repo1.GetByIdAsync(taskId);
        var t2 = await repo2.GetByIdAsync(taskId);

        t1!.Claim(reviewerId: 1, now: DateTimeOffset.UtcNow);
        repo1.Update(t1);
        await ctx1.SaveChangesAsync();

        t2!.Claim(reviewerId: 2, now: DateTimeOffset.UtcNow);
        repo2.Update(t2);
        var act = async () => await ctx2.SaveChangesAsync();

        await act.ShouldThrowAsync<DbUpdateConcurrencyException>();

        var stored = await _fixture.DbContext.Set<ReviewTask>()
            .AsNoTracking()
            .FirstAsync(t => t.Id == taskId);
        stored.ReviewerId.ShouldBe(1);

        await _fixture.ResetAsync();
    }

    /// <summary>造一条待阅任务。卷宗内容靠外键关联，这里只需要任务本身能落库。</summary>
    private async Task<long> SeedReviewTaskAsync()
    {
        var now = DateTimeOffset.UtcNow;

        var attemptId = await SeedAttemptAsync(now);

        var task = ReviewTask.Create(
            attemptId,
            examSessionId: null,
            questionId: 1,
            stepCode: null,
            answerText: "作答",
            suggestedScore: Score.Graded(5m, 10m),
            maxScore: Score.Paper(10m),
            now);

        _fixture.DbContext.ReviewTasks.Add(task);
        await _fixture.DbContext.SaveChangesAsync();

        return task.Id;
    }

    /// <summary>阅卷任务外键指向作答会话，先造一条会话。</summary>
    private async Task<long> SeedAttemptAsync(DateTimeOffset now)
    {
        var sessionId = await SeedSessionAsync(now);

        var attempt = Exam.Domain.Delivery.Attempt.CreateExam(
            sessionId,
            userId: 1,
            attemptNo: 1,
            variantKey: null,
            variantSeed: null,
            now);

        _fixture.DbContext.Attempts.Add(attempt);
        await _fixture.DbContext.SaveChangesAsync();

        return attempt.Id;
    }

    /// <summary>会话外键指向试卷，先造一份试卷。</summary>
    private async Task<long> SeedSessionAsync(DateTimeOffset now)
    {
        var paper = Exam.Domain.Authoring.Paper.CreateDraft(
            Exam.Domain.Authoring.PaperKind.Exam,
            "并发测试试卷",
            now);

        _fixture.DbContext.Papers.Add(paper);
        await _fixture.DbContext.SaveChangesAsync();

        var session = Exam.Domain.Delivery.ExamSession.Create(
            paper.Id,
            "并发测试场次",
            now.AddMinutes(-5),
            now.AddHours(4),
            90,
            Exam.Domain.Delivery.ParticipantMode.OpenToAll,
            now);

        _fixture.DbContext.ExamSessions.Add(session);
        await _fixture.DbContext.SaveChangesAsync();

        return session.Id;
    }
}
