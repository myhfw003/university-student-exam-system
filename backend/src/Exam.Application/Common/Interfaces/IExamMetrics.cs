namespace Exam.Application.Common.Interfaces;

/// <summary>
/// 业务指标（API 进程侧）。
/// <para>
/// 应用层只认这个接口：指标怎么采集、怎么导出、叫什么名字，是基础设施层的事。
/// 告警规则依赖的每一个指标都在这里有一个对应的入口——
/// 没有指标的告警等于没有告警。
/// </para>
/// <para>
/// 只归 API 进程采集的指标放这里，Worker 侧的指标在 <see cref="IWorkerMetrics"/>。
/// 两边分开是为了让「这个数字是谁报出来的」只有一个答案：同一个指标名
/// 被两个进程各报一次，告警里的比例就凭空翻倍。
/// </para>
/// </summary>
public interface IExamMetrics
{
    /// <summary>
    /// 答案保存批次。
    /// </summary>
    /// <param name="result">
    /// saved（整批落库）/ duplicate（重放，整批忽略）/ rejected（整批被拒：场次取消、超时、已交卷）。
    /// 三个取值都是「批次」口径，比例才有意义。
    /// </param>
    /// <param name="durationSeconds">
    /// 这一批的耗时。只有真正落库的批次才上报耗时——
    /// 把被拒批次的 0 秒也塞进直方图，p95 会被拉低，掩盖真实延迟。
    /// </param>
    void RecordAnswerSave(string result, double? durationSeconds = null);

    /// <summary>
    /// 单题被拒（题不在卷面、载荷不合法）。与批次口径分开计数：
    /// 一批里被拒 3 题是 3 次，不是 3 批。
    /// </summary>
    void RecordAnswerItemsRejected(int count);

    /// <summary>焦点事件上报。</summary>
    void RecordFocusEvent(string type);

    /// <summary>考试场次发布。</summary>
    void RecordExamSessionPublished();

    /// <summary>
    /// HTTP 请求。
    /// </summary>
    /// <param name="route">路由模板（如 api/v1/attempts/{id}），不取原始路径。</param>
    void RecordHttpRequest(string method, string route, int statusCode, double durationSeconds);

    /// <summary>SignalR 连接建立。</summary>
    void SignalRConnected();

    /// <summary>SignalR 连接断开。</summary>
    void SignalRDisconnected();

    /// <summary>应用时钟与数据库时钟的偏差（毫秒，绝对值）。</summary>
    void SetClockOffsetMs(double milliseconds);

    /// <summary>Redis 命令耗时。</summary>
    void RecordRedisCommand(string op, double durationSeconds);

    /// <summary>Redis 是否可用：1 可用，0 不可用。</summary>
    void SetRedisUp(bool up);
}
