using Exam.Application.Analytics.Contracts;
using Exam.Application.Analytics.Services;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Analytics.Queries;

/// <summary>
/// 某场考试的成绩分析。
/// <para>
/// 读模型落后于原始作答数据时当场重算，保证统计与作答数据始终一致。
/// </para>
/// </summary>
public sealed record GetExamSessionStatisticsQuery(long ExamSessionId)
    : IAppQuery<ExamSessionStatisticsResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AnalyticsRead];
}

public sealed class GetExamSessionStatisticsHandler
    : IRequestHandler<GetExamSessionStatisticsQuery, ExamSessionStatisticsResponse>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IPaperSnapshotRepository _snapshots;
    private readonly IExamStatisticRepository _readModel;
    private readonly ExamStatisticsService _service;

    public GetExamSessionStatisticsHandler(
        IExamSessionRepository sessions,
        IPaperSnapshotRepository snapshots,
        IExamStatisticRepository readModel,
        ExamStatisticsService service)
    {
        _sessions = sessions;
        _snapshots = snapshots;
        _readModel = readModel;
        _service = service;
    }

    public async Task<ExamSessionStatisticsResponse> Handle(
        GetExamSessionStatisticsQuery request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        // 统计必须与原始作答数据一致：读模型落后了就当场重算。
        if (await _service.IsStaleAsync(session.Id, cancellationToken))
        {
            await _service.RefreshAsync(session.Id, cancellationToken);
        }

        var statistic = await _readModel.GetExamStatisticAsync(session.Id, cancellationToken)
            ?? throw new NotFoundException("成绩统计尚未生成。");

        var questions = await _readModel.ListQuestionStatisticsAsync(session.Id, cancellationToken);
        var types = await _readModel.ListTypeStatisticsAsync(session.Id, cancellationToken);

        var snapshot = session.SnapshotId is null
            ? null
            : await _snapshots.GetByIdAsync(session.SnapshotId.Value, cancellationToken);

        var items = snapshot?.Items.ToDictionary(i => i.QuestionId) ?? [];

        var questionDtos = questions
            .OrderBy(q => items.TryGetValue(q.QuestionId, out var item) ? item.SortOrder : int.MaxValue)
            .ThenBy(q => q.QuestionId)
            .Select(q =>
            {
                items.TryGetValue(q.QuestionId, out var item);
                var type = item is null ? string.Empty : item.QuestionType;

                return new QuestionStatisticDto(
                    q.QuestionId,
                    item?.QuestionCode ?? string.Empty,
                    type,
                    TypeLabel(type),
                    item?.Score.Value ?? 0m,
                    q.AnsweredCount,
                    q.CorrectCount,
                    q.AnsweredCount > 0 ? Round((decimal)q.CorrectCount / q.AnsweredCount) : null,
                    q.AverageScore,
                    q.MasteryRate);
            })
            .ToList();

        var typeDtos = types
            .Select(t => new TypeStatisticDto(
                t.QuestionType,
                TypeLabel(t.QuestionType),
                t.AnsweredCount,
                t.AverageScore,
                t.ScoreRate))
            .ToList();

        var buckets = statistic.ScoreBuckets
            .Select(kv => new ScoreBucketDto(kv.Key, kv.Value))
            .ToList();

        return new ExamSessionStatisticsResponse(
            session.Id,
            session.Name,
            statistic.ParticipantCount,
            statistic.SubmittedCount,
            statistic.AbsentCount,
            statistic.AverageScore,
            statistic.MaxScore,
            statistic.MinScore,
            statistic.MaxScore is not null && statistic.MinScore is not null
                ? statistic.MaxScore - statistic.MinScore
                : null,
            statistic.PassRate,
            statistic.ExcellentRate,
            buckets,
            typeDtos,
            questionDtos,
            statistic.UpdatedAt);
    }

    private static string TypeLabel(string storage) =>
        QuestionTypes.FromStorage(storage)?.Label() ?? storage;

    private static decimal Round(decimal value) => Math.Round(value, 4, MidpointRounding.AwayFromZero);
}
