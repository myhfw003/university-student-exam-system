using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Application.Catalog.Services;

/// <summary>
/// 组织维度标签的按需创建。
/// <para>
/// 导入学生名单时，CSV 里的院系 / 专业 / 班级常常还没有对应的标签。
/// 这里按「同一父节点下的同名标签」查找，找到就用，找不到就建一个，
/// 并保证编码唯一——因此同一批名单里重复出现的学院只会建一次。
/// </para>
/// </summary>
public sealed class OrganizationTagProvisioner
{
    private const string CodePrefix = "org.";

    private readonly ITagRepository _tags;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public OrganizationTagProvisioner(
        ITagRepository tags,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser)
    {
        _tags = tags;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    /// <summary>确保「父节点下的同名组织标签」存在，返回该标签。</summary>
    public async Task<Tag> EnsureAsync(long? parentId, string name, CancellationToken cancellationToken)
    {
        var trimmed = name.Trim();
        if (trimmed.Length == 0)
        {
            throw new BusinessRuleException("组织标签名称不能为空。");
        }

        var existing = await _tags.GetByParentAndNameAsync(parentId, trimmed, cancellationToken);
        if (existing is not null)
        {
            return existing;
        }

        var code = await BuildUniqueCodeAsync(trimmed, cancellationToken);
        var tag = Tag.Create(
            code,
            trimmed,
            TagGroup.Organization,
            null,
            null,
            0,
            _clock.UtcNow,
            _currentUser.UserId);

        if (parentId is not null)
        {
            tag.SetParent(
                await _tags.GetByIdAsync(parentId.Value, cancellationToken)
                    ?? throw new BusinessRuleException("父级组织标签不存在。"),
                _clock.UtcNow,
                _currentUser.UserId);
        }

        await _tags.AddAsync(tag, cancellationToken);

        // 主键由数据库生成，后续的子标签要挂在它下面，因此先落库。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return tag;
    }

    /// <summary>
    /// 把标签名转成编码允许的字符集。
    /// <para>
    /// 编码允许字母（含中文）、数字、下划线、点与中划线。班级名里常有空格
    /// （「计科 2301 班」），这些字符要换成中划线——否则整行名单会因为
    /// 「编码非法」被跳过，而组织标签本来就该由名单自动创建。
    /// </para>
    /// </summary>
    private static string SanitizeForCode(string name)
    {
        var chars = name.Select(ch =>
            char.IsAsciiLetterOrDigit(ch)
            || ch is '_' or '.' or '-'
            || (char.IsLetter(ch) && !char.IsAscii(ch))
                ? ch
                : '-');
        return new string(chars.ToArray());
    }

    private async Task<string> BuildUniqueCodeAsync(string name, CancellationToken cancellationToken)
    {
        var baseCode = CodePrefix + SanitizeForCode(name);
        if (baseCode.Length > Tag.MaxCodeLength)
        {
            baseCode = baseCode[..Tag.MaxCodeLength];
        }

        var candidate = baseCode;
        var suffix = 2;
        while (await _tags.GetByCodeAsync(candidate, cancellationToken) is not null)
        {
            var tail = $"-{suffix++}";
            candidate = baseCode[..Math.Min(baseCode.Length, Tag.MaxCodeLength - tail.Length)] + tail;
        }

        return candidate;
    }
}
