using Exam.Domain.Identity;
using Shouldly;

namespace Exam.Domain.UnitTests.Identity;

public sealed class PermissionCatalogTests
{
    [Fact]
    public void All_权限码不重复()
    {
        PermissionCatalog.All.ShouldBeUnique();
    }

    [Fact]
    public void All_每个权限码都有中文显示名()
    {
        foreach (var code in PermissionCatalog.All)
        {
            PermissionCatalog.DisplayNames.ShouldContainKey(code);
        }
    }

    [Fact]
    public void DefaultRolePermissions_权限码均存在于全量目录()
    {
        foreach (var (roleCode, permissions) in PermissionCatalog.DefaultRolePermissions)
        {
            foreach (var permission in permissions)
            {
                PermissionCatalog.All.ShouldContain(permission, $"角色 {roleCode} 引用了未登记的权限 {permission}");
            }
        }
    }

    [Fact]
    public void DefaultRolePermissions_每个角色都有定义()
    {
        var roleCodes = new[]
        {
            Role.Codes.SystemAdmin, Role.Codes.ContentAdmin, Role.Codes.AuthorTeacher,
            Role.Codes.GraderTeacher, Role.Codes.Student, Role.Codes.GeneralUser,
        };

        foreach (var code in roleCodes)
        {
            PermissionCatalog.DefaultRolePermissions.ShouldContainKey(code);
        }
    }

    [Fact]
    public void DefaultRolePermissions_系统管理员拥有全部权限()
    {
        PermissionCatalog.DefaultRolePermissions[Role.Codes.SystemAdmin]
            .OrderBy(x => x)
            .ShouldBe(PermissionCatalog.All.OrderBy(x => x).ToArray());
    }
}
