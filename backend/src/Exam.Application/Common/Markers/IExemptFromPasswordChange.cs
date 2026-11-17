namespace Exam.Application.Common.Markers;

/// <summary>
/// 标记「强制改密期间仍然放行」的请求。
/// <para>
/// 管理员重置密码或导入名单后，用户必须先改密才能继续用系统。
/// 这期间只放行本标记的请求：改密、查看本人档案、登出。
/// </para>
/// </summary>
public interface IExemptFromPasswordChange
{
}
