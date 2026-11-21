namespace Exam.Application.Settings.Contracts;

/// <summary>
/// 系统级设置。管理员可见。
/// <para>
/// 值一律给**原始取值**（如 <c>remove</c>），中文名由前端登记——
/// 两边的取值词表由 <c>scripts/check-system-setting-values.py</c> 守着。
/// </para>
/// </summary>
public sealed record SystemSettingsDto(
    /// <summary>重做正确后的错题处理口径。</summary>
    string MistakeResolutionPolicy,

    /// <summary>最后修改时间。没改过就是空。</summary>
    DateTimeOffset? UpdatedAt,

    /// <summary>最后修改人。没改过就是空。</summary>
    long? UpdatedBy);
