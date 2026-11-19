namespace Exam.Application.Common.Interfaces;

/// <summary>审计记录器。关键业务动作由应用层显式记录，实体字段变更由 EF 拦截器自动记录。</summary>
public interface IAuditRecorder
{
    Task RecordAsync(
        string action,
        string? targetType = null,
        string? targetId = null,
        IReadOnlyDictionary<string, object?>? summary = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 以指定的操作者留痕。
    /// <para>
    /// 登录这类操作用：请求发起来的时候还没有令牌，操作者取不到当前用户，
    /// 只能由业务自己给（登录成功是登录者本人，登录失败是自称的账号）。
    /// </para>
    /// </summary>
    Task RecordAsAsync(
        long? operatorId,
        string? operatorName,
        string action,
        string? targetType = null,
        string? targetId = null,
        IReadOnlyDictionary<string, object?>? summary = null,
        CancellationToken cancellationToken = default);
}
