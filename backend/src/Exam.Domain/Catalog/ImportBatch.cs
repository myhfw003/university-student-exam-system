using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Catalog;

/// <summary>导入文件类型。</summary>
public enum ImportFileType
{
    Csv,
    Xlsx,
}

/// <summary>导入批次状态。</summary>
public enum ImportStatus
{
    /// <summary>已解析，等待采纳。</summary>
    Parsed,

    /// <summary>已采纳为候选题。</summary>
    Adopted,

    /// <summary>解析失败。</summary>
    Failed,
}

/// <summary>导入行的一条校验错误。</summary>
public sealed record ImportRowError(string Field, string Reason);

/// <summary>
/// 导入批次聚合根。
/// <para>
/// 批次记录「文件 → 列映射 → 逐行结果 → 采纳」的完整链路，便于事后追溯
/// 一批题是从哪个文件、哪套列映射来的。
/// </para>
/// </summary>
public sealed class ImportBatch : AuditableEntity, IAuditedEntity
{
    private readonly List<ImportRow> _rows = [];

    private ImportBatch()
    {
    }

    private ImportBatch(
        string fileName,
        ImportFileType fileType,
        DateTimeOffset now,
        long operatorId)
        : base(now, operatorId)
    {
        FileName = fileName;
        FileType = fileType;
        OperatorId = operatorId;
        Status = ImportStatus.Parsed;
    }

    public string FileName { get; private set; } = string.Empty;

    public ImportFileType FileType { get; private set; }

    /// <summary>目标字段 → 源列名。</summary>
    public IReadOnlyDictionary<string, string> ColumnMapping { get; private set; } =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public ImportStatus Status { get; private set; }

    public int TotalRows { get; private set; }

    public int ValidRows { get; private set; }

    public int InvalidRows { get; private set; }

    public int AdoptedCount { get; private set; }

    public long OperatorId { get; private set; }

    /// <summary>
    /// 原始文件在对象存储中的键。
    /// <para>调整列映射需要重新解析，所以文件必须留着。</para>
    /// </summary>
    public string? ObjectKey { get; private set; }

    public long? AdoptedBy { get; private set; }

    public DateTimeOffset? AdoptedAt { get; private set; }

    /// <summary>逐行结果。</summary>
    public IReadOnlyCollection<ImportRow> Rows => _rows.AsReadOnly();

    public static ImportBatch Create(
        string fileName,
        ImportFileType fileType,
        DateTimeOffset now,
        long operatorId)
    {
        if (string.IsNullOrWhiteSpace(fileName))
        {
            throw new BusinessRuleException("文件名不能为空。");
        }

        return new ImportBatch(fileName.Trim(), fileType, now, operatorId);
    }

    /// <summary>记录原始文件的对象存储键。</summary>
    public void SetObjectKey(string objectKey, DateTimeOffset now, long? actorId = null)
    {
        ObjectKey = objectKey;
        Touch(now, actorId);
    }

    /// <summary>设置列映射。目标字段名 → 源列名。</summary>
    public void MapColumns(IReadOnlyDictionary<string, string> mapping, DateTimeOffset now, long? actorId = null)
    {
        ColumnMapping = new Dictionary<string, string>(mapping, StringComparer.Ordinal);
        Touch(now, actorId);
    }

    /// <summary>写入解析结果。解析失败的行也要保留，管理员要能看到每一行的问题。</summary>
    public void SetRows(
        IReadOnlyList<ImportRow> rows,
        DateTimeOffset now,
        long? actorId = null)
    {
        _rows.Clear();
        _rows.AddRange(rows);

        TotalRows = _rows.Count;
        ValidRows = _rows.Count(r => r.Errors.Count == 0);
        InvalidRows = TotalRows - ValidRows;
        Touch(now, actorId);
    }

    /// <summary>采纳为候选题。重复采纳是幂等的。</summary>
    public void MarkAdopted(int adoptedCount, DateTimeOffset now, long? actorId = null)
    {
        if (Status == ImportStatus.Adopted)
        {
            return;
        }

        Status = ImportStatus.Adopted;
        AdoptedCount = adoptedCount;
        AdoptedBy = actorId;
        AdoptedAt = now;
        Touch(now, actorId);
    }

    public void MarkFailed(string reason, DateTimeOffset now, long? actorId = null)
    {
        Status = ImportStatus.Failed;
        Description = reason;
        Touch(now, actorId);
    }

    /// <summary>批次备注。解析失败时记录原因。</summary>
    public string? Description { get; private set; }
}

/// <summary>导入批次中的一行。</summary>
public sealed class ImportRow : Entity<long>
{
    public ImportRow()
    {
    }

    private ImportRow(int rowNumber, string raw, DateTimeOffset now)
    {
        RowNumber = rowNumber;
        Raw = raw;
        CreatedAt = now;
    }

    public long BatchId { get; private set; }

    /// <summary>行号，从 2 开始（第 1 行是表头）。</summary>
    public int RowNumber { get; private set; }

    /// <summary>原始行内容（JSON）。</summary>
    public string Raw { get; private set; } = "{}";

    /// <summary>解析结果（JSON）。解析失败时为空。</summary>
    public string? Parsed { get; private set; }

    /// <summary>逐字段的错误说明（JSON 数组）。</summary>
    public IReadOnlyList<ImportRowError> Errors { get; private set; } = [];

    public DateTimeOffset CreatedAt { get; private set; }

    public static ImportRow Create(int rowNumber, string raw, DateTimeOffset now) =>
        new(rowNumber, raw, now);

    public void SetParsed(string? parsed, IReadOnlyList<ImportRowError> errors)
    {
        Parsed = parsed;
        Errors = errors;
    }
}
