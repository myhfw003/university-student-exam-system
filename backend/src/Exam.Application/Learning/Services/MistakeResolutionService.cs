using Exam.Application.Common.Interfaces;
using Exam.Application.Settings.Services;
using Exam.Domain.Learning;
using Exam.Domain.Settings;
using Exam.Domain.SharedKernel.Abstractions;

namespace Exam.Application.Learning.Services;

/// <summary>
/// 「这道题已经掌握了」的处理。
/// <para>
/// 口径是**系统级**的（需求 FR-LRN-01：「重做正确后移出错题本（可配置为保留但标记已掌握）」）：
/// 管理员改一次全局生效，学生端没有单独的开关。
/// </para>
/// <para>
/// 两档口径：
/// - 移出错题本：记录软删除（ADR-019，数据一直留着），错题本里再也看不到它；
/// - 保留但标记已掌握：记录留着并标成已掌握，「含已掌握」筛选下能看到。
/// </para>
/// </summary>
public sealed class MistakeResolutionService
{
    private readonly IMistakeRepository _mistakes;
    private readonly SystemSettingsResolver _resolver;
    private readonly IClock _clock;

    public MistakeResolutionService(
        IMistakeRepository mistakes,
        SystemSettingsResolver resolver,
        IClock clock)
    {
        _mistakes = mistakes;
        _resolver = resolver;
        _clock = clock;
    }

    /// <summary>
    /// 按系统级设置处理「已掌握」。返回实际生效的口径——
    /// 调用方要写审计时用得上：同一个动作在不同口径下留下的痕迹不一样。
    /// </summary>
    public async Task<MistakeResolutionPolicy> ResolveAsync(
        Mistake mistake,
        CancellationToken cancellationToken = default)
    {
        var policy = await _resolver.GetMistakeResolutionPolicyAsync(cancellationToken);
        var now = _clock.UtcNow;

        if (policy == MistakeResolutionPolicy.KeepMastered)
        {
            mistake.Resolve(now);
        }
        else
        {
            mistake.RemoveFromNotebook(now);
        }

        _mistakes.Update(mistake);
        return policy;
    }
}
