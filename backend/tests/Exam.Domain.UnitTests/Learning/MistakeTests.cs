using Exam.Domain.Learning;
using Shouldly;

namespace Exam.Domain.UnitTests.Learning;

/// <summary>
/// 错题本规则。
/// <para>
/// 同一道题只留一条记录：再次做错累计次数，做对了移出错题本。
/// </para>
/// </summary>
public sealed class MistakeTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    [Fact]
    public void 首次做错记一条并累计一次()
    {
        var mistake = Mistake.Record(
            userId: 7,
            questionId: 501,
            reason: MistakeReason.SingleWrong,
            sourceType: MistakeSourceType.Exam,
            sourceAttemptId: 8821,
            now: Now);

        mistake.WrongCount.ShouldBe(1);
        mistake.Reason.ShouldBe(MistakeReason.SingleWrong);
        mistake.SourceType.ShouldBe(MistakeSourceType.Exam);
        mistake.SourceAttemptId.ShouldBe(8821);
        mistake.LastWrongAt.ShouldBe(Now);
        mistake.IsResolved.ShouldBeFalse();
    }

    [Fact]
    public void 又错一次累计次数()
    {
        var mistake = Mistake.Record(7, 501, MistakeReason.SingleWrong, MistakeSourceType.Exam, 8821, Now);

        mistake.RecordWrong(MistakeReason.MultiWrong, MistakeSourceType.Practice, 9001, Now.AddDays(1));

        mistake.WrongCount.ShouldBe(2);
        mistake.Reason.ShouldBe(MistakeReason.MultiWrong);
        mistake.SourceType.ShouldBe(MistakeSourceType.Practice);
        mistake.SourceAttemptId.ShouldBe(9001);
        mistake.LastWrongAt.ShouldBe(Now.AddDays(1));
    }

    [Fact]
    public void 重做正确后移出错题本()
    {
        var mistake = Mistake.Record(7, 501, MistakeReason.SingleWrong, MistakeSourceType.Exam, 8821, Now);

        mistake.Resolve(Now.AddDays(2));

        mistake.IsResolved.ShouldBeTrue();
        mistake.ResolvedAt.ShouldBe(Now.AddDays(2));
        mistake.WrongCount.ShouldBe(1);
    }

    [Fact]
    public void 同一次作答里改分只更新错因不累计次数()
    {
        var mistake = Mistake.Record(7, 501, MistakeReason.SingleWrong, MistakeSourceType.Exam, 8821, Now);

        mistake.RefreshReason(MistakeReason.ShortKeypointsMissed, MistakeSourceType.Exam, 8821, Now.AddHours(1));

        mistake.WrongCount.ShouldBe(1);
        mistake.Reason.ShouldBe(MistakeReason.ShortKeypointsMissed);
    }

    [Fact]
    public void 再次做错会重新变成未掌握()
    {
        var mistake = Mistake.Record(7, 501, MistakeReason.SingleWrong, MistakeSourceType.Exam, 8821, Now);
        mistake.Resolve(Now.AddDays(1));

        mistake.RecordWrong(MistakeReason.SingleWrong, MistakeSourceType.Exam, 9001, Now.AddDays(2));

        mistake.IsResolved.ShouldBeFalse();
        mistake.WrongCount.ShouldBe(2);
    }

    [Fact]
    public void 错因有中文标签()
    {
        MistakeReason.MultiMissed.Label().ShouldBe("多选漏选");
        MistakeReason.MultiWrong.Label().ShouldBe("多选错选");
        MistakeReason.SingleWrong.Label().ShouldBe("单选错选");
        MistakeReason.JudgeWrong.Label().ShouldBe("判断结论错");
        MistakeReason.ShortKeypointsMissed.Label().ShouldBe("简答要点未覆盖");
        MistakeReason.ComprehensiveStepMissed.Label().ShouldBe("综合题步骤缺失");
        MistakeReason.Unanswered.Label().ShouldBe("未作答");
    }
}
