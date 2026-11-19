using System.Net;
using Exam.Infrastructure.Configuration;
using Exam.Infrastructure.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;
using NSubstitute;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Storage;

/// <summary>
/// MinIO 对象存储的取流契约。
///
/// 回归 T-P10-08b 的缺陷：取流时缓冲在自己的 <c>using</c> 里被释放，
/// 方法返回时流已经关掉——调用方一读就抛 ObjectDisposedException，
/// 导入批次改列映射直接 500。
/// </summary>
public sealed class MinioObjectStorageTests
{
    private static MinioObjectStorage Create(IMinioClient client) =>
        new(
            Options.Create(new ObjectStorageOptions
            {
                Enabled = true,
                Endpoint = "localhost:9000",
                AccessKey = "key",
                SecretKey = "secret",
                Bucket = "exam-attachments",
            }),
            NullLogger<MinioObjectStorage>.Instance,
            client);

    [Fact]
    public async Task 取回的流归调用方所有_方法返回后仍能读()
    {
        var client = Substitute.For<IMinioClient>();
        client
            .GetObjectAsync(Arg.Any<GetObjectArgs>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<Minio.DataModel.ObjectStat>(null!));

        var storage = Create(client);

        var stream = await storage.GetAsync("questions/2026/file.csv");
        stream.ShouldNotBeNull();

        // 旧实现在这里抛 ObjectDisposedException（缓冲被 using 关掉了）。
        using var buffer = new MemoryStream();
        await stream!.CopyToAsync(buffer);

        stream.CanRead.ShouldBeTrue();
    }

    [Fact]
    public async Task 对象不存在时返回空而不是抛异常()
    {
        var client = Substitute.For<IMinioClient>();
        client
            .GetObjectAsync(Arg.Any<GetObjectArgs>(), Arg.Any<CancellationToken>())
            .Returns<Task<Minio.DataModel.ObjectStat>>(_ => throw new Minio.Exceptions.ErrorResponseException(
                new Minio.Exceptions.ErrorResponse { Code = "NoSuchKey" },
                new Minio.DataModel.Result.ResponseResult(
                    new HttpRequestMessage(HttpMethod.Get, "http://localhost:9000/exam-attachments/missing"),
                    new HttpResponseMessage(HttpStatusCode.NotFound))));

        var storage = Create(client);

        (await storage.GetAsync("missing")).ShouldBeNull();
    }
}
