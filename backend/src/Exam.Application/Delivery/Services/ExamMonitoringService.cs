using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Delivery;
using Exam.Domain.SharedKernel.Abstractions;

namespace Exam.Application.Delivery.Services;

/// <summary>
/// 监考状态聚合（应用层服务）。
/// <para>
/// 一场考试推一批状态，而不是每个考生一条消息——1000 名考生时差别很大。
/// </para>
/// </summary>
public sealed class ExamMonitoringService
{
    private readonly IAttemptRepository _attempts;
    private readonly IAnswerRepository _answers;
    private readonly IUserRepository _users;
    private readonly IPaperSnapshotRepository _snapshots;
    private readonly IClock _clock;

    public ExamMonitoringService(
        IAttemptRepository attempts,
        IAnswerRepository answers,
        IUserRepository users,
        IPaperSnapshotRepository snapshots,
        IClock clock)
    {
        _attempts = attempts;
        _answers = answers;
        _users = users;
        _snapshots = snapshots;
        _clock = clock;
    }

    /// <summary>聚合某场考试的全部考生状态。</summary>
    public async Task<ExamStatusBatchDto> BuildBatchAsync(
        ExamSession session,
        CancellationToken cancellationToken = default)
    {
        var attempts = await _attempts.ListBySessionAsync(session.Id, cancellationToken);
        var now = _clock.UtcNow;

        // 只保留最近一次尝试：重考时旧会话不再占位置。
        var latest = attempts
            .GroupBy(a => a.UserId)
            .Select(g => g.OrderByDescending(a => a.AttemptNo).First())
            .ToList();

        var users = await _users.GetByIdsAsync(latest.Select(a => a.UserId).ToList(), cancellationToken);
        var userById = users.ToDictionary(u => u.Id);

        var answered = await _answers.CountAnsweredAsync(latest.Select(a => a.Id).ToList(), cancellationToken);

        var total = 0;
        if (session.SnapshotId is { } snapshotId)
        {
            var snapshot = await _snapshots.GetByIdAsync(snapshotId, cancellationToken);
            total = snapshot?.Items.Count ?? 0;
        }

        var timeoutSeconds = session.Rules.HeartbeatTimeoutSeconds;

        var candidates = latest
            .Select(attempt =>
            {
                var user = userById.GetValueOrDefault(attempt.UserId);
                var offline = attempt.IsHeartbeatStale(now, timeoutSeconds);

                return new ExamCandidateStatusDto(
                    attempt.Id,
                    attempt.UserId,
                    user?.DisplayName ?? string.Empty,
                    user?.Username ?? string.Empty,
                    attempt.Status.ToStorage(),
                    attempt.Status.Label(),
                    attempt.FocusLossCount,
                    attempt.DisconnectCount,
                    attempt.WarningCount,
                    attempt.LastHeartbeatAt,
                    offline,
                    answered.GetValueOrDefault(attempt.Id),
                    total);
            })
            .ToList();

        return new ExamStatusBatchDto(session.Id, now, candidates);
    }
}
