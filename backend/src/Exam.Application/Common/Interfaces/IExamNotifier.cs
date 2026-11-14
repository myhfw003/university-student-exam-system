namespace Exam.Application.Common.Interfaces;

/// <summary>
/// 考试实时通知（应用层抽象）。
/// <para>
/// 具体实现由 Web 层提供（SignalR Hub），应用层只表达「要通知什么」。
/// </para>
/// </summary>
public interface IExamNotifier
{
    /// <summary>给考生推送监考警告。</summary>
    Task WarnCandidateAsync(long attemptId, string message, CancellationToken cancellationToken = default);

    /// <summary>通知考生会话状态发生变化。</summary>
    Task NotifyStateChangedAsync(
        long attemptId,
        string fromStatus,
        string toStatus,
        CancellationToken cancellationToken = default);
}
