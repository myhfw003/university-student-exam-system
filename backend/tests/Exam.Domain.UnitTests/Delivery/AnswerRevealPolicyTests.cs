using Exam.Domain.Authoring;
using Exam.Domain.Delivery;
using Shouldly;

namespace Exam.Domain.UnitTests.Delivery;

/// <summary>
/// 答案公布时机。
/// <para>
/// 规则：**考试进行中一律不公布**——场次没关闭，任何策略都不给答案与解析，
/// 「开考即公布」也不例外。场次关闭之后才按策略区分范围：
/// 结束后全员可见，或只给交卷的人看。
/// </para>
/// </summary>
public sealed class AnswerRevealPolicyTests
{
    [Theory]
    [InlineData(ExamSessionStatus.Scheduled, false)]
    [InlineData(ExamSessionStatus.Scheduled, true)]
    [InlineData(ExamSessionStatus.InProgress, false)]
    [InlineData(ExamSessionStatus.InProgress, true)]
    public void 考试进行中一律不公布(ExamSessionStatus status, bool submitted) =>
        AnswerRevealPolicy.ShouldReveal(AnswerPolicy.Immediately, status, submitted)
            .ShouldBeFalse();

    [Theory]
    [InlineData(ExamSessionStatus.Scheduled, true)]
    [InlineData(ExamSessionStatus.InProgress, true)]
    [InlineData(ExamSessionStatus.Closed, false)]
    [InlineData(ExamSessionStatus.Closed, true)]
    public void 交卷后公布要等场次关闭(
        ExamSessionStatus status,
        bool submitted) =>
        AnswerRevealPolicy.ShouldReveal(AnswerPolicy.AfterSubmit, status, submitted)
            .ShouldBe(status == ExamSessionStatus.Closed && submitted);

    [Theory]
    [InlineData(ExamSessionStatus.Scheduled, false)]
    [InlineData(ExamSessionStatus.InProgress, false)]
    [InlineData(ExamSessionStatus.Closed, false)]
    [InlineData(ExamSessionStatus.Closed, true)]
    public void 场次关闭后公布(
        ExamSessionStatus status,
        bool submitted) =>
        AnswerRevealPolicy.ShouldReveal(AnswerPolicy.AfterClose, status, submitted)
            .ShouldBe(status == ExamSessionStatus.Closed);

    [Fact]
    public void 结束后立即公布对全员可见() =>
        AnswerRevealPolicy.ShouldReveal(AnswerPolicy.Immediately, ExamSessionStatus.Closed, studentSubmitted: false)
            .ShouldBeTrue();
}
