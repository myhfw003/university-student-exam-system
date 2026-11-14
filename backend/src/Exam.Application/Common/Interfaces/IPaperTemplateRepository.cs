using Exam.Domain.Authoring;

namespace Exam.Application.Common.Interfaces;

public interface IPaperTemplateRepository
{
    Task<PaperTemplate?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>列出模板，可按名称与形态过滤。</summary>
    Task<IReadOnlyList<PaperTemplate>> ListAsync(
        PaperKind? kind,
        string? keyword,
        CancellationToken cancellationToken = default);

    Task AddAsync(PaperTemplate template, CancellationToken cancellationToken = default);

    void Update(PaperTemplate template);
}
