using Exam.Application.Common.Interfaces;
using Exam.Application.Identity.Commands;
using Exam.Application.Settings.Services;
using Exam.Application.UnitTests.Identity;
using Exam.Domain.Identity;
using Exam.Domain.Settings;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Identity;

public sealed class UserManagementHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 2, 0, 0, TimeSpan.Zero);

    private readonly IUserRepository _users = Substitute.For<IUserRepository>();
    private readonly IUserRoleRepository _userRoles = Substitute.For<IUserRoleRepository>();
    private readonly IRoleRepository _roles = Substitute.For<IRoleRepository>();
    private readonly IPermissionProvider _permissions = Substitute.For<IPermissionProvider>();
    private readonly IPasswordVerifier _passwordVerifier = new StubPasswordVerifier();
    private readonly IRefreshTokenRepository _refreshTokens = Substitute.For<IRefreshTokenRepository>();
    private readonly ITokenBlacklist _blacklist = Substitute.For<ITokenBlacklist>();
    private readonly ISystemSettingRepository _settings = Substitute.For<ISystemSettingRepository>();
    private readonly IAuditRecorder _audit = Substitute.For<IAuditRecorder>();
    private readonly IUnitOfWork _unitOfWork = Substitute.For<IUnitOfWork>();
    private readonly IClock _clock = new FixedClock(Now);
    private readonly ICurrentUser _currentUser = Substitute.For<ICurrentUser>();

    private CreateUserHandler CreateUser() =>
        new(_users, _userRoles, _roles, _permissions, _passwordVerifier,
            new SystemSettingsResolver(_settings), _unitOfWork, _audit, _clock, _currentUser);

    private UpdateUserHandler UpdateUser() =>
        new(_users, _userRoles, _roles, _permissions, _refreshTokens, _blacklist, _audit, _clock, _currentUser);

    private ResetUserPasswordHandler ResetPassword() =>
        new(_users, new SystemSettingsResolver(_settings), _refreshTokens, _blacklist, _audit, _clock, _currentUser);

    private AssignUserRolesHandler AssignRoles() =>
        new(_users, _userRoles, _roles, _permissions, _unitOfWork, _audit, _clock, _currentUser);

    [Fact]
    public async Task 新建用户_账号已被占用时报错()
    {
        _users.GetByUsernameAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(User.Register("zhangsan", "张三", "hash", Now));

        var act = async () => await CreateUser().Handle(
            new CreateUserCommand("zhangsan", "张三", "Passw0rd!", null, null, []),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<DuplicateCodeException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.DuplicateCode);
    }

    [Fact]
    public async Task 新建用户_密码不合规时报错并给出违规项()
    {
        _users.GetByUsernameAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((User?)null);

        var act = async () => await CreateUser().Handle(
            new CreateUserCommand("zhangsan", "张三", "short", null, null, []),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<BusinessRuleException>();
        ex.Errors.ShouldContainKey("password");
    }

    [Fact]
    public async Task 新建用户_未指定密码时置为系统设定的原始密码并要求改密()
    {
        _users.GetByUsernameAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((User?)null);
        GivenOriginalPasswordHash("hash-of-original");

        User? added = null;
        _users.When(x => x.AddAsync(Arg.Any<User>(), Arg.Any<CancellationToken>()))
            .Do(call => added = call.Arg<User>());

        var result = await CreateUser().Handle(
            new CreateUserCommand("zhangsan", "张三", null, null, null, []),
            CancellationToken.None);

        result.User.MustChangePassword.ShouldBeTrue();
        result.User.Username.ShouldBe("zhangsan");
        // 置的就是系统设定的那份哈希：没有第二个来源。
        added!.PasswordHash.ShouldBe("hash-of-original");
    }

    [Fact]
    public async Task 新建用户_没配原始密码时报错()
    {
        _users.GetByUsernameAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((User?)null);
        GivenOriginalPasswordHash(null);

        var act = async () => await CreateUser().Handle(
            new CreateUserCommand("zhangsan", "张三", null, null, null, []),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<OriginalPasswordNotConfiguredException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.OriginalPasswordNotConfigured);
    }

    [Fact]
    public async Task 禁用用户_立即吊销刷新令牌与已签发的访问令牌()
    {
        var user = User.Register("zhangsan", "张三", "hash", Now);
        _users.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(user);
        _userRoles.GetRoleIdsAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(new long[] { 1 });

        await UpdateUser().Handle(
            new UpdateUserCommand(1, "张三", null, null, "disabled", "违规"),
            CancellationToken.None);

        user.Status.ShouldBe(UserStatus.Disabled);
        await _refreshTokens.Received(1).RevokeAllForUserAsync(
            1, RefreshTokenRevokeReason.UserDisabled, Now, Arg.Any<CancellationToken>());
        await _blacklist.Received(1).RevokeUserAsync(1, Now, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task 启用用户_恢复为可用状态()
    {
        var user = User.Register("zhangsan", "张三", "hash", Now);
        user.Disable("违规", Now);
        _users.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(user);
        _userRoles.GetRoleIdsAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(Array.Empty<long>());

        await UpdateUser().Handle(
            new UpdateUserCommand(1, "张三", null, null, "active", null),
            CancellationToken.None);

        user.Status.ShouldBe(UserStatus.Active);
    }

    [Fact]
    public async Task 重置密码_置为系统设定的原始密码且旧令牌立即失效()
    {
        var user = User.Register("zhangsan", "张三", "hash", Now);
        _users.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(user);
        GivenOriginalPasswordHash("hash-of-original");

        var result = await ResetPassword().Handle(
            new ResetUserPasswordCommand(1),
            CancellationToken.None);

        user.PasswordHash.ShouldBe("hash-of-original");
        user.MustChangePassword.ShouldBeTrue();
        result.UserId.ShouldBe(user.Id);
        await _blacklist.Received(1).RevokeUserAsync(1, Now, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task 重置密码_没配原始密码时报错()
    {
        var user = User.Register("zhangsan", "张三", "hash", Now);
        _users.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(user);
        GivenOriginalPasswordHash(null);

        var act = async () => await ResetPassword().Handle(
            new ResetUserPasswordCommand(1),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<OriginalPasswordNotConfiguredException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.OriginalPasswordNotConfigured);
    }

    private void GivenOriginalPasswordHash(string? hash)
    {
        var setting = hash is null
            ? null
            : SystemSetting.Create(SystemSettingKeys.OriginalPasswordHash, hash, Now, null);

        _settings
            .GetAsync(SystemSettingKeys.OriginalPasswordHash, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<SystemSetting?>(setting));
    }

    [Fact]
    public async Task 分配角色_覆盖旧角色并失效权限缓存()
    {
        var user = User.Register("zhangsan", "张三", "hash", Now);
        var oldRole = Role.CreateSystem("student", "在校学生", Now);
        var newRole = Role.CreateSystem("grader_teacher", "阅卷教师", Now);

        _users.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(user);
        _roles.GetByIdAsync(1, Arg.Any<CancellationToken>()).Returns(oldRole);
        _roles.GetByIdAsync(2, Arg.Any<CancellationToken>()).Returns(newRole);
        _userRoles.GetByUserAsync(Arg.Any<long>(), Arg.Any<CancellationToken>())
            .Returns(new[] { UserRole.Create(1, 1, null, Now) });

        var result = await AssignRoles().Handle(
            new AssignUserRolesCommand(1, new long[] { 2 }),
            CancellationToken.None);

        result.RoleIds.ShouldBe(new long[] { 2 });
        _userRoles.Received(1).Remove(Arg.Any<UserRole>());
        await _userRoles.Received(1).AddAsync(Arg.Any<UserRole>(), Arg.Any<CancellationToken>());
        await _permissions.Received(1).InvalidateAsync(1, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task 分配角色_角色不存在时报错()
    {
        var user = User.Register("zhangsan", "张三", "hash", Now);
        _users.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(user);
        _roles.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns((Role?)null);

        var act = async () => await AssignRoles().Handle(
            new AssignUserRolesCommand(1, new long[] { 99 }),
            CancellationToken.None);

        await act.ShouldThrowAsync<BusinessRuleException>();
    }
}
