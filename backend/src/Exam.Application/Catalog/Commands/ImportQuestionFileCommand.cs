using System.Text.Json;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Services;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Catalog.Commands;

/// <summary>
/// 上传试题文件并解析。返回列映射建议与逐行结果。
/// </summary>
public sealed record ImportQuestionFileCommand(byte[] Content, string FileName)
    : IAppCommand<ImportBatchDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ImportRun];
}

public sealed class ImportQuestionFileCommandValidator : AbstractValidator<ImportQuestionFileCommand>
{
    public ImportQuestionFileCommandValidator()
    {
        RuleFor(x => x.Content)
            .NotNull().WithMessage("请选择要上传的文件。")
            .Must(c => c.Length > 0).WithMessage("文件内容为空。");

        RuleFor(x => x.FileName)
            .NotEmpty().WithMessage("文件名不能为空。")
            .MaximumLength(256).WithMessage("文件名过长。");
    }
}

public sealed class ImportQuestionFileHandler : IRequestHandler<ImportQuestionFileCommand, ImportBatchDetailDto>
{
    private readonly IQuestionFileParser _fileParser;
    private readonly QuestionImportRowProcessor _rowProcessor;
    private readonly IImportBatchRepository _batches;
    private readonly IObjectStorage _storage;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ImportQuestionFileHandler(
        IQuestionFileParser fileParser,
        QuestionImportRowProcessor rowProcessor,
        IImportBatchRepository batches,
        IObjectStorage storage,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _fileParser = fileParser;
        _rowProcessor = rowProcessor;
        _batches = batches;
        _storage = storage;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ImportBatchDetailDto> Handle(
        ImportQuestionFileCommand request,
        CancellationToken cancellationToken)
    {
        var table = _fileParser.Parse(request.Content, request.FileName);
        var mapping = QuestionImportRowProcessor.SuggestMapping(table.Headers);

        var now = _clock.UtcNow;
        var fileType = request.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
            ? ImportFileType.Xlsx
            : ImportFileType.Csv;

        var batch = ImportBatch.Create(request.FileName, fileType, now, _currentUser.UserId ?? 0);
        batch.MapColumns(mapping, now, _currentUser.UserId);

        var parsed = await _rowProcessor.ParseAsync(table, mapping, cancellationToken);
        batch.SetRows(
            parsed.Select(p => BuildRow(p, now)).ToList(),
            now,
            _currentUser.UserId);

        await _batches.AddAsync(batch, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 原始文件留着：调整列映射时需要重新解析。
        var objectKey = $"imports/{batch.Id}/{Guid.NewGuid():N}-{Path.GetFileName(request.FileName)}";
        await using (var stream = new MemoryStream(request.Content, writable: false))
        {
            await _storage.PutAsync(
                objectKey,
                stream,
                request.Content.LongLength,
                "application/octet-stream",
                cancellationToken);
        }

        batch.SetObjectKey(objectKey, now, _currentUser.UserId);
        _batches.Update(batch);

        await _audit.RecordAsync(
            "import.upload",
            "import-batch",
            batch.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["fileName"] = batch.FileName,
                ["totalRows"] = batch.TotalRows,
                ["validRows"] = batch.ValidRows,
                ["invalidRows"] = batch.InvalidRows,
            },
            cancellationToken);

        return ImportBatchDtoFactory.ToDetail(batch, parsed, table.Headers);
    }

    internal static ImportRow BuildRow(ImportRowParseResult result, DateTimeOffset now)
    {
        var row = ImportRow.Create(result.RowNumber, result.Raw, now);
        row.SetParsed(result.Parsed, result.Errors);
        return row;
    }
}

/// <summary>调整列映射并重新解析。</summary>
public sealed record UpdateImportMappingCommand(long BatchId, IReadOnlyDictionary<string, string> Mapping)
    : IAppCommand<ImportBatchDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ImportRun];
}

