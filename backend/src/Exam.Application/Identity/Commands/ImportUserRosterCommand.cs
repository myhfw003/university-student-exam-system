using Exam.Application.Catalog.Services;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Application.Settings.Services;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>
/// 批量导入学生名单（CSV）。
/// <para>
/// 逐行处理：单行出错只跳过该行并记录原因，不阻断整批；
/// 重复账号执行更新且**不重置密码**；缺失的院系 / 专业 / 班级标签自动创建并按层级挂接。
/// </para>
/// </summary>
public sealed record ImportUserRosterCommand(byte[] FileContent, string FileName)
    : IAppCommand<UserImportResult>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.UserImport];
}

public sealed class ImportUserRosterCommandValidator : AbstractValidator<ImportUserRosterCommand>
{
    public ImportUserRosterCommandValidator()
    {
        RuleFor(x => x.FileContent)
            .NotNull().WithMessage("请上传名单文件。");

        RuleFor(x => x.FileContent!.Length)
            .GreaterThan(0).WithMessage("名单文件是空的。")
            .LessThanOrEqualTo(10 * 1024 * 1024).WithMessage("名单文件不能超过 10 MB。");
    }
}

public sealed class ImportUserRosterHandler : IRequestHandler<ImportUserRosterCommand, UserImportResult>
{
    private readonly IUserRosterParser _parser;
    private readonly IUserRepository _users;
    private readonly IUserRoleRepository _userRoles;
    private readonly IUserTagRepository _userTags;
    private readonly IRoleRepository _roles;
    private readonly ITagRepository _tags;
    private readonly OrganizationTagProvisioner _organizationTags;
    private readonly IPasswordVerifier _passwordVerifier;
    private readonly SystemSettingsResolver _settings;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ImportUserRosterHandler(
        IUserRosterParser parser,
        IUserRepository users,
        IUserRoleRepository userRoles,
        IUserTagRepository userTags,
        IRoleRepository roles,
        ITagRepository tags,
        OrganizationTagProvisioner organizationTags,
        IPasswordVerifier passwordVerifier,
        SystemSettingsResolver settings,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _parser = parser;
        _users = users;
        _userRoles = userRoles;
        _userTags = userTags;
        _roles = roles;
        _tags = tags;
        _organizationTags = organizationTags;
        _passwordVerifier = passwordVerifier;
        _settings = settings;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<UserImportResult> Handle(
        ImportUserRosterCommand request,
        CancellationToken cancellationToken)
    {
        var rows = _parser.Parse(request.FileContent, request.FileName);

        var failures = new List<UserImportFailure>();
        var created = 0;
        var updated = 0;

        // CSV 没给密码的行用**系统设定的原始密码**建号。取一次就够：
        // 整个导入是一次操作，不该每行都去查一遍设置。
        var originalPasswordHash = await _settings.GetOriginalPasswordHashAsync(cancellationToken);

        foreach (var row in rows)
        {
            var outcome = await ProcessRowAsync(row, originalPasswordHash, cancellationToken);
            switch (outcome.Kind)
            {
                case RowOutcomeKind.Created:
                    created++;
                    break;
                case RowOutcomeKind.Updated:
                    updated++;
                    break;
                case RowOutcomeKind.Failed:
                    failures.Add(new UserImportFailure(row.RowNumber, row.Account, outcome.Reason!));
                    break;
            }
        }

        await _audit.RecordAsync(
            "user.import-roster",
            "user",
            null,
            new Dictionary<string, object?>
            {
                ["fileName"] = request.FileName,
                ["total"] = rows.Count,
                ["created"] = created,
                ["updated"] = updated,
                ["failed"] = failures.Count,
            },
            cancellationToken);

        return new UserImportResult(
            rows.Count,
            created + updated,
            created,
            updated,
            failures);
    }

    private async Task<RowOutcome> ProcessRowAsync(
        UserRosterRow row,
        string? originalPasswordHash,
        CancellationToken cancellationToken)
    {
        var account = row.Account?.Trim();
        if (string.IsNullOrEmpty(account))
        {
            return RowOutcome.Failed("账号为空。");
        }

        if (!UsernamePolicy.IsValid(account))
        {
            return RowOutcome.Failed(
                $"账号格式不正确：需 {UsernamePolicy.MinLength} 到 {UsernamePolicy.MaxLength} 位，"
                + "只含字母、数字、下划线、点和中划线。");
        }

        var displayName = row.Name?.Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            return RowOutcome.Failed("姓名为空。");
        }

        var roleCode = await ResolveRoleCodeAsync(row, cancellationToken);
        if (roleCode is null)
        {
            return RowOutcome.Failed($"未知角色：{row.Role!.Trim()}。");
        }

        var role = await _roles.GetByCodeAsync(roleCode, cancellationToken);
        if (role is null)
        {
            return RowOutcome.Failed($"角色不存在：{roleCode}。");
        }

        long? deepestTagId = null;
        var faculty = row.Faculty?.Trim();
        var major = row.Major?.Trim();
        var clazz = row.Class?.Trim();

        if (!string.IsNullOrEmpty(clazz) && (string.IsNullOrEmpty(major) || string.IsNullOrEmpty(faculty)))
        {
            return RowOutcome.Failed("班级路径不完整：填写班级时必须同时填写学院与专业。");
        }

        if (!string.IsNullOrEmpty(major) && string.IsNullOrEmpty(faculty))
        {
            return RowOutcome.Failed("专业路径不完整：填写专业时必须同时填写学院。");
        }

        try
        {
            if (!string.IsNullOrEmpty(faculty))
            {
                var facultyTag = await _organizationTags.EnsureAsync(null, faculty, cancellationToken);
                deepestTagId = facultyTag.Id;

                if (!string.IsNullOrEmpty(major))
                {
                    var majorTag = await _organizationTags.EnsureAsync(facultyTag.Id, major, cancellationToken);
                    deepestTagId = majorTag.Id;

                    if (!string.IsNullOrEmpty(clazz))
                    {
                        var classTag = await _organizationTags.EnsureAsync(majorTag.Id, clazz, cancellationToken);
                        deepestTagId = classTag.Id;
                    }
                }
            }

            var existing = await _users.GetByUsernameAsync(account, cancellationToken);
            if (existing is not null)
            {
                await UpdateExistingAsync(existing, displayName, row.Email, role.Id, deepestTagId, cancellationToken);
                return RowOutcome.Updated();
            }

            await CreateNewAsync(
                account, displayName, row, role.Id, deepestTagId, originalPasswordHash, cancellationToken);
            return RowOutcome.Created();
        }
        catch (DomainException ex)
        {
            return RowOutcome.Failed(ex.Message);
        }
    }

