using Exam.Application.Common.Interfaces;

namespace Exam.Worker;

/// <summary>
/// 后台进程的调用者。
/// <para>
/// Worker 不是「某个人」在操作：它跑的是定时作业，写进去的数据由作业本身
/// 负责说明（对账差异、统计重算），审计记录里不记操作人。
/// </para>
/// <para>
/// 必须有它：审计拦截器与审计记录器都要读当前调用者，而 Worker 是唯一
/// 没有 HTTP 请求上下文的进程——不提供实现的话，Worker 连数据库上下文
/// 都构造不出来（后台作业与迁移会直接启动失败）。
/// </para>
/// </summary>
public sealed class BackgroundCurrentUser : ICurrentUser
{
    public bool IsAuthenticated => false;

    public long? UserId => null;

    public string? Username => null;

    public string? DisplayName => null;

    public IReadOnlySet<string> Permissions => new HashSet<string>(StringComparer.Ordinal);

    public bool HasPermission(string permissionCode) => false;

    public bool MustChangePassword => false;
}
