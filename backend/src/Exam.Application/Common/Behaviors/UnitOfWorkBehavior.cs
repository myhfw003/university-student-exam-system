using Exam.Application.Common.Markers;
using Exam.Domain.SharedKernel.Abstractions;
using MediatR;

namespace Exam.Application.Common.Behaviors;

/// <summary>
/// 工作单元提交。写命令在 Handler 成功返回后统一保存，
/// EF Core 的单次 SaveChanges 本身即一个事务，保证跨聚合的原子性。
/// </summary>
public sealed class UnitOfWorkBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly IUnitOfWork _unitOfWork;

    public UnitOfWorkBehavior(IUnitOfWork unitOfWork) => _unitOfWork = unitOfWork;

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        var response = await next();

        if (request is IAppWriteRequest)
        {
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return response;
    }
}
