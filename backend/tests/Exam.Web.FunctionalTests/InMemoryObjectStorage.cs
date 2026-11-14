using System.Collections.Concurrent;
using Exam.Application.Common.Interfaces;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 测试用的内存对象存储。真实实现是 MinIO，测试不需要真对象存储。
/// </summary>
public sealed class InMemoryObjectStorage : IObjectStorage
{
    private readonly ConcurrentDictionary<string, byte[]> _objects = new(StringComparer.Ordinal);

    public IReadOnlyDictionary<string, byte[]> Objects => _objects;

    public Task PutAsync(
        string objectKey,
        Stream content,
        long size,
        string contentType,
        CancellationToken cancellationToken = default)
    {
        using var buffer = new MemoryStream();
        content.CopyTo(buffer);
        _objects[objectKey] = buffer.ToArray();
        return Task.CompletedTask;
    }

    public Task<Stream?> GetAsync(string objectKey, CancellationToken cancellationToken = default)
    {
        if (!_objects.TryGetValue(objectKey, out var content))
        {
            return Task.FromResult<Stream?>(null);
        }

        return Task.FromResult<Stream?>(new MemoryStream(content));
    }

    public Task DeleteAsync(string objectKey, CancellationToken cancellationToken = default)
    {
        _objects.TryRemove(objectKey, out _);
        return Task.CompletedTask;
    }

    public Task<string> GetPresignedUrlAsync(
        string objectKey,
        TimeSpan expiry,
        CancellationToken cancellationToken = default) =>
        Task.FromResult($"https://storage.test/{objectKey}?expires={expiry.TotalSeconds:0}");

    public Task<bool> IsAvailableAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(true);
}
