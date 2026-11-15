using System.Collections.Concurrent;
using Exam.Domain.Authoring;

namespace Exam.Application.Authoring.Services;

/// <summary>
/// 试卷快照缓存。
/// <para>
/// 快照**发布后不可变**——题目之后被改被停用，都不影响已生成的快照。
/// 既然不变，进考场时就不必每次都回库读：一份快照全进程只读一次。
/// </para>
/// <para>
/// 开考瞬间 1000 人同时进考场，读的是同一份快照；缓存住之后，
/// 数据库这边几乎不承压。缓存的是**脱离跟踪的只读实例**，不会被变更跟踪器拖住。</para>
/// </summary>
public sealed class PaperSnapshotCache
{
    private readonly ConcurrentDictionary<long, PaperSnapshot> _snapshots = new();

    /// <summary>取缓存的快照。</summary>
    public bool TryGet(long snapshotId, out PaperSnapshot? snapshot) =>
        _snapshots.TryGetValue(snapshotId, out snapshot);

    /// <summary>放进缓存。</summary>
    public void Set(long snapshotId, PaperSnapshot snapshot) =>
        _snapshots[snapshotId] = snapshot;

    /// <summary>缓存里的快照份数（自检与监控用）。</summary>
    public int Count => _snapshots.Count;
}
