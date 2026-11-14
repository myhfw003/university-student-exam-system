using Exam.Domain.Catalog;

namespace Exam.Application.Common.Interfaces;

/// <summary>题目列表的过滤与排序条件。</summary>
public sealed record QuestionSearchCriteria
{
    public long? BankId { get; init; }

    public QuestionType? Type { get; init; }

    public QuestionStatus? Status { get; init; }

    /// <summary>标签过滤（不含难度维度）。</summary>
    public IReadOnlyList<long> TagIds { get; init; } = [];

    public bool IncludeDescendants { get; init; } = true;

    public TagMatchMode MatchMode { get; init; } = TagMatchMode.Any;

    /// <summary>难度过滤。</summary>
    public IReadOnlyList<long> DifficultyTagIds { get; init; } = [];

    /// <summary>关键词：命中题号或题干。</summary>
    public string? Keyword { get; init; }

    public int Skip { get; init; }

    public int Take { get; init; } = 20;

    /// <summary>排序字段：updatedAt（默认）、createdAt、code。</summary>
    public string? SortBy { get; init; }

    public bool SortDescending { get; init; } = true;
}

public interface IQuestionRepository
{
    /// <summary>取回题目（含选项、要点、步骤与标签）。用于修改场景，跟踪实体。</summary>
    Task<Question?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    Task<Question?> GetByCodeAsync(string code, CancellationToken cancellationToken = default);

    /// <summary>题号是否已被占用。</summary>
    Task<bool> CodeExistsAsync(string code, long? excludeQuestionId, CancellationToken cancellationToken = default);

    Task AddAsync(Question question, CancellationToken cancellationToken = default);

    void Update(Question question);

    void Remove(Question question);

    /// <summary>分页查询题目。所有过滤都在服务端完成。</summary>
    Task<IReadOnlyList<Question>> SearchAsync(
        QuestionSearchCriteria criteria,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(QuestionSearchCriteria criteria, CancellationToken cancellationToken = default);

    /// <summary>取回题目的完整视图（含子结构），用于详情响应。</summary>
    Task<IReadOnlyList<Question>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default);
}

public interface IQuestionBankRepository
{
    Task<QuestionBank?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    Task<QuestionBank?> GetByNameAsync(string name, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<QuestionBank>> ListAsync(CancellationToken cancellationToken = default);

    Task AddAsync(QuestionBank bank, CancellationToken cancellationToken = default);

    void Update(QuestionBank bank);

    void Remove(QuestionBank bank);
}
