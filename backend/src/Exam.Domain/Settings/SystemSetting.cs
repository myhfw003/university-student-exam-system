using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Settings;

/// <summary>
/// 系统级设置项的键。
/// <para>
/// 键是稳定契约：改键名等于换了一项设置，存量数据不会自己跟过来。
/// </para>
/// </summary>
public static class SystemSettingKeys
{
    /// <summary>
    /// 重做正确后，错题怎么处理。
    /// <para>取值见 <see cref="MistakeResolutionPolicies"/>。</para>
    /// </summary>
    public const string MistakeResolutionPolicy = "mistake_resolution_policy";

    /// <summary>
    /// 系统设定的**原始密码**（重置密码时置成它）。
    /// <para>
    /// 值存的是 PBKDF2 哈希，不是明文：这个设置**只写不回显**——
    /// 管理端只看得到「是否已配置」。
    /// </para>
    /// </summary>
    public const string OriginalPasswordHash = "original_password_hash";
}

/// <summary>
/// 重做正确后的错题处理口径。
/// <para>
/// 需求 FR-LRN-01：「重做正确后移出错题本（可配置为保留但标记已掌握）」。
/// 这项配置是**系统级**的：管理员改一次，全局生效，学生端没有单独开关。
/// </para>
/// </summary>
public enum MistakeResolutionPolicy
{
    /// <summary>移出错题本：记录软删除，不再出现在错题本里。</summary>
    Remove,

    /// <summary>保留但标记已掌握：记录留着，标成「已掌握」。</summary>
    KeepMastered,
}

/// <summary>错题处理口径的取值与文案。</summary>
public static class MistakeResolutionPolicies
{
    /// <summary>移出错题本。</summary>
    public const string RemoveStorage = "remove";

    /// <summary>保留但标记已掌握。</summary>
    public const string KeepMasteredStorage = "keep_mastered";

    /// <summary>缺省口径：移出错题本（与需求 FR-LRN-01 的默认一致）。</summary>
    public const MistakeResolutionPolicy Default = MistakeResolutionPolicy.Remove;

    /// <summary>落库取值。</summary>
    public static string ToStorage(this MistakeResolutionPolicy policy) => policy switch
    {
        MistakeResolutionPolicy.KeepMastered => KeepMasteredStorage,
        _ => RemoveStorage,
    };

    /// <summary>
    /// 解析取值。认不出来返回空——由调用方决定回退到哪一档，
    /// 不要在这里悄悄换一档：认不出来的配置要能被发现。
    /// </summary>
    public static MistakeResolutionPolicy? FromStorage(string? storage) => storage switch
    {
        RemoveStorage => MistakeResolutionPolicy.Remove,
        KeepMasteredStorage => MistakeResolutionPolicy.KeepMastered,
        _ => null,
    };

    /// <summary>中文名。</summary>
    public static string Label(this MistakeResolutionPolicy policy) => policy switch
    {
        MistakeResolutionPolicy.KeepMastered => "保留但标记已掌握",
        _ => "移出错题本",
    };
}

/// <summary>
/// 一条系统级设置。
/// <para>
/// 键值对：值的含义由 <see cref="SystemSettingKeys"/> 指向的那一项定义。
/// </para>
/// </summary>
public sealed class SystemSetting : AuditableEntity
{
    private SystemSetting()
    {
    }

    private SystemSetting(string key, string value, DateTimeOffset now, long? actorId)
        : base(now, actorId)
    {
        Key = key;
        Value = value;
    }

    /// <summary>设置项的键。见 <see cref="SystemSettingKeys"/>。</summary>
    public string Key { get; private set; } = string.Empty;

    /// <summary>设置项的值（字符串）。</summary>
    public string Value { get; private set; } = string.Empty;

    public static SystemSetting Create(string key, string value, DateTimeOffset now, long? actorId)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new BusinessRuleException("设置项的键不能为空。");
        }

        if (value is null)
        {
            throw new BusinessRuleException("设置项的值不能为空。");
        }

        return new SystemSetting(key.Trim(), value, now, actorId);
    }

    /// <summary>改值。</summary>
    public void SetValue(string value, DateTimeOffset now, long? actorId)
    {
        if (value is null)
        {
            throw new BusinessRuleException("设置项的值不能为空。");
        }

        Value = value;
        Touch(now, actorId);
    }
}