public sealed class UpdateImportMappingHandler : IRequestHandler<UpdateImportMappingCommand, ImportBatchDetailDto>
{
    private readonly IQuestionFileParser _fileParser;
    private readonly QuestionImportRowProcessor _rowProcessor;
    private readonly IImportBatchRepository _batches;
    private readonly IObjectStorage _storage;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdateImportMappingHandler(
        IQuestionFileParser fileParser,
        QuestionImportRowProcessor rowProcessor,
        IImportBatchRepository batches,
        IObjectStorage storage,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser)
    {
        _fileParser = fileParser;
        _rowProcessor = rowProcessor;
        _batches = batches;
        _storage = storage;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ImportBatchDetailDto> Handle(
        UpdateImportMappingCommand request,
        CancellationToken cancellationToken)
    {
        var batch = await _batches.GetByIdAsync(request.BatchId, cancellationToken)
            ?? throw new NotFoundException("导入批次不存在。");

        if (batch.Status == ImportStatus.Adopted)
        {
            throw new BusinessRuleException("批次已采纳，不能再调整列映射。");
        }

        if (string.IsNullOrWhiteSpace(batch.ObjectKey))
        {
            throw new BusinessRuleException("原始文件已丢失，无法重新解析。");
        }

        await using var stream = await _storage.GetAsync(batch.ObjectKey, cancellationToken)
            ?? throw new BusinessRuleException("原始文件已丢失，无法重新解析。");

        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);

        var table = _fileParser.Parse(buffer.ToArray(), batch.FileName);
        var now = _clock.UtcNow;

        batch.MapColumns(request.Mapping, now, _currentUser.UserId);
        var parsed = await _rowProcessor.ParseAsync(table, request.Mapping, cancellationToken);

        batch.SetRows(
            parsed.Select(p => ImportQuestionFileHandler.BuildRow(p, now)).ToList(),
            now,
            _currentUser.UserId);

        _batches.Update(batch);

        return ImportBatchDtoFactory.ToDetail(batch, parsed, table.Headers);
    }
}

/// <summary>采纳批次为候选题。候选题是草稿，需要人工复核后再发布。</summary>
public sealed record AdoptImportBatchCommand(long BatchId) : IAppCommand<ImportAdoptResult>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ImportAdopt];
}

