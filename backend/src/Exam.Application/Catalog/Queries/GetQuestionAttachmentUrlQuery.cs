using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Catalog.Queries;

/// <summary>取回题目的附件清单。</summary>
public sealed record ListQuestionAttachmentsQuery(long QuestionId)
    : IAppQuery<IReadOnlyList<AttachmentDto>>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionRead];
}

public sealed class ListQuestionAttachmentsHandler
    : IRequestHandler<ListQuestionAttachmentsQuery, IReadOnlyList<AttachmentDto>>
{
    private readonly IQuestionRepository _questions;

    public ListQuestionAttachmentsHandler(IQuestionRepository questions) => _questions = questions;

    public async Task<IReadOnlyList<AttachmentDto>> Handle(
        ListQuestionAttachmentsQuery request,
        CancellationToken cancellationToken)
    {
        var question = await _questions.GetByIdAsync(request.QuestionId, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        return question.Attachments
            .OrderBy(a => a.SortOrder)
            .Select(a => new AttachmentDto(a.Id, a.ObjectKey, a.FileName, a.ContentType, a.SizeBytes))
            .ToList();
    }
}

/// <summary>
/// 生成附件的短期签名 URL。
/// <para>
/// 题目被删除后附件不可访问：题目查不到即 404，不会签发 URL。
/// </para>
/// </summary>
public sealed record GetQuestionAttachmentUrlQuery(long QuestionId, long AttachmentId, int ExpirySeconds)
    : IAppQuery<AttachmentUrlDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionRead];
}

public sealed class GetQuestionAttachmentUrlHandler : IRequestHandler<GetQuestionAttachmentUrlQuery, AttachmentUrlDto>
{
    private readonly IQuestionRepository _questions;
    private readonly IObjectStorage _storage;
    private readonly IClock _clock;

    public GetQuestionAttachmentUrlHandler(
        IQuestionRepository questions,
        IObjectStorage storage,
        IClock clock)
    {
        _questions = questions;
        _storage = storage;
        _clock = clock;
    }

    public async Task<AttachmentUrlDto> Handle(
        GetQuestionAttachmentUrlQuery request,
        CancellationToken cancellationToken)
    {
        var question = await _questions.GetByIdAsync(request.QuestionId, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        var attachment = question.Attachments.FirstOrDefault(a => a.Id == request.AttachmentId)
            ?? throw new NotFoundException("附件不存在。");

        var expirySeconds = Math.Clamp(request.ExpirySeconds, 30, 3600);
        var expiry = TimeSpan.FromSeconds(expirySeconds);

        var url = await _storage.GetPresignedUrlAsync(attachment.ObjectKey, expiry, cancellationToken);
        return new AttachmentUrlDto(url, _clock.UtcNow.Add(expiry));
    }
}
