using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Queries;
using Exam.Domain.Delivery;
using Exam.Domain.SharedKernel.Entities;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Delivery;

/// <summary>
/// 我的作答列表。
/// <para>
/// 前端要靠 <c>examSessionId</c> 把「我的作答」对应回「考试安排」里的某一场——
/// 没有这个字段，学生端就不知道哪场考试已经交过卷。
/// </para>
/// </summary>
public sealed class AttemptListHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 17, 1, 0, 0, TimeSpan.Zero);

    private readonly IAttemptRepository _attempts = Substitute.For<IAttemptRepository>();
    private readonly IExamSessionRepository _sessions = Substitute.For<IExamSessionRepository>();
    private readonly ICurrentUser _currentUser = Substitute.For<ICurrentUser>();

    /// <summary>给实体赋主键，模拟已持久化。</summary>
    private static T WithId<T>(T entity, long id)
        where T : class
    {
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(entity, id);
        return entity;
    }

    private ListAttemptsHandler Handler() => new(_attempts, _sessions, _currentUser);

    [Fact]
    public async Task 会话摘要带出场次ID与场次名()
    {
        var session = WithId(
            ExamSession.Create(1L, "期末考试", Now, Now.AddHours(2), 60, ParticipantMode.OpenToAll, Now),
            11);
        var attempt = WithId(Attempt.CreateExam(11, 42, 1, "STD", "seed", Now), 21);
        attempt.Start(Now, 60, Now.AddHours(2));

        _currentUser.UserId.Returns(42L);
        _attempts.ListByUserAsync(42, Arg.Any<CancellationToken>()).Returns([attempt]);
        _sessions.ListAsync(null, null, Arg.Any<CancellationToken>()).Returns([session]);

        var result = await Handler().Handle(new ListAttemptsQuery(), CancellationToken.None);

        var item = result.Items.ShouldHaveSingleItem();
        item.ExamSessionId.ShouldBe(11);
        item.ExamName.ShouldBe("期末考试");
        item.AttemptNo.ShouldBe(1);
    }

    [Fact]
    public async Task 练习作答没有场次ID()
    {
        var attempt = WithId(Attempt.CreatePractice(7, 42, 1, null, null, Now), 22);
        attempt.Start(Now, 60, Now.AddHours(2));

        _currentUser.UserId.Returns(42L);
        _attempts.ListByUserAsync(42, Arg.Any<CancellationToken>()).Returns([attempt]);
        _sessions.ListAsync(null, null, Arg.Any<CancellationToken>()).Returns([]);

        var result = await Handler().Handle(new ListAttemptsQuery(), CancellationToken.None);

        var item = result.Items.ShouldHaveSingleItem();
        item.ExamSessionId.ShouldBeNull();
        item.ExamName.ShouldBeNull();
    }
}
