using Exam.Domain.Identity.Events;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Identity;

/// <summary>
/// 用户聚合根。承载登录名、密码、状态与锁定策略。
/// 组织归属不在本聚合内，由 user_tag 关联表与组织维度标签表达。
/// </summary>
public sealed class User : AuditableEntity
{
    public const int MaxFailedLoginCount = 5;

    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    private User()
    {
    }

    private User(string username, string displayName, string passwordHash, DateTimeOffset now, long? actorId)
        : base(now, actorId)
    {
        Username = username;
        DisplayName = displayName;
        PasswordHash = passwordHash;
        Status = UserStatus.Active;
    }

    public string Username { get; private set; } = string.Empty;

    public string DisplayName { get; private set; } = string.Empty;

    public string PasswordHash { get; private set; } = string.Empty;

    public string? Email { get; private set; }

    public string? Phone { get; private set; }

    public UserStatus Status { get; private set; }

    public bool MustChangePassword { get; private set; }

    public int FailedLoginCount { get; private set; }

    public DateTimeOffset? LockedUntil { get; private set; }

    public DateTimeOffset? LastLoginAt { get; private set; }

    public bool IsLocked(DateTimeOffset now) =>
        Status == UserStatus.Locked && LockedUntil.HasValue && LockedUntil.Value > now;

    public static User Register(
        string username,
        string displayName,
        string passwordHash,
        DateTimeOffset now,
        long? actorId = null)
    {
        if (!UsernamePolicy.IsValid(username))
        {
            throw new BusinessRuleException(
                $"账号格式不正确：{UsernamePolicy.MinLength} 到 {UsernamePolicy.MaxLength} 位，允许字母、数字、下划线、点和中划线。");
        }

        if (string.IsNullOrWhiteSpace(displayName))
        {
            throw new BusinessRuleException("姓名不能为空。");
        }

        if (string.IsNullOrWhiteSpace(passwordHash))
        {
            throw new BusinessRuleException("密码不能为空。");
        }

        var user = new User(UsernamePolicy.Normalize(username), displayName.Trim(), passwordHash, now, actorId);
        user.AddDomainEvent(new UserRegistered(user.Id, user.Username));
        return user;
    }

    /// <summary>
    /// 校验密码并维护登录失败计数与锁定状态。
    /// 密码错误时抛出 <see cref="BusinessRuleException"/>，消息不区分"账号不存在"与"密码错误"。
    /// </summary>
    public void Authenticate(
        string password,
        IPasswordVerifier verifier,
        DateTimeOffset now,
        long? actorId = null)
    {
        if (Status == UserStatus.Disabled)
        {
            throw new BusinessRuleException("账号已被禁用，请联系管理员。");
        }

        if (IsLocked(now))
        {
            throw new BusinessRuleException("账号已被锁定，请稍后再试。");
        }

        var result = verifier.Verify(password, PasswordHash);

        if (result == PasswordVerificationResult.Failed)
        {
            FailedLoginCount++;
            if (FailedLoginCount >= MaxFailedLoginCount)
            {
                Status = UserStatus.Locked;
                LockedUntil = now.Add(LockoutDuration);
            }

            Touch(now, actorId);
            AddDomainEvent(new UserAuthenticationFailed(Username, "密码错误"));
            throw new BusinessRuleException("账号或密码错误。");
        }

        if (Status == UserStatus.Locked)
        {
            // 锁定已到期，自动解锁并继续。
            Status = UserStatus.Active;
            LockedUntil = null;
        }

        FailedLoginCount = 0;
        LastLoginAt = now;

        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            PasswordHash = verifier.Hash(password);
        }

        Touch(now, actorId);
        AddDomainEvent(new UserAuthenticated(Id, Username));
    }

    public void ChangePassword(
        string currentPassword,
        string newPassword,
        IPasswordVerifier verifier,
        DateTimeOffset now,
        long? actorId = null)
    {
        var verifyResult = verifier.Verify(currentPassword, PasswordHash);
        if (verifyResult == PasswordVerificationResult.Failed)
        {
            throw new BusinessRuleException("当前密码不正确。");
        }

        var failures = PasswordPolicy.Validate(newPassword, Username);
        if (failures.Count > 0)
        {
            throw new BusinessRuleException("密码不符合要求。", new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                ["password"] = failures.ToArray(),
            });
        }

        PasswordHash = verifier.Hash(newPassword);
        MustChangePassword = false;
        Touch(now, actorId);
        AddDomainEvent(new UserPasswordChanged(Id));
    }

    /// <summary>管理员重置密码。重置后用户下次登录必须修改密码。</summary>
    public void ResetPassword(
        string newPassword,
        IPasswordVerifier verifier,
        DateTimeOffset now,
        long? actorId = null)
    {
        var failures = PasswordPolicy.Validate(newPassword, Username);
        if (failures.Count > 0)
        {
            throw new BusinessRuleException("密码不符合要求。", new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                ["password"] = failures.ToArray(),
            });
        }

        PasswordHash = verifier.Hash(newPassword);
        MustChangePassword = true;
        FailedLoginCount = 0;
        Status = UserStatus.Active;
        LockedUntil = null;
        Touch(now, actorId);
        AddDomainEvent(new UserPasswordChanged(Id));
    }

    public void ChangeDisplayName(string displayName, DateTimeOffset now, long? actorId = null)
    {
        if (string.IsNullOrWhiteSpace(displayName))
        {
            throw new BusinessRuleException("姓名不能为空。");
        }

        DisplayName = displayName.Trim();
        Touch(now, actorId);
    }

    /// <summary>一次性更新姓名、邮箱与手机号。</summary>
    public void ChangeProfile(
        string displayName,
        string? email,
        string? phone,
        DateTimeOffset now,
        long? actorId = null)
    {
        ChangeDisplayName(displayName, now, actorId);
        ChangeEmail(email, now, actorId);
        ChangePhone(phone, now, actorId);
    }

    public void ChangeEmail(string? email, DateTimeOffset now, long? actorId = null)
    {
        Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
        Touch(now, actorId);
    }

    public void ChangePhone(string? phone, DateTimeOffset now, long? actorId = null)
    {
        Phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
        Touch(now, actorId);
    }

    /// <summary>标记为「下次登录必须修改密码」。用于发放随机初始密码的场景。</summary>
    public void MarkMustChangePassword(DateTimeOffset now, long? actorId = null)
    {
        MustChangePassword = true;
        Touch(now, actorId);
    }

    public void Disable(string reason, DateTimeOffset now, long? actorId = null)
    {
        if (Status == UserStatus.Disabled)
        {
            return;
        }

        Status = UserStatus.Disabled;
        Touch(now, actorId);
        AddDomainEvent(new UserDisabled(Id, reason));
    }

    public void Enable(DateTimeOffset now, long? actorId = null)
    {
        Status = UserStatus.Active;
        FailedLoginCount = 0;
        LockedUntil = null;
        Touch(now, actorId);
    }

    /// <summary>解除锁定（管理员操作或锁定到期后首次成功登录）。</summary>
    public void Unlock(DateTimeOffset now, long? actorId = null)
    {
        if (Status != UserStatus.Locked)
        {
            return;
        }

        Status = UserStatus.Active;
        FailedLoginCount = 0;
        LockedUntil = null;
        Touch(now, actorId);
    }
}
