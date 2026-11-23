using Exam.Domain.SharedKernel.Exceptions;

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

    /// <summary>
    /// 内容维度：领域 / 知识点 / 能力。
    /// <para>
    /// 这三个维度是题目的分类轴，彼此之间**可以成树（跨维度）**——
    /// 需求 FR-CAT-02 的验收例子「选『高等数学』命中其下所有知识点」
    /// 要求领域标签下面能挂知识点标签。
    /// </para>
    /// </summary>
    public static bool IsContentDimension(this TagGroup group) =>
        group is TagGroup.Domain or TagGroup.KnowledgePoint or TagGroup.Ability;

    /// <summary>
    /// 这两个维度之间能不能成父子关系。
    /// <para>
    /// - 难度维度平铺，不能有父；
    /// - 组织维度自成一体：只挂组织维度的父，也不能当内容标签的父
    ///   （组织维度只作用于用户，见 FR-CAT-01 的维度隔离）；
    /// - 内容维度（领域 / 知识点 / 能力）之间可以跨维度成树。
    /// </para>
    /// </summary>
    public static bool CanNest(this TagGroup parentGroup, TagGroup childGroup)
    {
        if (childGroup == TagGroup.Difficulty)
        {
            return false;
        }

        if (childGroup == TagGroup.Organization)
        {
            return parentGroup == TagGroup.Organization;
        }

        return parentGroup != TagGroup.Organization;
    }

    /// <summary>
    /// 校验父子维度关系；不合法就抛出带原因的业务异常。
    /// <para>
    /// 三处校验（建标签、改标签、领域层的 SetParent）都走这里，
    /// 免得各写一套、说法还不一样。
    /// </para>
    /// </summary>
    public static void EnsureCanNest(this TagGroup parentGroup, TagGroup childGroup)
    {
        if (CanNest(parentGroup, childGroup))
        {
            return;
        }

        if (childGroup == TagGroup.Difficulty)
        {
            throw new BusinessRuleException("难度维度的标签没有层级关系。");
        }

        if (childGroup == TagGroup.Organization)
        {
            throw new BusinessRuleException("组织维度的标签只能挂在组织维度的父标签下。");
        }

        throw new BusinessRuleException("组织维度的标签只作用于用户，不能作为其它维度标签的父标签。");
    }

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
