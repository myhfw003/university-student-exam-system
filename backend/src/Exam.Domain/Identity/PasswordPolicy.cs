namespace Exam.Domain.Identity;

/// <summary>密码强度规则。</summary>
public static class PasswordPolicy
{
    public const int MinLength = 8;
    public const int MaxLength = 128;

    /// <summary>返回违规项列表；空列表表示通过。</summary>
    public static IReadOnlyList<string> Validate(string? password, string? username)
    {
        var failures = new List<string>();

        if (string.IsNullOrEmpty(password) || password.Length < MinLength)
        {
            failures.Add($"密码长度不能少于 {MinLength} 位。");
        }

        if (password is { Length: > MaxLength })
        {
            failures.Add($"密码长度不能超过 {MaxLength} 位。");
        }

        if (!string.IsNullOrEmpty(password))
        {
            if (!password.Any(char.IsAsciiLetter))
            {
                failures.Add("密码必须包含字母。");
            }

            if (!password.Any(char.IsAsciiDigit))
            {
                failures.Add("密码必须包含数字。");
            }
        }

        if (!string.IsNullOrEmpty(password) && !string.IsNullOrEmpty(username)
            && password.Contains(username, StringComparison.OrdinalIgnoreCase))
        {
            failures.Add("密码不能包含账号。");
        }

        return failures;
    }
}
