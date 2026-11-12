/* ==========================================================================
   知行测评 · 离线与待同步提示
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §4.4 与文件树中的 OfflineBadge.tsx。
   原文案：「离线 · 待同步 N 条」。
   ========================================================================== */

/** 离线提示属性。 */
export interface OfflineBadgeProps {
  /** 是否离线。 */
  offline: boolean;
  /** 待同步批次数。 */
  pending: number;
  /** 是否正在上行。 */
  syncing: boolean;
}

/**
 * 同步状态提示。
 *
 * 正常在线且无积压时不渲染任何东西，不占用答题区的注意力。
 */
export function OfflineBadge({ offline, pending, syncing }: OfflineBadgeProps) {
  if (offline) {
    return (
      <span className="badge badge-warn" role="status">
        离线 · 待同步 {pending} 条
      </span>
    );
  }
  if (syncing) {
    return (
      <span className="badge badge-info" role="status">
        同步中
      </span>
    );
  }
  if (pending > 0) {
    return (
      <span className="badge badge-neutral" role="status">
        待同步 {pending} 条
      </span>
    );
  }
  return null;
}
