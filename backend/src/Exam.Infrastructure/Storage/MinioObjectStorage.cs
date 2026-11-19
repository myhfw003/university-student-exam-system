using Exam.Application.Common.Interfaces;
using Exam.Infrastructure.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;

namespace Exam.Infrastructure.Storage;

/// <summary>
/// MinIO（以及任何 S3 兼容服务）实现的对象存储。
/// <para>
/// 桶是私有的：外部只能通过短期签名 URL 访问，密钥不出现在任何响应里。
/// </para>
/// </summary>
public sealed class MinioObjectStorage : IObjectStorage
{
    private readonly IMinioClient _client;
    private readonly ObjectStorageOptions _options;
    private readonly ILogger<MinioObjectStorage> _logger;
    private bool _bucketChecked;

    public MinioObjectStorage(
        IOptions<ObjectStorageOptions> options,
        ILogger<MinioObjectStorage> logger)
        : this(
            options,
            logger,
            new MinioClient()
                .WithEndpoint(options.Value.Endpoint)
                .WithCredentials(options.Value.AccessKey, options.Value.SecretKey)
                .WithSSL(options.Value.UseSsl)
                .Build())
    {
    }

    /// <summary>
    /// 注入 MinIO 客户端的构造。
    ///
    /// 客户端由外部给，是为了能测「返回的流归调用方」这条契约——
    /// 缓冲被提前关掉这类缺陷只有真读到流才会暴露。
    /// </summary>
    public MinioObjectStorage(
        IOptions<ObjectStorageOptions> options,
        ILogger<MinioObjectStorage> logger,
        IMinioClient client)
    {
        _options = options.Value;
        _logger = logger;
        _client = client;
    }

    public async Task PutAsync(
        string objectKey,
        Stream content,
        long size,
        string contentType,
        CancellationToken cancellationToken = default)
    {
        await EnsureBucketAsync(cancellationToken);

        var args = new PutObjectArgs()
            .WithBucket(_options.Bucket)
            .WithObject(objectKey)
            .WithStreamData(content)
            .WithObjectSize(size)
            .WithHeaders(new Dictionary<string, string> { ["Content-Type"] = contentType });

        await _client.PutObjectAsync(args, cancellationToken);
    }

    public async Task<Stream?> GetAsync(string objectKey, CancellationToken cancellationToken = default)
    {
        try
        {
            // MinIO 的下载走回调：把响应流复制到内存缓冲，再交给调用方。
            // **缓冲的所有权交给调用方**：这里不能 using 释放——方法返回时缓冲就被关掉，
            // 调用方拿到的会是已关闭的流（读的时候抛 ObjectDisposedException）。
            var buffer = new MemoryStream();

            try
            {
                var args = new GetObjectArgs()
                    .WithBucket(_options.Bucket)
                    .WithObject(objectKey)
                    .WithCallbackStream((Action<Stream>)(stream => stream.CopyTo(buffer)));

                await _client.GetObjectAsync(args, cancellationToken);
            }
            catch
            {
                await buffer.DisposeAsync();
                throw;
            }

            buffer.Position = 0;
            return buffer;
        }
        catch (Minio.Exceptions.ErrorResponseException ex) when (ex.Response?.Code == "NoSuchKey")
        {
            return null;
        }
    }

    public async Task DeleteAsync(string objectKey, CancellationToken cancellationToken = default)
    {
        var args = new RemoveObjectArgs()
            .WithBucket(_options.Bucket)
            .WithObject(objectKey);

        await _client.RemoveObjectAsync(args, cancellationToken);
    }

    public async Task<string> GetPresignedUrlAsync(
        string objectKey,
        TimeSpan expiry,
        CancellationToken cancellationToken = default)
    {
        var seconds = (int)Math.Max(1, Math.Min(expiry.TotalSeconds, 7 * 24 * 3600));

        var args = new PresignedGetObjectArgs()
            .WithBucket(_options.Bucket)
            .WithObject(objectKey)
            .WithExpiry(seconds);

        var url = await _client.PresignedGetObjectAsync(args);
        return url.ToString();
    }

    public async Task<bool> IsAvailableAsync(CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled)
        {
            return false;
        }

        try
        {
            var args = new BucketExistsArgs().WithBucket(_options.Bucket);
            return await _client.BucketExistsAsync(args, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "对象存储不可用。");
            return false;
        }
    }

    /// <summary>首次使用时确保桶存在。桶是私有的，不公开读。</summary>
    private async Task EnsureBucketAsync(CancellationToken cancellationToken)
    {
        if (_bucketChecked)
        {
            return;
        }

        var existsArgs = new BucketExistsArgs().WithBucket(_options.Bucket);
        if (!await _client.BucketExistsAsync(existsArgs, cancellationToken))
        {
            var makeArgs = new MakeBucketArgs().WithBucket(_options.Bucket);
            await _client.MakeBucketAsync(makeArgs, cancellationToken);
            _logger.LogInformation("已创建附件桶 {Bucket}。", _options.Bucket);
        }

        _bucketChecked = true;
    }
}
