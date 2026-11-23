using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using Exam.Domain.Settings;
using Exam.Domain.SharedKernel.Abstractions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Settings.Commands;

/// <summary>
/// 设置系统级的**原始密码**：管理员重置用户密码时置成它。
/// <para>
/// **只写不回显**：这个值存的是哈希，明文用完即弃，接口不提供读回，
/// 管理端只看得到「有没有配置」。
/// </para>
/// </summary>
public sealed record SetOriginalPasswordCommand(string Password)
    : IAppCommand, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.SystemConfigure];
}

/// <summary>
/// 清除原始密码：此后重置密码会被拒绝（没有可置成的目标）。
/// </summary>
public sealed record ClearOriginalPasswordCommand : IAppCommand, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.SystemConfigure];
}

public sealed class SetOriginalPasswordCommandValidator : AbstractValidator<SetOriginalPasswordCommand>
{
    public SetOriginalPasswordCommandValidator()
    {
        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("请填写原始密码。")
            // 强度规则与用户密码一致（长度、字母、数字）。
            // 「不得包含账号」这一条不适用：原始密码是全系统一个值，没有对应的账号。
            .Custom((value, context) =>
            {
                foreach (var failure in PasswordPolicy.Validate(value, username: null))
                {
                    context.AddFailure(failure);
                }
            });
    }
}

/// <summary>设置原始密码。存的是哈希，明文不留痕。</summary>
public sealed class SetOriginalPasswordHandler : IRequestHandler<SetOriginalPasswordCommand, Unit>
{
    private readonly ISystemSettingRepository _settings;
    private readonly IPasswordVerifier _passwordVerifier;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public SetOriginalPasswordHandler(
        ISystemSettingRepository settings,
        IPasswordVerifier passwordVerifier,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _settings = settings;
        _passwordVerifier = passwordVerifier;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<Unit> Handle(
        SetOriginalPasswordCommand request,
        CancellationToken cancellationToken)
    {
        var now = _clock.UtcNow;
        var actorId = _currentUser.UserId;

        // 只存哈希：明文在这一刻之后就不存在了——不回显、不进日志、库里也读不出来。
        var hash = _passwordVerifier.Hash(request.Password);

        var existing = await _settings.GetAsync(
            SystemSettingKeys.OriginalPasswordHash,
            cancellationToken);

        if (existing is null)
        {
            await _settings.AddAsync(
                SystemSetting.Create(SystemSettingKeys.OriginalPasswordHash, hash, now, actorId),
                cancellationToken);
        }
        else
        {
            existing.SetValue(hash, now, actorId);
            _settings.Update(existing);
        }

        // 审计只记「配了」，不记值。
        await _audit.RecordAsync(
            "settings.original_password",
            "system_setting",
            SystemSettingKeys.OriginalPasswordHash,
            new Dictionary<string, object?>
            {
                ["key"] = SystemSettingKeys.OriginalPasswordHash,
                ["configured"] = true,
            },
            cancellationToken);

        return Unit.Value;
    }
}

/// <summary>清除原始密码。走软删除：同一个键之后还能再配一次。</summary>
public sealed class ClearOriginalPasswordHandler : IRequestHandler<ClearOriginalPasswordCommand, Unit>
{
    private readonly ISystemSettingRepository _settings;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ClearOriginalPasswordHandler(
        ISystemSettingRepository settings,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _settings = settings;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<Unit> Handle(
        ClearOriginalPasswordCommand request,
        CancellationToken cancellationToken)
    {
        var now = _clock.UtcNow;
        var actorId = _currentUser.UserId;

        var existing = await _settings.GetAsync(
            SystemSettingKeys.OriginalPasswordHash,
            cancellationToken);

        if (existing is not null)
        {
            existing.SoftDelete(now, actorId);
            _settings.Update(existing);
        }

        await _audit.RecordAsync(
            "settings.original_password_clear",
            "system_setting",
            SystemSettingKeys.OriginalPasswordHash,
            new Dictionary<string, object?>
            {
                ["key"] = SystemSettingKeys.OriginalPasswordHash,
                ["configured"] = false,
            },
            cancellationToken);

        return Unit.Value;
    }
}
