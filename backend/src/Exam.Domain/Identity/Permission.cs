using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Identity;

/// <summary>权限点。编码形如 <c>模块:动作</c>。</summary>
public sealed class Permission : Entity<long>
{
    public Permission()
    {
    }

    private Permission(string code, string name, string module, string? description)
    {
        Code = code;
        Name = name;
        Module = module;
        Description = description;
    }

    public string Code { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;

    public string Module { get; private set; } = string.Empty;

    public string? Description { get; private set; }

    public static Permission Create(string code, string name, string module, string? description = null) =>
        new(code, name, module, description);
}
