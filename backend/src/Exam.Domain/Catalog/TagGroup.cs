namespace Exam.Domain.Catalog;

/// <summary>
/// 标签维度。共五维：领域 / 知识点 / 能力 / 难度 / 组织。
/// </summary>
public enum TagGroup
{
    /// <summary>领域。</summary>
    Domain,

    /// <summary>知识点。</summary>
    KnowledgePoint,

    /// <summary>能力。</summary>
    Ability,

    /// <summary>难度。</summary>
    Difficulty,

    /// <summary>组织（院系 / 专业 / 班级）。只挂用户，不挂题目。</summary>
    Organization,
}

/// <summary>标签维度的元数据：中文标签名、是否允许层级、挂载对象。</summary>
public static class TagGroups
{
    /// <summary>数据库存储值。</summary>
    public static string ToStorage(this TagGroup group) => group switch
    {
        TagGroup.Domain => "domain",
        TagGroup.KnowledgePoint => "knowledge_point",
        TagGroup.Ability => "ability",
        TagGroup.Difficulty => "difficulty",
        TagGroup.Organization => "organization",
        _ => throw new ArgumentOutOfRangeException(nameof(group), group, "未知的标签维度。"),
    };

    /// <summary>由数据库存储值解析维度；无法识别时返回 null。</summary>
    public static TagGroup? FromStorage(string? storage) => storage switch
    {
        "domain" => TagGroup.Domain,
        "knowledge_point" => TagGroup.KnowledgePoint,
        "ability" => TagGroup.Ability,
        "difficulty" => TagGroup.Difficulty,
        "organization" => TagGroup.Organization,
        _ => null,
    };

    /// <summary>维度中文名，用于前端展示与错误提示。</summary>
    public static string Label(this TagGroup group) => group switch
    {
        TagGroup.Domain => "领域",
        TagGroup.KnowledgePoint => "知识点",
        TagGroup.Ability => "能力",
        TagGroup.Difficulty => "难度",
        TagGroup.Organization => "组织",
        _ => "未知",
    };

    /// <summary>是否允许父子层级。难度维度是平铺的。</summary>
    public static bool AllowsHierarchy(this TagGroup group) => group != TagGroup.Difficulty;

    /// <summary>该维度是否可挂到题目上。组织维度只挂用户。</summary>
    public static bool AppliesToQuestions(this TagGroup group) => group != TagGroup.Organization;

    /// <summary>该维度是否可挂到用户上。目前只有组织维度。</summary>
    public static bool AppliesToUsers(this TagGroup group) => group == TagGroup.Organization;

    /// <summary>全部维度。</summary>
    public static IReadOnlyList<TagGroup> All { get; } =
    [
        TagGroup.Domain,
        TagGroup.KnowledgePoint,
        TagGroup.Ability,
        TagGroup.Difficulty,
        TagGroup.Organization,
    ];
}
