namespace Exam.Web.Api.Contracts;

/// <summary>
/// 修改系统级设置。
/// <para>
/// <c>MistakeResolutionPolicy</c> 取值：
/// <c>remove</c>（移出错题本）/ <c>keep_mastered</c>（保留但标记已掌握）。
/// </para>
/// </summary>
public sealed record UpdateSystemSettingsRequest(string MistakeResolutionPolicy);
