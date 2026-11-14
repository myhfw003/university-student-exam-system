using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Contracts;

/// <summary>导入批次的字段级错误。</summary>
public sealed record ImportRowErrorDto(string Field, string Reason);

/// <summary>导入批次中的一行。</summary>
public sealed record ImportRowDto(
    int RowNumber,
    bool Valid,
    IReadOnlyList<ImportRowErrorDto> Errors,
    string? Parsed);

/// <summary>导入批次概览。</summary>
public sealed record ImportBatchDto(
    long Id,
    string FileName,
    string FileType,
    string Status,
    int TotalRows,
    int ValidRows,
    int InvalidRows,
    int AdoptedCount,
    IReadOnlyDictionary<string, string> ColumnMapping,
    long? AdoptedBy,
    DateTimeOffset? AdoptedAt,
    DateTimeOffset CreatedAt);

/// <summary>导入批次详情，含逐行结果。</summary>
public sealed record ImportBatchDetailDto(ImportBatchDto Batch, IReadOnlyList<ImportRowDto> Rows);

/// <summary>分页的导入批次列表。</summary>
public sealed record ImportBatchListResponse(
    IReadOnlyList<ImportBatchDto> Items,
    int Total,
    int Page,
    int Size);

/// <summary>采纳时跳过的行。</summary>
public sealed record ImportAdoptFailure(int RowNumber, string Reason);

/// <summary>采纳结果。重复采纳是幂等的。</summary>
public sealed record ImportAdoptResult(
    long BatchId,
    string Status,
    int Adopted,
    IReadOnlyList<ImportAdoptFailure> Failures,
    bool AlreadyAdopted);
