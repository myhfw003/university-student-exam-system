using Exam.Domain.Settings;

namespace Exam.Application.Common.Interfaces;

/// <summary>系统级设置。</summary>
public interface ISystemSettingRepository
{
    /// <summary>
    /// 按键取设置。没有则返回空——
    /// 「没配」与「配成空值」都表示用默认值，不是错误。
    /// </summary>
    Task<SystemSetting?> GetAsync(string key, CancellationToken cancellationToken = default);

    /// <summary>全部设置。</summary>
    Task<IReadOnlyList<SystemSetting>> ListAsync(CancellationToken cancellationToken = default);

    Task AddAsync(SystemSetting setting, CancellationToken cancellationToken = default);

    void Update(SystemSetting setting);
}
