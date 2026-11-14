using Exam.Domain.Authoring;
using Exam.Domain.Delivery;
using Shouldly;

namespace Exam.Domain.UnitTests.Delivery;

/// <summary>
/// 答案公布时机。
/// <para>
/// 三档策略：开考即公布、交卷后公布、场次关闭后公布。
/// </para>
/// </summary>
public sealed class AnswerRevealPolicyTests
{
    [Theory]
    [InlineData(ExamSessionStatus.Scheduled, false, false)]
    [InlineData(ExamSessionStatus.InProgress, false, true)]
    [InlineData(ExamSessionStatus.Closed, false, true)]
    public void 开考即公布场次开考后就能看(
        ExamSessionStatus status,
        bool submitted,
        bool expected) =>
        AnswerRevealPolicy.ShouldReveal(AnswerPolicy.Immediately, status, submitted)
            .ShouldBe(expected);

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, true)]
    public void 交卷后公布本人交卷才能看(bool submitted, bool expected) =>
        AnswerRevealPolicy.ShouldReveal(AnswerPolicy.AfterSubmit, ExamSessionStatus.InProgress, submitted)
            .ShouldBe(expected);

    [Theory]
    [InlineData(ExamSessionStatus.InProgress, false)]
    [InlineData(ExamSessionStatus.Closed, true)]
    public void 场次关闭后才公布(ExamSessionStatus status, bool expected) =>
        AnswerRevealPolicy.ShouldReveal(AnswerPolicy.AfterClose, status, studentSubmitted: true)
            .ShouldBe(expected);

    [Fact]
    public void 交卷后公布与场次状态无关() =>
        AnswerRevealPolicy.ShouldReveal(AnswerPolicy.AfterSubmit, ExamSessionStatus.Scheduled, studentSubmitted: true)
            .ShouldBeTrue();
}
