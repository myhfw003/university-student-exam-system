using Exam.Application.Analytics.Contracts;

namespace Exam.Application.Common.Interfaces;

/// <summary>
/// 统计用的原始数据来源。
/// <para>
/// 只取事实，不做统计口径的判断——口径在应用层与领域层，
/// 这样换一套口径不必改查询。
/// </para>
/// </summary>
public interface IExamStatisticSource
{
    /// <summary>列出场次内的全部作答（含未交卷的）。</summary>
    Task<IReadOnlyList<ExamAttemptFact>> ListAttemptFactsAsync(
        long examSessionId,
        CancellationToken cancellationToken = default);

    /// <summary>列出场次内全部作答的逐题得分（含未作答的题，按零分计）。</summary>
    Task<IReadOnlyList<ExamScoreFact>> ListScoreFactsAsync(
        long examSessionId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 场次内最近一次数据变更的时间（作答或评分）。
    /// <para>读模型拿它跟自己的更新时间比，判断是否落后。</para>
    /// </summary>
    Task<DateTimeOffset?> GetLatestChangeAsync(
        long examSessionId,
        CancellationToken cancellationToken = default);

    /// <summary>列出有作答记录的全部场次（供全量重算用）。</summary>
    Task<IReadOnlyList<long>> ListSessionIdsWithAttemptsAsync(
        CancellationToken cancellationToken = default);
}
