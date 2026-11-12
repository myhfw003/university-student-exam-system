namespace Exam.Application.Common.Attributes;

/// <summary>标注请求所需的权限码。由 AuthorizationBehavior 读取。</summary>
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public sealed class RequiresPermissionAttribute : Attribute
{
    public RequiresPermissionAttribute(string permissionCode) => PermissionCode = permissionCode;

    public string PermissionCode { get; }
}