public sealed class AdoptImportBatchHandler : IRequestHandler<AdoptImportBatchCommand, ImportAdoptResult>
{
    private readonly IImportBatchRepository _batches;
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public AdoptImportBatchHandler(
        IImportBatchRepository batches,
        IQuestionRepository questions,
        ITagRepository tags,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _batches = batches;
        _questions = questions;
        _tags = tags;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ImportAdoptResult> Handle(
        AdoptImportBatchCommand request,
        CancellationToken cancellationToken)
    {
        var batch = await _batches.GetByIdAsync(request.BatchId, cancellationToken)
            ?? throw new NotFoundException("导入批次不存在。");

        if (batch.Status == ImportStatus.Adopted)
        {
            // 重复采纳是幂等的：返回既有结果，不重复建题。
            return new ImportAdoptResult(
                batch.Id,
                batch.Status.ToString().ToLowerInvariant(),
                batch.AdoptedCount,
                [],
                AlreadyAdopted: true);
        }

        var now = _clock.UtcNow;
        var failures = new List<ImportAdoptFailure>();
        var adopted = 0;

        // 标签引用计数：同一标签被多道题引用时只加载一次，
        // 否则第二次 Update 会与已跟踪的实例冲突。
        var tagReferenceCounts = new Dictionary<long, int>();

        foreach (var row in batch.Rows.OrderBy(r => r.RowNumber))
        {
            if (row.Errors.Count > 0 || string.IsNullOrWhiteSpace(row.Parsed))
            {
                continue;
            }

            var resolved = JsonSerializer.Deserialize<ResolvedQuestion>(row.Parsed, QuestionImportRowProcessor.JsonOptions);
            if (resolved is null)
            {
                failures.Add(new ImportAdoptFailure(row.RowNumber, "解析结果无法读取。"));
                continue;
            }

            var code = string.IsNullOrWhiteSpace(resolved.Code)
                ? $"IMP-{batch.Id}-{row.RowNumber}"
                : resolved.Code.Trim();

            if (await _questions.CodeExistsAsync(code, null, cancellationToken))
            {
                failures.Add(new ImportAdoptFailure(row.RowNumber, $"题号「{code}」已存在。"));
                continue;
            }

            var question = Question.CreateDraft(
                code,
                resolved.Type,
                resolved.Stem,
                Score.Question(resolved.Score),
                resolved.DifficultyTagId,
                now,
                _currentUser.UserId,
                QuestionSource.Import,
                batch.Id);

            question.UpdateContent(
                resolved.Stem,
                resolved.Analysis,
                resolved.ReferenceAnswer,
                Score.Question(resolved.Score),
                now,
                _currentUser.UserId);

            foreach (var option in resolved.Options)
            {
                question.AddOption(
                    QuestionOption.Create(option.Key, option.Text, option.IsCorrect, 0),
                    now,
                    _currentUser.UserId);
            }

            foreach (var keypoint in resolved.Keypoints)
            {
                question.AddKeypoint(
                    QuestionKeypoint.Create(keypoint.Text, keypoint.Keywords, 0),
                    now,
                    _currentUser.UserId);
            }

            foreach (var step in resolved.Steps)
            {
                question.AddStep(
                    QuestionStep.Create(step.Code, step.Prompt, null, [], Score.Question(step.Score), 0),
                    now,
                    _currentUser.UserId);
            }

            foreach (var tagId in resolved.TagIds)
            {
                question.AttachTag(tagId, now, _currentUser.UserId);
                tagReferenceCounts[tagId] = tagReferenceCounts.GetValueOrDefault(tagId) + 1;
            }

            await _questions.AddAsync(question, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            adopted++;
        }

        foreach (var (tagId, count) in tagReferenceCounts)
        {
            var tag = await _tags.GetByIdAsync(tagId, cancellationToken);
            if (tag is null)
            {
                continue;
            }

            for (var i = 0; i < count; i++)
            {
                tag.IncrementUsage();
            }

            _tags.Update(tag);
        }

        batch.MarkAdopted(adopted, now, _currentUser.UserId);
        _batches.Update(batch);

        await _audit.RecordAsync(
            "import.adopt",
            "import-batch",
            batch.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["adopted"] = adopted,
                ["failed"] = failures.Count,
            },
            cancellationToken);

        return new ImportAdoptResult(
            batch.Id,
            batch.Status.ToString().ToLowerInvariant(),
            adopted,
            failures,
            AlreadyAdopted: false);
    }
}

/// <summary>导入批次视图组装。</summary>
public static class ImportBatchDtoFactory
{
    public static ImportBatchDto ToSummary(ImportBatch batch) => new(
        batch.Id,
        batch.FileName,
        batch.FileType == ImportFileType.Xlsx ? "xlsx" : "csv",
        batch.Status.ToString().ToLowerInvariant(),
        batch.TotalRows,
        batch.ValidRows,
        batch.InvalidRows,
        batch.AdoptedCount,
        batch.ColumnMapping,
        batch.AdoptedBy,
        batch.AdoptedAt,
        batch.CreatedAt);

    public static ImportBatchDetailDto ToDetail(
        ImportBatch batch,
        IReadOnlyList<ImportRowParseResult>? parsed = null,
        IReadOnlyList<string>? headers = null)
    {
        var rows = parsed is not null
            ? parsed.Select(p => new ImportRowDto(
                    p.RowNumber,
                    p.IsValid,
                    p.Errors.Select(e => new ImportRowErrorDto(e.Field, e.Reason)).ToList(),
                    p.Parsed))
                .ToList()
            : batch.Rows
                .OrderBy(r => r.RowNumber)
                .Select(r => new ImportRowDto(
                    r.RowNumber,
                    r.Errors.Count == 0,
                    r.Errors.Select(e => new ImportRowErrorDto(e.Field, e.Reason)).ToList(),
                    r.Parsed))
                .ToList();

        return new ImportBatchDetailDto(ToSummary(batch), rows, headers ?? []);
    }
}
