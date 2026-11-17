using Exam.Application.Analytics.Contracts;
using Exam.Application.Analytics.Services;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Services;
using Exam.Domain.Analytics;
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
    private readonly ExamAccessScope _scope;

    public GetExamSessionStatisticsHandler(
        IExamSessionRepository sessions,
        IPaperSnapshotRepository snapshots,
        IExamStatisticRepository readModel,
        ExamStatisticsService service,
        ExamAccessScope scope)
    {
        _sessions = sessions;
        _snapshots = snapshots;
        _readModel = readModel;
        _service = service;
        _scope = scope;
    }

    public async Task<ExamSessionStatisticsResponse> Handle(
        GetExamSessionStatisticsQuery request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        // 统计只对自己负责的场次开放。
        await _scope.EnsureSessionVisibleAsync(session.Id, cancellationToken);

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
                decimal? correctRate = q.AnsweredCount > 0
                    ? Round((decimal)q.CorrectCount / q.AnsweredCount)
                    : null;

                return new QuestionStatisticDto(
                    q.QuestionId,
                    item?.QuestionCode ?? string.Empty,
                    type,
                    TypeLabel(type),
                    item?.Stem ?? string.Empty,
                    item?.Score.Value ?? 0m,
                    q.AnsweredCount,
                    q.CorrectCount,
                    correctRate,
                    q.AverageScore,
                    q.MasteryRate,
                    AnalyticsRules.ReviewSuggestion(correctRate, q.MasteryRate, q.AnsweredCount));
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

        var roster = await _service.BuildRosterAsync(session.Id, cancellationToken);

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
            roster,
            statistic.UpdatedAt);
    }

    private static string TypeLabel(string storage) =>
        QuestionTypes.FromStorage(storage)?.Label() ?? storage;

    private static decimal Round(decimal value) => Math.Round(value, 4, MidpointRounding.AwayFromZero);
}

/// <summary>
/// 一道题在全部场次里的逐题正确率。
/// <para>跨场次汇总：答了哪些场次、每场次的作答数与正确率，以及总体正确率与讲评建议。</para>
/// </summary>
public sealed record GetQuestionStatisticsQuery(long QuestionId)
    : IAppQuery<QuestionStatisticsResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AnalyticsRead];
}

public sealed class GetQuestionStatisticsHandler
    : IRequestHandler<GetQuestionStatisticsQuery, QuestionStatisticsResponse>
{
    private readonly ExamStatisticsService _service;
    private readonly IPaperRepository _papers;
    private readonly ExamAccessScope _scope;

    public GetQuestionStatisticsHandler(
        ExamStatisticsService service,
        IPaperRepository papers,
        ExamAccessScope scope)
    {
        _service = service;
        _papers = papers;
        _scope = scope;
    }

    public async Task<QuestionStatisticsResponse> Handle(
        GetQuestionStatisticsQuery request,
        CancellationToken cancellationToken)
    {
        // 跨场次汇总只对自己可见的卷子开放：这题在自己的卷子里才看得到统计。
        var scope = await _scope.ResolveAsync(cancellationToken);
        if (scope.Tier != AccessScopeTier.Manager)
        {
            var visiblePapers = await _papers.GetByIdsAsync(scope.PaperIds.ToList(), cancellationToken);
            var owns = visiblePapers.Any(p => p.Items.Any(i => i.QuestionId == request.QuestionId));
            if (!owns)
            {
                throw new ForbiddenException("你没有查看该题统计的权限。");
            }
        }

        var summary = await _service.BuildQuestionSummaryAsync(request.QuestionId, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        return summary;
    }
}
