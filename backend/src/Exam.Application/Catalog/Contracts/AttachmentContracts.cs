namespace Exam.Application.Catalog.Contracts;

/// <summary>附件输入。引用已上传的对象。</summary>
public sealed record AttachmentInput(
    string ObjectKey,
    string FileName,
    string ContentType,
    long SizeBytes);

/// <summary>附件视图。</summary>
public sealed record AttachmentDto(
    long Id,
    string ObjectKey,
    string FileName,
    string ContentType,
    long SizeBytes);

/// <summary>附件访问地址。签名 URL 短期有效。</summary>
public sealed record AttachmentUrlDto(string Url, DateTimeOffset ExpiresAt);
