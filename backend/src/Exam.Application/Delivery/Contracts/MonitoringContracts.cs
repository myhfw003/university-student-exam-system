namespace Exam.Application.Delivery.Contracts;

/// <summary>监考面板上的一名考生。</summary>
public sealed record ExamCandidateStatusDto(
    long AttemptId,
    long UserId,
    string DisplayName,
    string Username,
    string Status,
    string StatusLabel,
    int FocusLossCount,
    int DisconnectCount,
    int WarningCount,
    DateTimeOffset? LastHeartbeatAt,
    bool Offline,
    int AnsweredCount,
    int TotalCount);

/// <summary>一个场次的实时状态批次。</summary>
public sealed record ExamStatusBatchDto(
    long ExamSessionId,
    DateTimeOffset ServerTime,
    IReadOnlyList<ExamCandidateStatusDto> Candidates);

/// <summary>监考处置动作。</summary>
public sealed record ProctorActionDto(
    long Id,
    long AttemptId,
    string ActionType,
    string? Message,
    string? Reason,
    string OperatorName,
    DateTimeOffset CreatedAt);

/// <summary>监考处置历史。</summary>
public sealed record ProctorActionListResponse(
    long AttemptId,
    IReadOnlyList<ProctorActionDto> Items,
    int Total);
