using Exam.Domain.Analytics;

namespace Exam.Application.Common.Interfaces;

/// <summary>
/// 统计读模型存取。
/// <para>读模型只存结果，不参与业务一致性；错了靠重算纠正。</para>
/// </summary>
public interface IExamStatisticRepository
{
    /// <summary>取回某场考试的场次级统计。</summary>
    Task<ExamStatistic?> GetExamStatisticAsync(long examSessionId, CancellationToken cancellationToken = default);

    /// <summary>取回某场考试的逐题统计。</summary>
    Task<IReadOnlyList<QuestionStatistic>> ListQuestionStatisticsAsync(
        long examSessionId,
        CancellationToken cancellationToken = default);

    /// <summary>取回某场考试的题型统计。</summary>
    Task<IReadOnlyList<TypeStatistic>> ListTypeStatisticsAsync(
        long examSessionId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 用重算结果整体替换某场考试的统计。
    /// <para>先删旧行再写新行：读模型是一次性产物，不保留历史。</para>
    /// </summary>
    Task ReplaceAsync(
        long examSessionId,
        ExamStatistic examStatistic,
        IReadOnlyList<QuestionStatistic> questionStatistics,
        IReadOnlyList<TypeStatistic> typeStatistics,
        CancellationToken cancellationToken = default);
}
