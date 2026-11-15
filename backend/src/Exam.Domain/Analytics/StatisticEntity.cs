using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Analytics;

/// <summary>
/// 统计读模型实体基类。
/// <para>
/// 读模型是**派生数据**：由原始作答数据重算得出，不承载业务规则，
/// 因此没有状态流转、没有软删除、也不进审计流水——错了靠重算纠正。
/// </para>
/// </summary>
public abstract class StatisticEntity : Entity<long>
{
    protected StatisticEntity() { }

    protected StatisticEntity(DateTimeOffset now)
    {
        CreatedAt = now;
        UpdatedAt = now;
    }

    /// <summary>写入时间。</summary>
    public DateTimeOffset CreatedAt { get; protected set; }

    /// <summary>最近一次重算时间。读模型是否落后于原始数据，看它。</summary>
    public DateTimeOffset UpdatedAt { get; protected set; }

    /// <summary>乐观并发令牌。映射到 PostgreSQL 的 xmin 系统列。</summary>
    public uint Version { get; private set; }
}
