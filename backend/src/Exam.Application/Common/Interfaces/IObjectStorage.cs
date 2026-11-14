namespace Exam.Application.Common.Interfaces;

/// <summary>
/// 对象存储。实现位于 Infrastructure（MinIO / S3 兼容）。
/// <para>
/// 附件一律通过**短期签名 URL**访问，存储密钥不出现在任何响应里。
/// </para>
/// </summary>
public interface IObjectStorage
{
    /// <summary>写入对象。</summary>
    Task PutAsync(
        string objectKey,
        Stream content,
        long size,
        string contentType,
        CancellationToken cancellationToken = default);

    /// <summary>读取对象。对象不存在时返回 null。</summary>
    Task<Stream?> GetAsync(string objectKey, CancellationToken cancellationToken = default);

    /// <summary>删除对象。</summary>
    Task DeleteAsync(string objectKey, CancellationToken cancellationToken = default);

    /// <summary>生成短期访问用的签名 URL。</summary>
    Task<string> GetPresignedUrlAsync(
        string objectKey,
        TimeSpan expiry,
        CancellationToken cancellationToken = default);

    /// <summary>存储是否可用。不可用时上传端点应明确报错而不是静默失败。</summary>
    Task<bool> IsAvailableAsync(CancellationToken cancellationToken = default);
}
