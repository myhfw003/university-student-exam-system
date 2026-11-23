using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Settings.Contracts;
using Exam.Application.Settings.Services;
using Exam.Domain.Identity;
using Exam.Domain.Settings;
using Exam.Domain.SharedKernel.Abstractions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Settings.Commands;

/// <summary>修改系统级设置。</summary>
public sealed record UpdateSystemSettingsCommand(string MistakeResolutionPolicy)
    : IAppCommand<SystemSettingsDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.SystemConfigure];
}

public sealed class UpdateSystemSettingsCommandValidator : AbstractValidator<UpdateSystemSettingsCommand>
{
    public UpdateSystemSettingsCommandValidator()
    {
        RuleFor(x => x.MistakeResolutionPolicy)
            .NotEmpty().WithMessage("请选择错题处理口径。")
            .Must(value => MistakeResolutionPolicies.FromStorage(value) is not null)
            .WithMessage("错题处理口径不合法。");
    }
}

public sealed class UpdateSystemSettingsHandler : IRequestHandler<UpdateSystemSettingsCommand, SystemSettingsDto>
{
    private readonly ISystemSettingRepository _settings;
    private readonly SystemSettingsResolver _resolver;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdateSystemSettingsHandler(
        ISystemSettingRepository settings,
        SystemSettingsResolver resolver,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _settings = settings;
        _resolver = resolver;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<SystemSettingsDto> Handle(
        UpdateSystemSettingsCommand request,
        CancellationToken cancellationToken)
    {
        // 校验器已经挡掉非法取值，这里再解析一次拿得到确定的枚举。
        var policy = MistakeResolutionPolicies.FromStorage(request.MistakeResolutionPolicy)
            ?? MistakeResolutionPolicies.Default;

        var now = _clock.UtcNow;
        var actorId = _currentUser.UserId;

        var existing = await _settings.GetAsync(
            SystemSettingKeys.MistakeResolutionPolicy,
            cancellationToken);

        if (existing is null)
        {
            existing = SystemSetting.Create(
                SystemSettingKeys.MistakeResolutionPolicy,
                policy.ToStorage(),
                now,
                actorId);
            await _settings.AddAsync(existing, cancellationToken);
        }
        else
        {
            existing.SetValue(policy.ToStorage(), now, actorId);
            _settings.Update(existing);
        }

        await _audit.RecordAsync(
            "settings.update",
            "system_setting",
            SystemSettingKeys.MistakeResolutionPolicy,
            new Dictionary<string, object?>
            {
                ["key"] = SystemSettingKeys.MistakeResolutionPolicy,
                ["value"] = policy.ToStorage(),
            },
            cancellationToken);

        var originalPasswordHash = await _resolver.GetOriginalPasswordHashAsync(cancellationToken);

        return new SystemSettingsDto(
            policy.ToStorage(),
            originalPasswordHash is not null,
            now,
            actorId);
    }
}
