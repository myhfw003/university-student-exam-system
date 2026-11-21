using Exam.Application.Common.Interfaces;
using Exam.Domain.Settings;

namespace Exam.Application.Settings.Services;

/// <summary>
/// 系统级设置的读取入口。
/// <para>
/// 业务代码不直接查设置表，都走这里：取值与回退收在一处，
/// 免得各处各写一套「认不出来怎么办」。
/// </para>
/// </summary>
public sealed class SystemSettingsResolver
{
    private readonly ISystemSettingRepository _settings;

    public SystemSettingsResolver(ISystemSettingRepository settings) => _settings = settings;

    /// <summary>
    /// 重做正确后的错题处理口径。
    /// <para>
    /// 没配、或配的值认不出来，都回退到默认档（移出错题本）：
    /// 一条坏配置不该把学生的错题本搞乱。
    /// </para>
    /// </summary>
    public async Task<MistakeResolutionPolicy> GetMistakeResolutionPolicyAsync(
        CancellationToken cancellationToken = default)
    {
        var setting = await _settings.GetAsync(
            SystemSettingKeys.MistakeResolutionPolicy,
            cancellationToken);

        if (setting is null)
        {
            return MistakeResolutionPolicies.Default;
        }

        return MistakeResolutionPolicies.FromStorage(setting.Value)
            ?? MistakeResolutionPolicies.Default;
    }
}
