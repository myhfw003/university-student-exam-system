using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Catalog;

/// <summary>
/// 标签聚合根。五个维度共用一张表，用 <see cref="Group"/> 区分。
/// <para>层级只允许同维度内部；难度维度是平铺的且必须带 <see cref="Level"/>。</para>
/// </summary>
public sealed class Tag : AuditableEntity
{
    public const int MaxNameLength = 50;

    public const int MaxCodeLength = 64;

    public const int MaxDescriptionLength = 500;

    public const int MinDifficultyLevel = 1;

    public const int MaxDifficultyLevel = 5;

    private Tag()
    {
    }

    private Tag(
        string code,
        string name,
        TagGroup group,
        int? level,
        string? description,
        int sortOrder,
        bool isSystem,
        DateTimeOffset now,
        long? actorId)
        : base(now, actorId)
    {
        Code = code;
        Name = name;
        Group = group;
        Level = level;
        Description = description;
        SortOrder = sortOrder;
        IsSystem = isSystem;
        UsageCount = 0;
    }

    /// <summary>稳定编码，如 <c>math.calculus.limit</c>。用于导入与外部引用。</summary>
    public string Code { get; private set; } = string.Empty;

    /// <summary>显示名。</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>所属维度。</summary>
    public TagGroup Group { get; private set; }

    /// <summary>同维度内的父标签。难度维度恒为 null。</summary>
    public long? ParentId { get; private set; }

    /// <summary>难度层级 1..5。仅难度维度有值。</summary>
    public int? Level { get; private set; }

    public string? Description { get; private set; }

    public int SortOrder { get; private set; }

    /// <summary>系统预置标签，不可删除。</summary>
    public bool IsSystem { get; private set; }

    /// <summary>被引用次数。由引用方的增删行为维护。</summary>
    public int UsageCount { get; private set; }

    public static Tag Create(
        string code,
        string name,
        TagGroup group,
        int? level,
        string? description,
        int sortOrder,
        DateTimeOffset now,
        long? actorId = null,
        bool isSystem = false)
    {
        EnsureCodeFormat(code);
        EnsureName(name);
        EnsureLevelForGroup(group, level);

        return new Tag(
            code.Trim(),
            name.Trim(),
            group,
            level,
            string.IsNullOrWhiteSpace(description) ? null : description.Trim(),
            sortOrder,
            isSystem,
            now,
            actorId);
    }

    public void Rename(string name, DateTimeOffset now, long? actorId = null)
    {
        EnsureName(name);
        Name = name.Trim();
        Touch(now, actorId);
    }

    public void ChangeDescription(string? description, DateTimeOffset now, long? actorId = null)
    {
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        Touch(now, actorId);
    }

    public void SetSortOrder(int sortOrder, DateTimeOffset now, long? actorId = null)
    {
        SortOrder = sortOrder;
        Touch(now, actorId);
    }

    /// <summary>
    /// 挂到同维度的父标签下。<paramref name="parent"/> 为 null 表示置为顶级标签。
    /// 难度维度不允许有父；父必须是同维度且不能是自己。
    /// </summary>
    public void SetParent(Tag? parent, DateTimeOffset now, long? actorId = null)
    {
        if (!Group.AllowsHierarchy())
        {
            throw new BusinessRuleException("难度维度的标签没有层级关系。");
        }

        if (parent is not null)
        {
            if (Id != default && parent.Id == Id)
            {
                throw new BusinessRuleException("标签不能以自身为父标签。");
            }

            if (parent.Group != Group)
            {
                throw new BusinessRuleException($"父标签必须与当前标签属于同一维度（{Group.Label()}）。");
            }
        }

        ParentId = parent?.Id;
        Touch(now, actorId);
    }

    /// <summary>设置难度层级。仅难度维度可调用。</summary>
    public void SetLevel(int? level, DateTimeOffset now, long? actorId = null)
    {
        EnsureLevelForGroup(Group, level);
        Level = level;
        Touch(now, actorId);
    }

    /// <summary>
    /// 删除前的引用检查。系统标签、有子标签、被用户或题目引用的标签都不可删除。
    /// </summary>
    public void EnsureDeletable(bool hasChildren, bool usedByUsers, bool usedByQuestions)
    {
        if (IsSystem)
        {
            throw new TagInUseException($"系统预置标签「{Name}」不可删除。");
        }

        if (hasChildren)
        {
            throw new TagInUseException($"标签「{Name}」下仍有子标签，请先移除子标签。");
        }

        if (usedByUsers)
        {
            throw new TagInUseException($"标签「{Name}」仍被用户引用，无法删除。");
        }

        if (usedByQuestions)
        {
            throw new TagInUseException($"标签「{Name}」仍被题目引用，无法删除。");
        }
    }

    public void IncrementUsage()
    {
        UsageCount++;
    }

    public void DecrementUsage()
    {
        if (UsageCount <= 0)
        {
            throw new BusinessRuleException("标签引用次数不能为负。");
        }

        UsageCount--;
    }

    private static void EnsureCodeFormat(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new BusinessRuleException("标签编码不能为空。");
        }

        var trimmed = code.Trim();
        if (trimmed.Length > MaxCodeLength)
        {
            throw new BusinessRuleException($"标签编码长度不能超过 {MaxCodeLength} 位。");
        }

        foreach (var ch in trimmed)
        {
            var ok = char.IsAsciiLetterOrDigit(ch) || ch is '_' or '.' or '-';
            if (!ok)
            {
                throw new BusinessRuleException("标签编码只能包含字母、数字、下划线、点和中划线。");
            }
        }
    }

    private static void EnsureName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new BusinessRuleException("标签名称不能为空。");
        }

        if (name.Trim().Length > MaxNameLength)
        {
            throw new BusinessRuleException($"标签名称长度不能超过 {MaxNameLength} 位。");
        }
    }

    private static void EnsureLevelForGroup(TagGroup group, int? level)
    {
        if (group == TagGroup.Difficulty)
        {
            if (level is null)
            {
                throw new BusinessRuleException("难度维度的标签必须指定难度等级（1 到 5）。");
            }

            if (level is < MinDifficultyLevel or > MaxDifficultyLevel)
            {
                throw new BusinessRuleException(
                    $"难度等级必须在 {MinDifficultyLevel} 到 {MaxDifficultyLevel} 之间。");
            }

            return;
        }

        if (level is not null)
        {
            throw new BusinessRuleException($"只有难度维度的标签可以指定难度等级，{group.Label()}维度不支持。");
        }
    }
}
