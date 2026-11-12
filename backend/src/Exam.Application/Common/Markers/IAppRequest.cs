using MediatR;

namespace Exam.Application.Common.Markers;

/// <summary>写请求标记。实现该标记的请求在 Handler 成功后触发工作单元提交。</summary>
public interface IAppWriteRequest
{
}

/// <summary>不返回业务结果的写命令。</summary>
public interface IAppCommand : IAppWriteRequest, IRequest<Unit>
{
}

/// <summary>返回业务结果的写命令。</summary>
public interface IAppCommand<TResponse> : IAppWriteRequest, IRequest<TResponse>
{
}

/// <summary>只读查询标记。查询不改变状态，不触发工作单元提交。</summary>
public interface IAppQuery<TResponse> : IRequest<TResponse>
{
}
