using Exam.Application.Catalog.Contracts;
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
/// 上传题目附件。
/// <para>
/// 文件落到对象存储，数据库只存引用。附件桶是私有的，外部只能通过短期签名 URL 访问。
/// </para>
/// </summary>
public sealed record UploadQuestionAttachmentCommand(
    byte[] Content,
    string FileName,
    string ContentType,
    long? QuestionId) : IAppCommand<AttachmentDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionWrite];
}

public sealed class UploadQuestionAttachmentCommandValidator : AbstractValidator<UploadQuestionAttachmentCommand>
{
    public UploadQuestionAttachmentCommandValidator()
    {
        RuleFor(x => x.Content)
            .NotNull().WithMessage("请选择要上传的文件。")
            .Must(c => c.Length > 0).WithMessage("附件内容为空。")
            .Must(c => c.LongLength <= AttachmentPolicy.MaxSizeBytes)
            .WithMessage($"附件大小不能超过 {AttachmentPolicy.MaxSizeBytes / 1024 / 1024} MB。");

        RuleFor(x => x.FileName)
            .NotEmpty().WithMessage("附件文件名不能为空。")
            .MaximumLength(256).WithMessage("附件文件名过长。");
    }
}

public sealed class UploadQuestionAttachmentHandler : IRequestHandler<UploadQuestionAttachmentCommand, AttachmentDto>
{
    /// <summary>嗅探文件头需要的字节数。</summary>
    private const int HeaderLength = 16;

    private readonly IObjectStorage _storage;
    private readonly IQuestionRepository _questions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UploadQuestionAttachmentHandler(
        IObjectStorage storage,
        IQuestionRepository questions,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _storage = storage;
        _questions = questions;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<AttachmentDto> Handle(
        UploadQuestionAttachmentCommand request,
        CancellationToken cancellationToken)
    {
        var extension = AttachmentPolicy.EnsureAllowed(
            request.ContentType,
            request.Content.LongLength,
            request.Content.AsSpan(0, Math.Min(HeaderLength, request.Content.Length)));

        var now = _clock.UtcNow;
        var objectKey = BuildObjectKey(_currentUser.UserId, extension, now);

        await using (var stream = new MemoryStream(request.Content, writable: false))
        {
            await _storage.PutAsync(
                objectKey,
                stream,
                request.Content.LongLength,
                request.ContentType,
                cancellationToken);
        }

        Question? question = null;
        if (request.QuestionId is not null)
        {
            question = await _questions.GetByIdAsync(request.QuestionId.Value, cancellationToken)
                ?? throw new NotFoundException("题目不存在。");
        }

        var fileName = SanitizeFileName(request.FileName);

        if (question is not null)
        {
            var attachment = QuestionAttachment.Create(
                objectKey,
                fileName,
                request.ContentType,
                request.Content.LongLength,
                question.Attachments.Count,
                now);

            question.AttachAttachment(attachment, now, _currentUser.UserId);
            _questions.Update(question);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            await _audit.RecordAsync(
                "question.upload-attachment",
                "question",
                question.Id.ToString(),
                new Dictionary<string, object?>
                {
                    ["fileName"] = fileName,
                    ["sizeBytes"] = request.Content.LongLength,
                },
                cancellationToken);

            return new AttachmentDto(
                attachment.Id,
                objectKey,
                fileName,
                request.ContentType,
                request.Content.LongLength);
        }

        // 尚未绑定到题目：先返回引用，题目创建时带上即可。
        return new AttachmentDto(0, objectKey, fileName, request.ContentType, request.Content.LongLength);
    }

    /// <summary>对象键按上传者隔离，避免不同用户互相覆盖。</summary>
    private static string BuildObjectKey(long? userId, string extension, DateTimeOffset now) =>
        $"attachments/{userId?.ToString() ?? "anonymous"}/{now:yyyyMM}/{Guid.NewGuid():N}{extension}";

    /// <summary>文件名只保留基础名，去掉路径分隔符与控制字符。</summary>
    private static string SanitizeFileName(string fileName)
    {
        var name = Path.GetFileName(fileName) ?? fileName;
        var cleaned = new string(name.Where(c => !char.IsControl(c) && c is not ('/' or '\\')).ToArray()).Trim();
        return string.IsNullOrEmpty(cleaned) ? "attachment" : cleaned;
    }
}
