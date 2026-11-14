using Exam.Domain.Delivery;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Delivery;

public sealed class ExamSessionTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    private static ExamSession Create(
        ParticipantMode mode = ParticipantMode.OpenToAll,
        IReadOnlyList<long>? tagIds = null,
        IReadOnlyList<long>? userIds = null,
        int durationMinutes = 90,
        DateTimeOffset? openAt = null,
        DateTimeOffset? closeAt = null) =>
        ExamSession.Create(
            1,
            "期中考试",
            openAt ?? Now,
            closeAt ?? Now.AddHours(4),
            durationMinutes,
            mode,
            Now,
            null,
            tagIds,
            userIds);

    [Fact]
    public void 新建场次是未发布状态()
    {
        var session = Create();

        session.Status.ShouldBe(ExamSessionStatus.Scheduled);
        session.PublishedAt.ShouldBeNull();
        session.SnapshotId.ShouldBeNull();
        session.VariantRule.ShouldBe(Exam.Domain.Authoring.VariantRule.Standard);
        session.Rules.ShouldNotBeNull();
    }

    [Fact]
    public void 开放时间必须早于关闭时间()
    {
        var act = () => Create(openAt: Now.AddHours(4), closeAt: Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 作答时长必须大于零()
    {
        var act = () => Create(durationMinutes: 0);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 按标签纳入时必须选标签()
    {
        var act = () => Create(ParticipantMode.FromTags);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 指定考生时必须选考生()
    {
        var act = () => Create(ParticipantMode.Direct);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 发布后进入进行中并绑定快照()
    {
        var session = Create();

        session.Publish(88, Now);

        session.Status.ShouldBe(ExamSessionStatus.InProgress);
        session.SnapshotId.ShouldBe(88);
        session.PublishedAt.ShouldBe(Now);
    }

    [Fact]
    public void 已发布的场次不能重复发布()
    {
        var session = Create();
        session.Publish(88, Now);

        var act = () => session.Publish(88, Now);

        act.ShouldThrow<InvalidStateTransitionException>();
    }

    [Fact]
    public void 没有快照不能发布()
    {
        var session = Create();

        var act = () => session.Publish(0, Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 已发布的场次不能改配置()
    {
        var session = Create();
        session.Publish(88, Now);

        var act = () => session.Update(
            "改名字",
            Now,
            Now.AddHours(4),
            90,
            ParticipantMode.OpenToAll,
            null,
            null,
            Exam.Domain.Authoring.VariantRule.Standard,
            Exam.Domain.Authoring.ExamRules.Default,
            null,
            Now);

        act.ShouldThrow<InvalidStateTransitionException>();
    }

    [Fact]
    public void 进行中的场次可以关闭()
    {
        var session = Create();
        session.Publish(88, Now);

        session.Close(Now.AddHours(1));

        session.Status.ShouldBe(ExamSessionStatus.Closed);
        session.ClosedAt.ShouldBe(Now.AddHours(1));
    }

    [Fact]
    public void 未发布的场次不能直接关闭()
    {
        var session = Create();

        var act = () => session.Close(Now);

        act.ShouldThrow<InvalidStateTransitionException>();
    }

    [Fact]
    public void 取消后不能再取消()
    {
        var session = Create();

        session.Cancel(Now);
        session.Status.ShouldBe(ExamSessionStatus.Cancelled);

        var act = () => session.Cancel(Now);
        act.ShouldThrow<InvalidStateTransitionException>();
    }

    [Fact]
    public void 未发布的场次不能进入()
    {
        var session = Create();

        var act = () => session.EnsureCanEnter(Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 取消后不能进入()
    {
        var session = Create();
        session.Publish(88, Now);
        session.Cancel(Now);

        var act = () => session.EnsureCanEnter(Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 超过关闭时间不能进入()
    {
        var session = Create();
        session.Publish(88, Now);

        var act = () => session.EnsureCanEnter(Now.AddHours(5));

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 允许提前入场()
    {
        var session = Create(openAt: Now.AddMinutes(10), closeAt: Now.AddHours(4));

        // 允许提前 20 分钟入场。
        session.Update(
            session.Name,
            Now.AddMinutes(10),
            Now.AddHours(4),
            90,
            ParticipantMode.OpenToAll,
            null,
            null,
            Exam.Domain.Authoring.VariantRule.Standard,
            new Exam.Domain.Authoring.ExamRules { EarlyEntryMinutes = 20 },
            null,
            Now);

        session.Publish(88, Now);

        Should.NotThrow(() => session.EnsureCanEnter(Now.AddMinutes(5)));
    }
}
