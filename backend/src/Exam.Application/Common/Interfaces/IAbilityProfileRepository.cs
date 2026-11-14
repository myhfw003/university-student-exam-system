using Exam.Domain.Learning;

namespace Exam.Application.Common.Interfaces;

/// <summary>能力画像。</summary>
public interface IAbilityProfileRepository
{
    Task<AbilityProfile?> GetAsync(
        long userId,
        long abilityTagId,
        CancellationToken cancellationToken = default);

    /// <summary>取回某人的全部能力画像。</summary>
    Task<IReadOnlyList<AbilityProfile>> ListByUserAsync(
        long userId,
        CancellationToken cancellationToken = default);

    Task AddAsync(AbilityProfile profile, CancellationToken cancellationToken = default);

    void Update(AbilityProfile profile);
}
