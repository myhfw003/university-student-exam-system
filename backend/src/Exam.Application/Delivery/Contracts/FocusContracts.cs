namespace Exam.Application.Delivery.Contracts;

/// <summary>一条焦点事件。</summary>
public sealed record FocusEventInput(
    string Type,
    long? QuestionId = null,
    DateTimeOffset? ClientAt = null);

/// <summary>焦点事件上报请求。</summary>
public sealed record ReportFocusEventsInput(IReadOnlyList<FocusEventInput> Events);

/// <summary>
/// 焦点事件上报结果。
/// <para>
/// 计数以服务端为准：客户端报几次就是几次，服务端自己累加。</para>
/// </summary>
public sealed record FocusEventsResponse(
    int FocusLossCount,
    int? Limit,
    bool LimitReached,
    bool ForcedSubmit,
    bool Warned,
    int DisconnectCount,
    int WarningCount,
    DateTimeOffset ServerTime);
