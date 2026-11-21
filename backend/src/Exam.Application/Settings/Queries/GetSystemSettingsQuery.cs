using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Settings.Contracts;
using Exam.Application.Settings.Services;
using Exam.Domain.Identity;
using Exam.Domain.Settings;
using MediatR;

namespace Exam.Application.Settings.Queries;

/// <summary>读取系统级设置。</summary>
public sealed record GetSystemSettingsQuery : IAppQuery<SystemSettingsDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.SystemConfigure];
}

public sealed class GetSystemSettingsHandler : IRequestHandler<GetSystemSettingsQuery, SystemSettingsDto>
{
    private readonly ISystemSettingRepository _settings;
    private readonly SystemSettingsResolver _resolver;

    public GetSystemSettingsHandler(
        ISystemSettingRepository settings,
        SystemSettingsResolver resolver)
    {
        _settings = settings;
        _resolver = resolver;
    }

    public async Task<SystemSettingsDto> Handle(
        GetSystemSettingsQuery request,
        CancellationToken cancellationToken)
    {
        var policy = await _resolver.GetMistakeResolutionPolicyAsync(cancellationToken);
        var row = await _settings.GetAsync(
            SystemSettingKeys.MistakeResolutionPolicy,
            cancellationToken);

        return new SystemSettingsDto(
            policy.ToStorage(),
            row?.UpdatedAt,
            row?.UpdatedBy);
    }
}
