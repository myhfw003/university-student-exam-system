namespace Exam.Application.Common.Security;

/// <summary>
/// 敏感数据脱敏（FR-AUD-02 / 安全合规文档 §8.4）。
/// <para>
/// 规则与文档一致：密码与令牌全掩码，手机号保留前 3 后 4，
/// 邮箱保留首字符与域名。身份证号不入系统，无需处理。
/// </para>
/// <para>
/// **存储的值不改**：库里存的仍是原文（管理员还要能改、能比对），
/// 只在「给人看」的地方（API 响应、日志、审计摘要）脱敏。
/// </para>
/// </summary>
public static class SensitiveDataMasker
{
    /// <summary>全掩码：密码、令牌等（文档里的写法是 <c>***</c>）。</summary>
    public static string? MaskSecret(string? value) =>
        string.IsNullOrEmpty(value) ? value : "***";

    /// <summary>手机号：保留前 3 后 4。</summary>
    public static string? MaskPhone(string? phone)
    {
        if (string.IsNullOrEmpty(phone))
        {
            return phone;
        }

        // 短到「前 3 后 4」会重叠的号码没有可留的部分，全掩码。
        if (phone.Length <= 7)
        {
            return new string('*', phone.Length);
        }

        return $"{phone[..3]}****{phone[^4..]}";
    }

    /// <summary>
    /// 按字段名脱敏：密码与令牌全掩码，手机号前 3 后 4，邮箱保留首字符与域名。
    /// <para>
    /// 判定按字段名**包含**这些词（不区分大小写）——
    /// 审计与日志里出现的是字段名（PasswordHash、TokenHash、Phone、Email）。
    /// </para>
    /// </summary>
    public static object? MaskFieldValue(string? fieldName, object? value)
    {
        if (value is null)
        {
            return null;
        }

        var name = fieldName ?? string.Empty;
        var text = value as string ?? value.ToString();

        if (name.Contains("Password", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Token", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Secret", StringComparison.OrdinalIgnoreCase))
        {
            return MaskSecret(text);
        }

        if (name.Contains("Phone", StringComparison.OrdinalIgnoreCase))
        {
            return MaskPhone(text);
        }

        if (name.Contains("Email", StringComparison.OrdinalIgnoreCase))
        {
            return MaskEmail(text);
        }

        return value;
    }

    /// <summary>邮箱：保留首字符与域名。</summary>
    public static string? MaskEmail(string? email)
    {
        if (string.IsNullOrEmpty(email))
        {
            return email;
        }

        var at = email.IndexOf('@');
        if (at <= 0)
        {
            // 没有域名可留，按全掩码处理。
            return "***";
        }

        return $"{email[..1]}***{email[at..]}";
    }
}
