using Exam.Domain.Authoring;

namespace Exam.Domain.Delivery;

/// <summary>
/// 答案公布判定。
/// <para>
/// 公布时机由试卷的答案公布策略决定：立即公布（开考即公布）、交卷后公布、
/// 场次关闭后公布。策略在试卷发布时冻结进快照——考完之后改试卷也改不动。
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
        bool studentSubmitted) =>
        policy switch
        {
            // 开考即公布：场次开考之后就算数。
            AnswerPolicy.Immediately => sessionStatus != ExamSessionStatus.Scheduled,

            // 交卷后公布：本人交卷就能看自己的答案。
            AnswerPolicy.AfterSubmit => studentSubmitted,

            // 场次关闭后公布：整场考完才一起公布。
            AnswerPolicy.AfterClose => sessionStatus == ExamSessionStatus.Closed,

            _ => false,
        };
}
