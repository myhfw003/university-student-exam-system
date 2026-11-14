using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Authoring;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Authoring.Queries;

/// <summary>列出卷型模板。</summary>
public sealed record ListPaperTemplatesQuery(string? Kind, string? Keyword)
    : IAppQuery<PaperTemplateListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperRead];
}

public sealed class ListPaperTemplatesHandler : IRequestHandler<ListPaperTemplatesQuery, PaperTemplateListResponse>
{
    private readonly IPaperTemplateRepository _templates;

    public ListPaperTemplatesHandler(IPaperTemplateRepository templates) => _templates = templates;

    public async Task<PaperTemplateListResponse> Handle(
        ListPaperTemplatesQuery request,
        CancellationToken cancellationToken)
    {
        PaperKind? kind = null;
        if (!string.IsNullOrWhiteSpace(request.Kind))
        {
            kind = PaperKinds.FromStorage(request.Kind)
                ?? throw new BusinessRuleException("试卷形态取值不合法。");
        }

        var templates = await _templates.ListAsync(kind, request.Keyword, cancellationToken);

        return new PaperTemplateListResponse(
            templates.Select(PaperTemplateDtoFactory.ToSummary).ToList(),
            templates.Count);
    }
}

/// <summary>取回卷型模板详情。</summary>
public sealed record GetPaperTemplateQuery(long Id) : IAppQuery<PaperTemplateDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperRead];
}

public sealed class GetPaperTemplateHandler : IRequestHandler<GetPaperTemplateQuery, PaperTemplateDetailDto>
{
    private readonly IPaperTemplateRepository _templates;

    public GetPaperTemplateHandler(IPaperTemplateRepository templates) => _templates = templates;

    public async Task<PaperTemplateDetailDto> Handle(
        GetPaperTemplateQuery request,
        CancellationToken cancellationToken)
    {
        var template = await _templates.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("卷型模板不存在。");

        return PaperTemplateDtoFactory.ToDetail(template);
    }
}
