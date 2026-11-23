namespace Exam.Web.Api.Contracts;

/// <summary>
/// 修改系统级设置。
/// <para>
/// <c>MistakeResolutionPolicy</c> 取值：
/// <c>remove</c>（移出错题本）/ <c>keep_mastered</c>（保留但标记已掌握）。
/// </para>
/// </summary>
public sealed record UpdateSystemSettingsRequest(string MistakeResolutionPolicy);

/// <summary>
/// 设置系统的**原始密码**（管理员重置用户密码时置成它）。
/// <para>
/// **只写不回显**：请求里给的是明文，响应里不给任何密码，
/// 只有「有没有配」这一位——原始密码由管理员自己另行告知用户。
/// </para>
/// </summary>
public sealed record SetOriginalPasswordRequest(string Password);
