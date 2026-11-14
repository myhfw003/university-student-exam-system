using System.Text.Json;
using Exam.Domain.SharedKernel.Events;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Exam.Application.Messaging;

/// <summary>
/// 领域事件派发器。
/// <para>
/// 消息类型是事件的完整类型名，负载是事件的 JSON。派发时按类型找到处理器。
/// </para>
/// </summary>
public sealed class DomainEventDispatcher : IDomainEventDispatcher
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    private readonly IOutboxStore _store;
    private readonly IServiceProvider _services;
    private readonly ILogger<DomainEventDispatcher> _logger;

    public DomainEventDispatcher(
        IOutboxStore store,
        IServiceProvider services,
        ILogger<DomainEventDispatcher> logger)
    {
        _store = store;
        _services = services;
        _logger = logger;
    }

    public async Task DispatchAsync(OutboxEnvelope message, CancellationToken cancellationToken = default)
    {
        var eventType = ResolveEventType(message.MessageType)
            ?? throw new InvalidOperationException($"找不到事件类型：{message.MessageType}。");

        var domainEvent = JsonSerializer.Deserialize(message.Payload, eventType, JsonOptions) as IDomainEvent
            ?? throw new InvalidOperationException($"事件负载解析失败：{message.MessageType}。");

        var handlerType = typeof(IDomainEventHandler<>).MakeGenericType(eventType);
        var handlers = _services.GetServices(handlerType);

        foreach (var handler in handlers)
        {
            var handle = handlerType.GetMethod(nameof(IDomainEventHandler<IDomainEvent>.HandleAsync))
                ?? throw new InvalidOperationException($"处理器缺少 HandleAsync 方法：{handlerType.Name}。");

            await (Task)handle.Invoke(handler, [domainEvent, cancellationToken])!;
        }
    }

    public async Task<int> DispatchPendingAsync(
        int batchSize = 100,
        CancellationToken cancellationToken = default)
    {
        var messages = await _store.ListPendingAsync(batchSize, cancellationToken);
        var dispatched = 0;

        foreach (var message in messages)
        {
            try
            {
                await DispatchAsync(message, cancellationToken);
                await _store.MarkDispatchedAsync(message.Id, cancellationToken);
                dispatched++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "领域事件派发失败：{MessageType}（消息 {MessageId}）", message.MessageType, message.Id);
                await _store.MarkFailedAsync(message.Id, ex.Message, cancellationToken);
            }
        }

        return dispatched;
    }

    /// <summary>按完整类型名找到事件类型。程序集版本变了也能找到。</summary>
    private static Type? ResolveEventType(string messageType)
    {
        var type = Type.GetType(messageType);
        if (type is not null)
        {
            return type;
        }

        return AppDomain.CurrentDomain
            .GetAssemblies()
            .Select(assembly => assembly.GetType(messageType))
            .FirstOrDefault(found => found is not null);
    }
}