    private async Task UpdateExistingAsync(
        User user,
        string displayName,
        string? email,
        long roleId,
        long? tagId,
        CancellationToken cancellationToken)
    {
        var now = _clock.UtcNow;

        // 更新档案，但**不重置密码**——重复导入名单不该把学生的密码改掉。
        user.ChangeProfile(displayName, email, user.Phone, now, _currentUser.UserId);

        var links = await _userTags.GetByUserAsync(user.Id, cancellationToken);
        var currentTagIds = links.Select(l => l.TagId).ToHashSet();

        foreach (var link in links.Where(l => tagId is null || l.TagId != tagId.Value))
        {
            _userTags.Remove(link);
        }

        if (tagId is not null && !currentTagIds.Contains(tagId.Value))
        {
            await _userTags.AddAsync(UserTag.Create(user.Id, tagId.Value, now), cancellationToken);
        }

        var roleIds = await _userRoles.GetRoleIdsAsync(user.Id, cancellationToken);
        if (!roleIds.Contains(roleId))
        {
            var roleLinks = await _userRoles.GetByUserAsync(user.Id, cancellationToken);
            foreach (var link in roleLinks.Where(l => l.RoleId != roleId))
            {
                _userRoles.Remove(link);
            }

            await _userRoles.AddAsync(UserRole.Create(user.Id, roleId, _currentUser.UserId, now), cancellationToken);
        }

        _users.Update(user);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
    }

    private async Task CreateNewAsync(
        string account,
        string displayName,
        UserRosterRow row,
        long roleId,
        long? tagId,
        string? originalPasswordHash,
        CancellationToken cancellationToken)
    {
        // 密码有两个来源：CSV 明文给的，或**系统设定的原始密码**。
        // 没配原始密码就不建号——凭空生成的密码谁也拿不到，账号建出来也是空壳。
        var password = row.Password?.Trim();
        string passwordHash;
        var usedOriginalPassword = false;

        if (string.IsNullOrEmpty(password))
        {
            if (originalPasswordHash is null)
            {
                throw new OriginalPasswordNotConfiguredException(
                    "尚未配置原始密码，无法建账号。请先在「系统设置」中配置原始密码。");
            }

            passwordHash = originalPasswordHash;
            usedOriginalPassword = true;
        }
        else
        {
            var failures = PasswordPolicy.Validate(password, account);
            if (failures.Count > 0)
            {
                throw new BusinessRuleException("密码不符合要求：" + string.Join(" ", failures));
            }

            passwordHash = _passwordVerifier.Hash(password);
        }

        var now = _clock.UtcNow;
        var user = User.Register(
            account,
            displayName,
            passwordHash,
            now,
            _currentUser.UserId);

        user.ChangeProfile(displayName, row.Email, null, now, _currentUser.UserId);

        if (usedOriginalPassword)
        {
            user.MarkMustChangePassword(now, _currentUser.UserId);
        }

        await _users.AddAsync(user, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _userRoles.AddAsync(UserRole.Create(user.Id, roleId, _currentUser.UserId, now), cancellationToken);

        if (tagId is not null)
        {
            await _userTags.AddAsync(UserTag.Create(user.Id, tagId.Value, now), cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// 决定这一行用哪个角色：
    /// CSV 指定了角色就用指定的；没指定时，有班级归属的是在校学生，
    /// 三列全空的是社会人士。
    /// </summary>
    private async Task<string?> ResolveRoleCodeAsync(UserRosterRow row, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(row.Role))
        {
            var code = row.Role.Trim();
            var role = await _roles.GetByCodeAsync(code, cancellationToken);
            return role is null ? null : role.Code;
        }

        var hasOrganization = !string.IsNullOrWhiteSpace(row.Faculty);
        return hasOrganization ? Role.Codes.Student : Role.Codes.GeneralUser;
    }

    private enum RowOutcomeKind
    {
        Created,
        Updated,
        Failed,
    }

    private sealed record RowOutcome(RowOutcomeKind Kind, string? Reason)
    {
        public static RowOutcome Created() => new(RowOutcomeKind.Created, null);

        public static RowOutcome Updated() => new(RowOutcomeKind.Updated, null);

        public static RowOutcome Failed(string reason) => new(RowOutcomeKind.Failed, reason);
    }
}
