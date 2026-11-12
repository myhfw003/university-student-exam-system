namespace Exam.Domain.Identity;

/// <summary>
/// 账号规则。账号不限定为学号：在校学生可用学号，社会人士可自选。
/// </summary>
public static class UsernamePolicy
{
    public const int MinLength = 4;
    public const int MaxLength = 32;

    public static bool IsValid(string? username)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return false;
        }

        var trimmed = username.Trim();
        if (trimmed.Length is < MinLength or > MaxLength)
        {
            return false;
        }

        foreach (var ch in trimmed)
        {
            var ok = char.IsAsciiLetterOrDigit(ch) || ch is '_' or '.' or '-';
            if (!ok)
            {
                return false;
            }
        }

        return true;
    }

    public static string Normalize(string username) => username.Trim();
}
