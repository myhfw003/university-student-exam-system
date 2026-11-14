using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Identity;

/// <summary>角色。系统内置角色不可删除，只能调整其权限集合。</summary>
public sealed class Role : AuditableEntity, IAuditedEntity
{
    public static class Codes
    {
        public const string SystemAdmin = "system_admin";
        public const string ContentAdmin = "content_admin";
        public const string AuthorTeacher = "author_teacher";
        public const string GraderTeacher = "grader_teacher";
        public const string Student = "student";
        public const string GeneralUser = "general_user";
    }

    private Role()
    {
    }

    private Role(string code, string name, string? description, bool isSystem, DateTimeOffset now, long? actorId)
        : base(now, actorId)
    {
        Code = code;
        Name = name;
        Description = description;
        IsSystem = isSystem;
    }

    public string Code { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;

    public string? Description { get; private set; }

    public bool IsSystem { get; private set; }

    public static Role CreateSystem(
        string code,
        string name,
        DateTimeOffset now,
        long? actorId = null,
        string? description = null) =>
        new(code, name, description, isSystem: true, now, actorId);

    /// <summary>新建自定义角色。系统内置角色不可通过该入口创建。</summary>
    public static Role Create(
        string code,
        string name,
        DateTimeOffset now,
        long? actorId = null,
        string? description = null)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new BusinessRuleException("角色编码不能为空。");
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            throw new BusinessRuleException("角色名称不能为空。");
        }

        return new Role(code.Trim(), name.Trim(), description, isSystem: false, now, actorId);
    }

    public void Rename(string name, DateTimeOffset now, long? actorId = null)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new BusinessRuleException("角色名称不能为空。");
        }

        Name = name.Trim();
        Touch(now, actorId);
    }

    public void ChangeDescription(string? description, DateTimeOffset now, long? actorId = null)
    {
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        Touch(now, actorId);
    }
}
