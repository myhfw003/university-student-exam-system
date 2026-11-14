using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Grading;

namespace Exam.Application.Grading.Services;

/// <summary>
/// 成绩可见性判定。
/// <para>
/// 成绩没发布之前，考生只看得到客观题分与「待阅」；发布之后才看得到完整成绩。
/// </para>
/// </summary>
public sealed class GradeVisibilityResolver
{
    private readonly IGradePublicationRepository _publications;

    public GradeVisibilityResolver(IGradePublicationRepository publications) => _publications = publications;

    /// <summary>这份作答的成绩现在能看见多少。</summary>
    public async Task<string> ResolveAsync(
        long? examSessionId,
        long attemptId,
        bool subjectivePending,
        CancellationToken cancellationToken = default)
    {
        // 练习没有成绩发布这回事：自己练的，直接看。
        if (examSessionId is not { } sessionId)
        {
            return GradeVisibilities.Published;
        }

        var publication = await _publications.GetCoveringAsync(sessionId, attemptId, cancellationToken);
        return Resolve(publication, subjectivePending);
    }

    /// <summary>
    /// 按已取回的发布记录判定可见性。
    /// <para>批量判定时先取回场次的发布记录，再逐份作答算——省得一份一份去查。</para>
    /// </summary>
    public static string Resolve(GradePublication? publication, bool subjectivePending)
    {
        if (publication is null)
        {
            return subjectivePending ? GradeVisibilities.PendingReview : GradeVisibilities.ObjectiveOnly;
        }

        if (publication.Scope == GradePublicationScope.All)
        {
            return GradeVisibilities.Published;
        }

        // 只发布客观题：主观题的部分继续捂着。
        return GradeVisibilities.ObjectiveOnly;
    }
}
