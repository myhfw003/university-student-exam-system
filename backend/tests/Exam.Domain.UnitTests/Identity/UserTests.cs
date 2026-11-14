using Exam.Domain.Identity;
using Exam.Domain.Identity.Events;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Identity;

/// <summary>
/// 测试用密码验证器：只做规则校验，不做真实哈希。
/// </summary>
internal sealed class FakePasswordVerifier : IPasswordVerifier
{
    public string Hash(string password) => $"fake:${password}";

    public PasswordVerificationResult Verify(string password, string passwordHash) =>
        passwordHash == $"fake:{password}"
            ? PasswordVerificationResult.Success
            : PasswordVerificationResult.Failed;
    public string GenerateInitialPassword() => "InitPassw0rd";

}

public sealed class UserTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 3, 0, 0, TimeSpan.Zero);

    private static User NewUser(string username = "zhangsan", string password = "Passw0rd!") =>
        User.Register(username, "张三", $"fake:{password}", Now);

    [Fact]
    public void Register_账号格式非法_抛业务异常()
    {
        var act = () => User.Register("ab", "张三", "fake:Passw0rd!", Now);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.BusinessRuleViolated);
    }

    [Fact]
    public void Register_姓名为空_抛业务异常()
    {
        var act = () => User.Register("zhangsan", "  ", "fake:Passw0rd!", Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void Register_成功_产生注册事件且状态为可用()
    {
        var user = NewUser();

        user.Status.ShouldBe(UserStatus.Active);
        user.Username.ShouldBe("zhangsan");
        user.DomainEvents.ShouldHaveSingleItem().ShouldBeOfType<UserRegistered>();
    }

    [Fact]
    public void Authenticate_密码正确_清零失败计数并记录登录时间()
    {
        var user = NewUser();
        user.Authenticate("Passw0rd!", new FakePasswordVerifier(), Now);

        user.FailedLoginCount.ShouldBe(0);
        user.LastLoginAt.ShouldBe(Now);
        user.DomainEvents.ShouldContain(e => e is UserAuthenticated);
    }

    [Fact]
    public void Authenticate_密码错误_累计失败次数并抛异常()
    {
        var user = NewUser();

        var act = () => user.Authenticate("wrong", new FakePasswordVerifier(), Now);

        act.ShouldThrow<BusinessRuleException>();
        user.FailedLoginCount.ShouldBe(1);
    }

    [Fact]
    public void Authenticate_连续五次失败_账号被锁定()
    {
        var user = NewUser();

        for (var i = 0; i < 5; i++)
        {
            Should.Throw<BusinessRuleException>(() => user.Authenticate("wrong", new FakePasswordVerifier(), Now));
        }

        user.Status.ShouldBe(UserStatus.Locked);
        user.LockedUntil.ShouldBe(Now.Add(User.LockoutDuration));
        user.IsLocked(Now).ShouldBeTrue();
    }

    [Fact]
    public void Authenticate_锁定期间_拒绝登录()
    {
        var user = NewUser();
        for (var i = 0; i < 5; i++)
        {
            Should.Throw<BusinessRuleException>(() => user.Authenticate("wrong", new FakePasswordVerifier(), Now));
        }

        var act = () => user.Authenticate("Passw0rd!", new FakePasswordVerifier(), Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void Authenticate_账号已禁用_拒绝登录()
    {
        var user = NewUser();
        user.Disable("违规", Now);

        var act = () => user.Authenticate("Passw0rd!", new FakePasswordVerifier(), Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void ChangePassword_原密码错误_抛异常且不修改密码()
    {
        var user = NewUser();
        var originalHash = user.PasswordHash;

        var act = () => user.ChangePassword("wrong", "NewPassw0rd!", new FakePasswordVerifier(), Now);

        act.ShouldThrow<BusinessRuleException>();
        user.PasswordHash.ShouldBe(originalHash);
    }

    [Fact]
    public void ChangePassword_新密码不符合策略_抛异常()
    {
        var user = NewUser();

        var act = () => user.ChangePassword("Passw0rd!", "short", new FakePasswordVerifier(), Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void ResetPassword_要求下次登录修改密码()
    {
        var user = NewUser();

        user.ResetPassword("Admin@12345", new FakePasswordVerifier(), Now);

        user.MustChangePassword.ShouldBeTrue();
        user.DomainEvents.ShouldContain(e => e is UserPasswordChanged);
    }

    [Fact]
    public void Disable_产生禁用事件()
    {
        var user = NewUser();

        user.Disable("违规", Now);

        user.Status.ShouldBe(UserStatus.Disabled);
        user.DomainEvents.ShouldContain(e => e is UserDisabled);
    }

    [Fact]
    public void MarkMustChangePassword_标记下次登录必须改密()
    {
        var user = NewUser();

        user.MarkMustChangePassword(Now);

        user.MustChangePassword.ShouldBeTrue();
    }

    [Fact]
    public void ChangeProfile_一次性更新姓名邮箱与手机号()
    {
        var user = NewUser();

        user.ChangeProfile("李四", "lisi@example.edu", "13800000000", Now);

        user.DisplayName.ShouldBe("李四");
        user.Email.ShouldBe("lisi@example.edu");
        user.Phone.ShouldBe("13800000000");
    }

    [Fact]
    public void ChangeProfile_空邮箱存为null()
    {
        var user = NewUser();

        user.ChangeProfile("李四", "  ", null, Now);

        user.Email.ShouldBeNull();
        user.Phone.ShouldBeNull();
    }

    [Fact]
    public void Enable_解除锁定并清零失败计数()
    {
        var user = NewUser();
        for (var i = 0; i < 5; i++)
        {
            Should.Throw<BusinessRuleException>(() => user.Authenticate("wrong", new FakePasswordVerifier(), Now));
        }

        user.Enable(Now);

        user.Status.ShouldBe(UserStatus.Active);
        user.FailedLoginCount.ShouldBe(0);
    }
}
