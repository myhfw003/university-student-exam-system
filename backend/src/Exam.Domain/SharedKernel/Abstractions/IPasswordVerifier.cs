namespace Exam.Domain.SharedKernel.Abstractions;

/// <summary>密码哈希验证抽象。实现位于 Infrastructure（PBKDF2），领域层保持零依赖。</summary>
public interface IPasswordVerifier
{
    string Hash(string password);

    PasswordVerificationResult Verify(string password, string passwordHash);

    /// <summary>生成满足强度要求的随机初始密码。管理员发放给用户时使用。</summary>
    string GenerateInitialPassword();
}

public enum PasswordVerificationResult
{
    /// <summary>密码正确。</summary>
    Success,

    /// <summary>密码正确，但使用了过时的哈希参数，应在下次登录时重算。</summary>
    SuccessRehashNeeded,

    /// <summary>密码错误。</summary>
    Failed,
}
