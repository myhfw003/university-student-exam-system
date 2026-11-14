namespace Exam.Infrastructure.Configuration;

/// <summary>对象存储配置。</summary>
public sealed class ObjectStorageOptions
{
    public const string SectionName = "ObjectStorage";

    /// <summary>是否启用对象存储。未配置时附件端点明确报错，不静默吞掉。</summary>
    public bool Enabled { get; set; }

    /// <summary>服务地址，例如 <c>minio:9000</c>。</summary>
    public string Endpoint { get; set; } = string.Empty;

    public string AccessKey { get; set; } = string.Empty;

    public string SecretKey { get; set; } = string.Empty;

    /// <summary>存放附件的私有桶。</summary>
    public string Bucket { get; set; } = "exam-attachments";

    /// <summary>是否走 HTTPS。</summary>
    public bool UseSsl { get; set; }

    /// <summary>签名 URL 有效期（秒）。默认 5 分钟。</summary>
    public int PresignedUrlSeconds { get; set; } = 300;

    /// <summary>单个附件大小上限（字节）。默认 10 MB。</summary>
    public long MaxFileSizeBytes { get; set; } = 10 * 1024 * 1024;
}
