using Exam.Domain.Authoring;

namespace Exam.Application.Common.Interfaces;

public interface IBlueprintRepository
{
    /// <summary>取回试卷的组卷方案。一份试卷至多一份方案。</summary>
    Task<Blueprint?> GetByPaperAsync(long paperId, CancellationToken cancellationToken = default);

    Task AddAsync(Blueprint blueprint, CancellationToken cancellationToken = default);

    void Update(Blueprint blueprint);
}
