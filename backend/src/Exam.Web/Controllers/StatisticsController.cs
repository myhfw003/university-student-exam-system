using Exam.Application.Analytics.Contracts;
using Exam.Application.Analytics.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>成绩统计与分析。</summary>
[ApiController]
[Route("api/v1/statistics")]
[Authorize]
public sealed class StatisticsController : ControllerBase
{
    private readonly IMediator _mediator;

    public StatisticsController(IMediator mediator) => _mediator = mediator;

    /// <summary>
    /// 某场考试的成绩分析：平均分、极差、及格率、优秀率、分数段分布、
    /// 题型得分率与逐题统计。
    /// </summary>
    [HttpGet("exam-sessions/{examSessionId:long}")]
    [Authorize(Policy = PermissionCatalog.AnalyticsRead)]
    [ProducesResponseType(typeof(ExamSessionStatisticsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ExamSessionStatisticsResponse> GetExamSession(
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetExamSessionStatisticsQuery(examSessionId), cancellationToken);

    /// <summary>
    /// 一道题在全部场次里的逐题正确率：总体正确率、掌握度、讲评建议与逐场次明细。
    /// </summary>
    [HttpGet("questions/{questionId:long}")]
    [Authorize(Policy = PermissionCatalog.AnalyticsRead)]
    [ProducesResponseType(typeof(QuestionStatisticsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<QuestionStatisticsResponse> GetQuestion(
        long questionId,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetQuestionStatisticsQuery(questionId), cancellationToken);
}
