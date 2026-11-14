using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Catalog.Queries;

/// <summary>取回导入批次详情，含逐行结果。</summary>
public sealed record GetImportBatchQuery(long Id) : IAppQuery<ImportBatchDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ImportRun];
}

public sealed class GetImportBatchHandler : IRequestHandler<GetImportBatchQuery, ImportBatchDetailDto>
{
    private readonly IImportBatchRepository _batches;

    public GetImportBatchHandler(IImportBatchRepository batches) => _batches = batches;

    public async Task<ImportBatchDetailDto> Handle(
        GetImportBatchQuery request,
        CancellationToken cancellationToken)
    {
        var batch = await _batches.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("导入批次不存在。");

        return ImportBatchDtoFactory.ToDetail(batch);
    }
}

/// <summary>分页查询导入批次。</summary>
public sealed record ListImportBatchesQuery(int Page, int Size)
    : IAppQuery<ImportBatchListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ImportRun];
}

public sealed class ListImportBatchesHandler : IRequestHandler<ListImportBatchesQuery, ImportBatchListResponse>
{
    private readonly IImportBatchRepository _batches;

    public ListImportBatchesHandler(IImportBatchRepository batches) => _batches = batches;

    public async Task<ImportBatchListResponse> Handle(
        ListImportBatchesQuery request,
        CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 200);

        var total = await _batches.CountAsync(cancellationToken);
        var batches = await _batches.ListAsync((page - 1) * size, size, cancellationToken);

        return new ImportBatchListResponse(
            batches.Select(ImportBatchDtoFactory.ToSummary).ToList(),
            total,
            page,
            size);
    }
}
