using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Exam.Infrastructure.Seeding;

/// <summary>
/// 种子作业。写入权限目录、系统角色、管理员账号。
/// 通过 <c>seed_marker</c> 表保证幂等，重复执行安全。
/// </summary>
public sealed class DataSeeder
{
    public const string MarkerName = "iam.v2";

    private readonly AppDbContext _db;
    private readonly IClock _clock;
    private readonly IPasswordVerifier _passwordVerifier;
    private readonly ILogger<DataSeeder> _logger;

    public DataSeeder(
        AppDbContext db,
        IClock clock,
        IPasswordVerifier passwordVerifier,
        ILogger<DataSeeder> logger)
    {
        _db = db;
        _clock = clock;
        _passwordVerifier = passwordVerifier;
        _logger = logger;
    }

    /// <summary>写入系统预置的难度标签。已存在则跳过，保证幂等。</summary>
    private async Task SeedSystemTagsAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        (string Code, string Name, int Level)[] difficulties =
        [
            ("difficulty.basic", "基础", 1),
            ("difficulty.medium", "中等", 2),
            ("difficulty.hard", "较难", 3),
        ];

        foreach (var (code, name, level) in difficulties)
        {
            var exists = await _db.Tags.AnyAsync(x => x.Code == code, cancellationToken);
            if (exists)
            {
                continue;
            }

            var tag = Tag.Create(code, name, TagGroup.Difficulty, level, null, level, now, null, isSystem: true);
            await _db.Tags.AddAsync(tag, cancellationToken);
        }

        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<SeedOutcome> SeedAsync(
        string adminUsername,
        string? adminPassword,
        CancellationToken cancellationToken = default)
    {
        var now = _clock.UtcNow;

        var alreadySeeded = await _db.Set<SeedMarker>()
            .AnyAsync(x => x.Name == MarkerName, cancellationToken);

        if (alreadySeeded)
        {
            _logger.LogInformation("种子数据已存在，跳过。");
            return SeedOutcome.AlreadySeeded;
        }

        // 1. 权限
        var permissions = new List<Permission>();
        foreach (var code in PermissionCatalog.All)
        {
            var existing = await _db.Permissions.FirstOrDefaultAsync(x => x.Code == code, cancellationToken);
            if (existing is not null)
            {
                permissions.Add(existing);
                continue;
            }

            var name = PermissionCatalog.DisplayNames.TryGetValue(code, out var display) ? display : code;
            var permission = Permission.Create(code, name, code.Split(':')[0]);
            await _db.Permissions.AddAsync(permission, cancellationToken);
            permissions.Add(permission);
        }

        await _db.SaveChangesAsync(cancellationToken);

        // 2. 角色与角色权限
        var roleNames = new Dictionary<string, string>
        {
            [Role.Codes.SystemAdmin] = "系统管理员",
            [Role.Codes.ContentAdmin] = "内容管理员",
            [Role.Codes.AuthorTeacher] = "出题教师",
            [Role.Codes.GraderTeacher] = "阅卷教师",
            [Role.Codes.Student] = "在校学生",
            [Role.Codes.GeneralUser] = "社会人士",
        };

        var roles = new Dictionary<string, Role>(StringComparer.Ordinal);
        foreach (var (code, name) in roleNames)
        {
            var role = await _db.Roles.FirstOrDefaultAsync(x => x.Code == code, cancellationToken);
            if (role is null)
            {
                role = Role.CreateSystem(code, name, now);
                await _db.Roles.AddAsync(role, cancellationToken);
            }

            roles[code] = role;
        }

        await _db.SaveChangesAsync(cancellationToken);

        var permissionByCode = permissions.ToDictionary(p => p.Code, StringComparer.Ordinal);

        foreach (var (roleCode, permissionCodes) in PermissionCatalog.DefaultRolePermissions)
        {
            if (!roles.TryGetValue(roleCode, out var role))
            {
                continue;
            }

            foreach (var permissionCode in permissionCodes)
            {
                if (!permissionByCode.TryGetValue(permissionCode, out var permission))
                {
                    continue;
                }

                var exists = await _db.RolePermissions.AnyAsync(
                    x => x.RoleId == role.Id && x.PermissionId == permission.Id,
                    cancellationToken);

                if (!exists)
                {
                    await _db.RolePermissions.AddAsync(RolePermission.Create(role.Id, permission.Id, now));
                }
            }
        }

        // 3. 系统预置标签（难度维度三档）。系统标签不可删除。
        await SeedSystemTagsAsync(now, cancellationToken);

        // 4. 管理员账号
        var admin = await _db.Users.FirstOrDefaultAsync(x => x.Username == adminUsername, cancellationToken);
        string effectivePassword = adminPassword ?? string.Empty;

        if (admin is null)
        {
            if (string.IsNullOrWhiteSpace(effectivePassword))
            {
                effectivePassword = Pbkdf2PasswordVerifier.GenerateInitialPassword() + "aA1";
            }

            admin = User.Register(adminUsername, "系统管理员", _passwordVerifier.Hash(effectivePassword), now);
            await _db.Users.AddAsync(admin, cancellationToken);
            await _db.SaveChangesAsync(cancellationToken);

            await _db.UserRoles.AddAsync(UserRole.Create(admin.Id, roles[Role.Codes.SystemAdmin].Id, null, now));
            _logger.LogInformation("已创建管理员账号 {Username}，初始密码：{Password}", adminUsername, effectivePassword);
        }

        // 5. 标记
        await _db.Set<SeedMarker>().AddAsync(SeedMarker.Create(MarkerName, now));
        await _db.SaveChangesAsync(cancellationToken);

        return SeedOutcome.Seeded;
    }
}

public enum SeedOutcome
{
    Seeded,
    AlreadySeeded,
}
