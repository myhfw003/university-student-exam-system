using Exam.Domain.Delivery;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Delivery;

public sealed class AttemptTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    private static Attempt Create(int durationMinutes = 90, DateTimeOffset? closeAt = null)
    {
        var attempt = Attempt.CreateExam(30, 7, 1, "STD", "30:7", Now);
        attempt.Start(Now, durationMinutes, closeAt ?? Now.AddHours(4));
        return attempt;
    }

    [Fact]
    public void 新建会话是未开始状态()
    {
        var attempt = Attempt.CreateExam(30, 7, 1, "STD", "30:7", Now);

        attempt.Status.ShouldBe(AttemptStatus.NotStarted);
        attempt.AttemptNo.ShouldBe(1);
        attempt.UserId.ShouldBe(7);
        attempt.StartedAt.ShouldBeNull();
    }

    [Fact]
    public void 开始作答后截止时间由服务端算出()
    {
        var attempt = Create(durationMinutes: 90);

        attempt.Status.ShouldBe(AttemptStatus.InProgress);
        attempt.StartedAt.ShouldBe(Now);
        attempt.DeadlineAt.ShouldBe(Now.AddMinutes(90));
    }

    [Fact]
    public void 场次关闭时间早于时长时以关闭时间为准()
    {
        var attempt = Create(durationMinutes: 90, closeAt: Now.AddMinutes(30));

        attempt.DeadlineAt.ShouldBe(Now.AddMinutes(30));
    }

    [Fact]
    public void 超过截止时间不能保存答案()
    {
        var attempt = Create();

        var act = () => attempt.EnsureAcceptingAnswers(Now.AddMinutes(91));

        var ex = act.ShouldThrow<AttemptDeadlineExceededException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.AttemptDeadlineExceeded);
    }

    [Fact]
    public void 交卷后不能保存答案()
    {
        var attempt = Create();
        attempt.Submit(SubmitReason.Manual, Now.AddMinutes(10));

        var act = () => attempt.EnsureAcceptingAnswers(Now.AddMinutes(11));

        act.ShouldThrow<AttemptStateInvalidException>();
    }

    [Fact]
    public void 重复的客户端序列号被忽略()
    {
        var attempt = Create();

        attempt.AcceptSave(5, Now).ShouldBeTrue();
        attempt.AcceptSave(5, Now).ShouldBeFalse();
        attempt.AcceptSave(4, Now).ShouldBeFalse();
        attempt.AcceptSave(6, Now).ShouldBeTrue();

        attempt.LastClientSeq.ShouldBe(6);
    }

    [Fact]
    public void 交卷幂等且理由决定状态()
    {
        var attempt = Create();

        attempt.Submit(SubmitReason.Manual, Now.AddMinutes(10)).ShouldBeTrue();
        attempt.Submit(SubmitReason.Manual, Now.AddMinutes(11)).ShouldBeFalse();

        attempt.Status.ShouldBe(AttemptStatus.Submitted);
        attempt.SubmitReason.ShouldBe(SubmitReason.Manual);
        attempt.SubmittedAt.ShouldBe(Now.AddMinutes(10));
        attempt.DurationSpentSeconds.ShouldBe(600);
    }

    [Fact]
    public void 超时交卷记为自动交卷()
    {
        var attempt = Create();

        attempt.Submit(SubmitReason.TimeUp, Now.AddMinutes(90));

        attempt.Status.ShouldBe(AttemptStatus.AutoSubmitted);
        attempt.SubmitReason.ShouldBe(SubmitReason.TimeUp);
    }

    [Fact]
    public void 监考强制交卷记为强制交卷()
    {
        var attempt = Create();

        attempt.Submit(SubmitReason.ProctorForce, Now.AddMinutes(10));

        attempt.Status.ShouldBe(AttemptStatus.ForceSubmitted);
    }

    [Fact]
    public void 已交卷的会话不能恢复()
    {
        var attempt = Create();
        attempt.Submit(SubmitReason.Manual, Now.AddMinutes(10));

        var act = () => attempt.EnsureResumable(Now.AddMinutes(11));

        act.ShouldThrow<AttemptStateInvalidException>();
    }

    [Fact]
    public void 超时的会话不能恢复()
    {
        var attempt = Create();

        var act = () => attempt.EnsureResumable(Now.AddMinutes(91));

        act.ShouldThrow<AttemptDeadlineExceededException>();
    }

    [Fact]
    public void 剩余秒数不为负()
    {
        var attempt = Create();

        attempt.RemainingSeconds(Now.AddMinutes(10)).ShouldBe(80 * 60);
        attempt.RemainingSeconds(Now.AddMinutes(200)).ShouldBe(0);
    }

    [Fact]
    public void 切屏与断连计数只增不减()
    {
        var attempt = Create();

        attempt.RecordFocusLoss(Now).ShouldBe(1);
        attempt.RecordFocusLoss(Now).ShouldBe(2);
        attempt.RecordDisconnect(Now).ShouldBe(1);
        attempt.RecordWarning(Now).ShouldBe(1);

        attempt.FocusLossCount.ShouldBe(2);
        attempt.DisconnectCount.ShouldBe(1);
        attempt.WarningCount.ShouldBe(1);
    }

    [Fact]
    public void 答案载荷的空判定()
    {
        AnswerPayload.Empty().IsEmpty.ShouldBeTrue();
        AnswerPayload.Options("A").IsEmpty.ShouldBeFalse();
        AnswerPayload.Written("作答").IsEmpty.ShouldBeFalse();
        AnswerPayload.Written("   ").IsEmpty.ShouldBeTrue();
    }

    [Fact]
    public void 客观题选项去重且排序()
    {
        var payload = AnswerPayload.Options("b", "A", "a");

        payload.SelectedOptionKeys.ShouldBe(["A", "B"]);
    }
}
