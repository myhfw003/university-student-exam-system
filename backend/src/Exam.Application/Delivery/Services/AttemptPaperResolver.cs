using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;
using Exam.Domain.Delivery;
using Exam.Domain.Learning;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Application.Delivery.Services;

/// <summary>一次作答对应的卷面上下文。</summary>
public sealed record AttemptPaperContext(
    ExamSession? Session,
    PracticeAssignment? PracticeAssignment,
    PaperSnapshot Snapshot,
    IReadOnlyList<PaperItem>? PaperItems);

/// <summary>
/// 解析一次作答的卷面来源。
/// <para>
/// 考试走场次绑定的快照；练习走练习开放单挂的试卷。
/// </para>
/// </summary>
public sealed class AttemptPaperResolver
{
    private readonly IExamSessionRepository _sessions;
    private readonly IPracticeAssignmentRepository _practiceAssignments;
    private readonly IPaperRepository _papers;
    private readonly IPaperSnapshotRepository _snapshots;

    public AttemptPaperResolver(
        IExamSessionRepository sessions,
        IPracticeAssignmentRepository practiceAssignments,
        IPaperRepository papers,
        IPaperSnapshotRepository snapshots)
    {
        _sessions = sessions;
        _practiceAssignments = practiceAssignments;
        _papers = papers;
        _snapshots = snapshots;
    }

    public async Task<AttemptPaperContext> ResolveAsync(
        Attempt attempt,
        CancellationToken cancellationToken = default)
    {
        if (attempt.ExamSessionId is { } sessionId)
        {
            var session = await _sessions.GetByIdAsync(sessionId, cancellationToken)
                ?? throw new NotFoundException("考试场次不存在。");

            if (session.SnapshotId is null)
            {
                throw new BusinessRuleException("场次尚未绑定试卷快照，无法作答。");
            }

            var snapshot = await _snapshots.GetByIdAsync(session.SnapshotId.Value, cancellationToken)
                ?? throw new NotFoundException("试卷快照不存在。");

            var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken);

            return new AttemptPaperContext(session, null, snapshot, paper?.Items.ToList());
        }

        var assignment = await _practiceAssignments.GetByIdAsync(attempt.PracticeAssignmentId!.Value, cancellationToken)
            ?? throw new NotFoundException("练习开放单不存在。");

        var practicePaper = await _papers.GetByIdAsync(assignment.PaperId, cancellationToken)
            ?? throw new NotFoundException("练习试卷不存在。");

        var practiceSnapshot = await _snapshots.GetLatestAsync(practicePaper.Id, cancellationToken)
            ?? throw new BusinessRuleException("练习试卷还没有发布快照。");

        return new AttemptPaperContext(null, assignment, practiceSnapshot, practicePaper.Items.ToList());
    }
}
