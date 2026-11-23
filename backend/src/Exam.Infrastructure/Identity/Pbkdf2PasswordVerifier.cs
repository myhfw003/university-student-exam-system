using System.Security.Cryptography;
using System.Text;
using Exam.Domain.SharedKernel.Abstractions;

namespace Exam.Infrastructure.Identity;

/// <summary>
/// PBKDF2-HMAC-SHA256 密码哈希。格式：<c>$pbkdf2-sha256$&lt;iterations&gt;$&lt;salt&gt;$&lt;hash&gt;</c>。
/// 参数升级后，验证会返回 SuccessRehashNeeded，由领域层在登录成功时顺带重算。
/// </summary>
public sealed class Pbkdf2PasswordVerifier : IPasswordVerifier
{
    private const int DefaultIterations = 100_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;
    private const string Prefix = "$pbkdf2-sha256$";

    public string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);

        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            DefaultIterations,
            HashAlgorithmName.SHA256,
            HashSize);

        return $"{Prefix}{DefaultIterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public PasswordVerificationResult Verify(string password, string passwordHash)
    {
        if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(passwordHash))
        {
            return PasswordVerificationResult.Failed;
        }

        if (!passwordHash.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return PasswordVerificationResult.Failed;
        }

        var parts = passwordHash.Split('$', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 4 || !int.TryParse(parts[1], out var iterations) || iterations <= 0)
        {
            return PasswordVerificationResult.Failed;
        }

        byte[] salt;
        byte[] expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return PasswordVerificationResult.Failed;
        }

        var actual = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            iterations,
            HashAlgorithmName.SHA256,
            expected.Length);

        var matched = CryptographicOperations.FixedTimeEquals(actual, expected);
        if (!matched)
        {
            return PasswordVerificationResult.Failed;
        }

        return iterations < DefaultIterations
            ? PasswordVerificationResult.SuccessRehashNeeded
            : PasswordVerificationResult.Success;
    }

    /// <summary>生成随机密码。长度 16 位，字符集去掉了易混淆字符。</summary>
    public static string GenerateRandomPassword()
    {
        const string alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var bytes = RandomNumberGenerator.GetBytes(16);
        var builder = new StringBuilder(16);
        foreach (var b in bytes)
        {
            builder.Append(alphabet[b % alphabet.Length]);
        }

        return builder.ToString();
    }
}
