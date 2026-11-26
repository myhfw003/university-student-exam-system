using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Services;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Catalog.Queries;

/// <summary>
/// 列出可用的 AI 供应商与可切换的模型。
/// <para>
/// 界面靠它渲染「供应商 / 模型」下拉。没配 API Key 的供应商也会列出来，
/// 只是 <c>configured</c> 为 false——老师一眼能看出是配置没配，而不是功能没有。
/// </para>
/// </summary>
public sealed record ListAiProvidersQuery : IAppQuery<AiProviderListDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AiGenerate];
}

public sealed class ListAiProvidersHandler : IRequestHandler<ListAiProvidersQuery, AiProviderListDto>
{
    private readonly IEnumerable<IQuestionGenerationProvider> _providers;

    public ListAiProvidersHandler(IEnumerable<IQuestionGenerationProvider> providers) =>
        _providers = providers;

    public Task<AiProviderListDto> Handle(
        ListAiProvidersQuery request,
        CancellationToken cancellationToken)
    {
        var providers = _providers
            .Select(p => new AiProviderDto(
                p.Name,
                p.DisplayName,
                p.IsConfigured,
                p.DefaultModel,
                p.Models))
            .ToList();

        return Task.FromResult(new AiProviderListDto(providers));
    }
}
