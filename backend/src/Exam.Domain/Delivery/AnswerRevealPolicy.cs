using Exam.Domain.Authoring;

namespace Exam.Domain.Delivery;

/// <summary>
/// 答案公布判定。
/// <para>
/// 规则：**考试进行中，任何人都读不到答案与解析**。场次关闭之后才按策略公布，
/// 公布策略在试卷发布时冻结进快照——考完之后改试卷也改不动。
/// </para>
/// <para>
/// 练习不走这里：练习没有场次，按练习的反馈时机（即时 / 交卷后）判定，
/// 见 <c>GetAttemptReportHandler.ShouldRevealPracticeAsync</c>。
/// </para>
/// </summary>
public static class AnswerRevealPolicy
{
    /// <summary>这场考试、这位考生，现在公布答案吗？</summary>
    /// <param name="policy">试卷的答案公布策略。</param>
    /// <param name="sessionStatus">场次状态。</param>
    /// <param name="studentSubmitted">这位考生交卷了吗。</param>
    public static bool ShouldReveal(
        AnswerPolicy policy,
        ExamSessionStatus sessionStatus,
        bool studentSubmitted)
    {
        // 场次没关闭就是考试进行中：答案一律不给，哪怕策略写着「立即公布」。
        // 考生在考试期间看到答案，等于开卷考试。
        if (sessionStatus != ExamSessionStatus.Closed)
        {
            return false;
        }

        return policy switch
        {
            // 结束后立即公布：全场结束，人人都能看到。
            AnswerPolicy.Immediately => true,

            // 结束后只给交卷的人看：没交卷的（缺考）拿不到答案与解析。
            AnswerPolicy.AfterSubmit => studentSubmitted,

            // 结束后公布：全场结束，人人都能看到。
            AnswerPolicy.AfterClose => true,

            _ => false,
        };
    }
}
