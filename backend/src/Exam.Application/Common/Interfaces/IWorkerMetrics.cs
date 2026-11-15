namespace Exam.Application.Common.Interfaces;

/// <summary>
/// 业务指标（Worker 进程侧）。
/// <para>
/// 与 <see cref="IExamMetrics"/> 分开：Web 端只报 API 进程的事，
/// Worker 端只报后台作业与数据库水位。两套指标各走各的指标端口，
/// 同一个指标名不会被两个进程各报一次。
/// </para>
/// </summary>
public interface IWorkerMetrics
{
    /// <summary>后台作业执行。</summary>
    /// <param name="failed">是否失败。</param>
    void RecordBackgroundJob(string job, double durationSeconds, bool failed);

    /// <summary>Outbox 待派发消息数（定时采样）。</summary>
    void SetOutboxPending(long count);

    /// <summary>答卷对账发现的差异数。</summary>
    void RecordReconciliationFindings(long count);

    /// <summary>某场考试当前「连着」的作答会话数。</summary>
    void SetActiveSessions(long examSessionId, int count);

    /// <summary>
    /// 某场考试已不在进行中：撤掉它的活跃会话序列。
    /// 留着 0 值序列的话，考完之后告警还会拿 0 去比考中的峰值。
    /// </summary>
    void RemoveActiveSessions(long examSessionId);

    /// <summary>数据库连接水位（服务端连接数与上限）。</summary>
    void SetDatabaseConnections(int active, int max);
}
