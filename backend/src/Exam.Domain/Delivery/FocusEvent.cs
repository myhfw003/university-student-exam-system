using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Delivery;

/// <summary>焦点事件类型。</summary>
public enum FocusEventType
{
    /// <summary>窗口失焦。</summary>
    WindowBlur,

    /// <summary>页面隐藏（切到别的标签页）。</summary>
    PageHidden,

    /// <summary>退出全屏。</summary>
    FullscreenExit,

    /// <summary>尝试复制。</summary>
    CopyAttempt,

    /// <summary>尝试粘贴。</summary>
    PasteAttempt,

    /// <summary>右键菜单。</summary>
    ContextMenu,

    /// <summary>心跳超时。</summary>
    HeartbeatTimeout,
}

/// <summary>
/// 焦点事件。追加式流水，记录考生在考试中的每一次切屏与违规尝试。
/// </summary>
public sealed class FocusEvent : Entity<long>
{
    private FocusEvent()
    {
    }

    private FocusEvent(
        long attemptId,
        FocusEventType eventType,
        long? questionId,
        DateTimeOffset? clientAt,
        DateTimeOffset serverReceivedAt)
    {
        AttemptId = attemptId;
        EventType = eventType;
        QuestionId = questionId;
        ClientAt = clientAt;
        ServerReceivedAt = serverReceivedAt;
    }

    public long AttemptId { get; private set; }

    public FocusEventType EventType { get; private set; }

    /// <summary>事件发生时考生正在作答的题目。</summary>
    public long? QuestionId { get; private set; }

    /// <summary>客户端声称的发生时间（仅供参考）。</summary>
    public DateTimeOffset? ClientAt { get; private set; }

    /// <summary>服务端收到的时间。</summary>
    public DateTimeOffset ServerReceivedAt { get; private set; }

    public static FocusEvent Create(
        long attemptId,
        FocusEventType eventType,
        long? questionId,
        DateTimeOffset? clientAt,
        DateTimeOffset serverReceivedAt) =>
        new(attemptId, eventType, questionId, clientAt, serverReceivedAt);

}

/// <summary>切屏次数达到上限。</summary>
public sealed class FocusLimitExceededException : DomainException
{
    public FocusLimitExceededException(string message)
        : base(message, ErrorCodes.FocusLimitExceeded) { }
}

public static class FocusEventTypes
{
    /// <summary>是否计入切屏次数。只有失焦、页面隐藏与退出全屏算切屏。</summary>
    public static bool IsFocusLoss(this FocusEventType type) =>
        type is FocusEventType.WindowBlur
            or FocusEventType.PageHidden
            or FocusEventType.FullscreenExit;

    public static string ToStorage(this FocusEventType type) => type switch
    {
        FocusEventType.WindowBlur => "window_blur",
        FocusEventType.PageHidden => "page_hidden",
        FocusEventType.FullscreenExit => "fullscreen_exit",
        FocusEventType.CopyAttempt => "copy_attempt",
        FocusEventType.PasteAttempt => "paste_attempt",
        FocusEventType.ContextMenu => "context_menu",
        FocusEventType.HeartbeatTimeout => "heartbeat_timeout",
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "未知焦点事件类型。"),
    };

    public static FocusEventType? FromStorage(string? storage) => storage switch
    {
        "window_blur" => FocusEventType.WindowBlur,
        "page_hidden" => FocusEventType.PageHidden,
        "fullscreen_exit" => FocusEventType.FullscreenExit,
        "copy_attempt" => FocusEventType.CopyAttempt,
        "paste_attempt" => FocusEventType.PasteAttempt,
        "context_menu" => FocusEventType.ContextMenu,
        "heartbeat_timeout" => FocusEventType.HeartbeatTimeout,
        _ => null,
    };
}
